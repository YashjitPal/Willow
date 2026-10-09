//! Windows 11 snap layouts for the strip's maximise button (or macOS's green one, from Labs).
//!
//! Windows offers its snap-layout menu when the window under the cursor answers
//! WM_NCHITTEST with HTMAXBUTTON. The strip's button is HTML in a WebView2 child
//! window owned by another process, which answers HTCLIENT, and Willow's own
//! window is never asked. So a small, invisible native child window sits over
//! the button and answers for it. Because it owns the mouse there, it also does
//! the button's work — maximise or restore on click — and tells the strip when
//! the button should look hovered or pressed.
//!
//! It is a layered window at alpha 1/255, which the system composes but no one
//! sees; layered child windows need the Windows 8 compatibility entry in
//! `app.manifest`.
//!
//! When the strip's buttons are macOS's, it also hears when the window comes to
//! the front or goes behind another, and greys them out as macOS does.

use std::sync::{
    atomic::{AtomicBool, AtomicIsize, Ordering},
    OnceLock,
};

use tauri::{AppHandle, Manager};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    Graphics::Gdi::{BeginPaint, EndPaint, PAINTSTRUCT},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Accessibility::{SetWinEventHook, HWINEVENTHOOK},
        Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT},
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, GetAncestor, IsZoomed, LoadCursorW, RegisterClassW, SetLayeredWindowAttributes,
            SetWindowPos, ShowWindow, EVENT_SYSTEM_FOREGROUND, GA_ROOT, GA_ROOTOWNER, HTMAXBUTTON, HWND_TOP, IDC_ARROW,
            LWA_ALPHA, MA_NOACTIVATE, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_MAXIMIZE, SW_RESTORE,
            WINEVENT_OUTOFCONTEXT, WM_ERASEBKGND, WM_MOUSEACTIVATE, WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN,
            WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WM_PAINT, WNDCLASSW, WS_CHILD, WS_EX_LAYERED, WS_EX_NOACTIVATE,
            WS_VISIBLE,
        },
    },
};

use crate::tabs::{MAIN, STRIP_HEIGHT};

/// The strip's window buttons, in logical pixels, as `shell/tabs.html` draws them: Windows'
/// caption buttons, three of these at its right end...
const CAPTION_WIDTH: f64 = 46.0;
/// ...below the top-edge resize grip, which the overlay leaves uncovered unless maximised...
const GRIP: f64 = 4.0;
/// ...or, when Labs asks for them, macOS's three, 14px each and 20px apart from 16px in,
/// centred in the strip, where Codex puts macOS's own (`trafficLightPosition`). Maximise is
/// the second of Windows' and the third of macOS's.
const LIGHTS_LEFT: f64 = 16.0;
const LIGHT: f64 = 14.0;
const LIGHT_PITCH: f64 = 20.0;

static APP: OnceLock<AppHandle> = OnceLock::new();
static OVERLAY: AtomicIsize = AtomicIsize::new(0);
static TRACKING: AtomicBool = AtomicBool::new(false);
static PRESSED: AtomicBool = AtomicBool::new(false);
static MAIN_WINDOW: AtomicIsize = AtomicIsize::new(0);
static IN_FRONT: AtomicBool = AtomicBool::new(true);

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Puts the overlay over the strip's maximise button. Call once, on the main thread.
pub fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let Some(window) = app.get_window(MAIN) else { return };
    let Ok(parent) = window.hwnd() else { return };
    let class = wide("WillowSnapOverlay");
    // SAFETY: plain Win32 calls on windows this function creates; the class name outlives
    // registration because the system copies it.
    let overlay = unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class_info = WNDCLASSW {
            lpfnWndProc: Some(overlay_proc),
            hInstance: instance,
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            lpszClassName: class.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassW(&class_info);
        let overlay = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_NOACTIVATE,
            class.as_ptr(),
            std::ptr::null(),
            WS_CHILD | WS_VISIBLE,
            0,
            0,
            1,
            1,
            parent.0 as HWND,
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if overlay.is_null() {
            return;
        }
        SetLayeredWindowAttributes(overlay, 0, 1, LWA_ALPHA);
        overlay
    };
    OVERLAY.store(overlay as isize, Ordering::SeqCst);
    MAIN_WINDOW.store(parent.0 as isize, Ordering::SeqCst);
    // SAFETY: an out-of-context hook, so it is called on this thread, from its message loop.
    unsafe {
        SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, std::ptr::null_mut(), Some(foreground_changed), 0, 0, WINEVENT_OUTOFCONTEXT);
    }
    place(app);
}

/// Another window came to the front: the strip redraws when that turns Willow's window
/// active or inactive.
unsafe extern "system" fn foreground_changed(_hook: HWINEVENTHOOK, _event: u32, foreground: HWND, _object: i32, _child: i32, _thread: u32, _time: u32) {
    let in_front = GetAncestor(foreground, GA_ROOTOWNER) as isize == MAIN_WINDOW.load(Ordering::SeqCst);
    if IN_FRONT.swap(in_front, Ordering::SeqCst) != in_front {
        if let Some(app) = APP.get() {
            crate::tabs::render(app);
        }
    }
}

/// Fits the overlay to the button and raises it above the webviews. Call after every
/// layout change and after a webview is added.
pub fn place(app: &AppHandle) {
    let overlay = OVERLAY.load(Ordering::SeqCst) as HWND;
    let Some(window) = app.get_window(MAIN) else { return };
    let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else { return };
    if overlay.is_null() || size.width == 0 {
        return;
    }
    let (left, top, right, bottom) = if crate::tabs::mac_buttons(app) {
        let left = ((LIGHTS_LEFT + 2.0 * LIGHT_PITCH) * scale).round() as i32;
        let top = ((STRIP_HEIGHT - LIGHT) / 2.0 * scale).round() as i32;
        let side = (LIGHT * scale).round() as i32;
        (left, top, left + side, top + side)
    } else {
        // Both edges measured from the right, as the strip lays the buttons out.
        let maximized = window.is_maximized().unwrap_or(false);
        let left = size.width as i32 - (2.0 * CAPTION_WIDTH * scale).round() as i32;
        let right = size.width as i32 - (CAPTION_WIDTH * scale).round() as i32;
        let top = if maximized { 0 } else { (GRIP * scale).round() as i32 };
        (left, top, right, (STRIP_HEIGHT * scale).round() as i32)
    };
    // SAFETY: a window this module owns; async, so a busy main thread never blocks the caller.
    unsafe {
        SetWindowPos(overlay, HWND_TOP, left, top, right - left, bottom - top, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS);
    }
}

fn tell_strip(hover: bool, pressed: bool) {
    if let Some(strip) = APP.get().and_then(|app| app.get_webview(crate::tabs::STRIP)) {
        let _ = strip.eval(format!("window.willowTabs && window.willowTabs.maximizeButton({{ hover: {hover}, pressed: {pressed} }})"));
    }
}

unsafe extern "system" fn overlay_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        WM_NCHITTEST => HTMAXBUTTON as LRESULT,
        WM_NCMOUSEMOVE => {
            if !TRACKING.swap(true, Ordering::SeqCst) {
                let mut track = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                };
                TrackMouseEvent(&mut track);
                tell_strip(true, PRESSED.load(Ordering::SeqCst));
            }
            0
        }
        WM_NCMOUSELEAVE => {
            TRACKING.store(false, Ordering::SeqCst);
            PRESSED.store(false, Ordering::SeqCst);
            tell_strip(false, false);
            0
        }
        // Handled here, not by DefWindowProc: its caption-button loop would act on this child window.
        WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => {
            PRESSED.store(true, Ordering::SeqCst);
            tell_strip(true, true);
            0
        }
        WM_NCLBUTTONUP => {
            if PRESSED.swap(false, Ordering::SeqCst) {
                let root = GetAncestor(hwnd, GA_ROOT);
                ShowWindow(root, if IsZoomed(root) != 0 { SW_RESTORE } else { SW_MAXIMIZE });
            }
            tell_strip(TRACKING.load(Ordering::SeqCst), false);
            0
        }
        // Clicking the button must not take focus from the page.
        WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
        WM_ERASEBKGND => 1,
        WM_PAINT => {
            let mut paint: PAINTSTRUCT = std::mem::zeroed();
            BeginPaint(hwnd, &mut paint);
            EndPaint(hwnd, &paint);
            0
        }
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}
