//! T3's SnapShot for the agent tabs: a shortcut pressed anywhere captures the window in front and
//! hands it to the agents' composer (T3's `apps/desktop/src/snapShot`). The agents' page asks for
//! it through Willow's page (`features/harness/src/HarnessView.tsx`); a capture waits here, in
//! memory, until the composer has taken it.
//!
//! On Windows a low-level keyboard hook, installed once capture is first turned on in the agents'
//! settings, watches for the shortcut: both Shift keys (T3's default), both keys of another
//! modifier, or a key with modifiers, which the app in front then never sees. `PrintWindow` draws
//! the window, cropped to the frame DWM shows. Elsewhere capture is unavailable.

use std::{
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::Engine as _;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// Captures the composer has not taken yet; past this, the oldest goes.
const MAX_PENDING: usize = 8;

/// A shortcut as T3's settings write it (`SnapShotShortcut`), as the keyboard hook matches it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Trigger {
    /// Both keys of one modifier, as their left and right virtual-key codes.
    Pair(u8, u8),
    /// A key with exactly these modifiers held.
    Chord { key: u8, ctrl: bool, shift: bool, alt: bool, win: bool },
}

const COMMON_MOD_ACTIONS: &[(&str, &str)] = &[
    ("a", "Select All"),
    ("c", "Copy"),
    ("f", "Find"),
    ("n", "New"),
    ("o", "Open"),
    ("p", "Print"),
    ("q", "Quit"),
    ("s", "Save"),
    ("t", "New Tab"),
    ("v", "Paste"),
    ("w", "Close Window"),
    ("x", "Cut"),
    ("z", "Undo"),
];

/// The shortcut the hook can watch for, or why it cannot (T3's `snapShotShortcutSystemConflict`
/// for chords other apps and the system already use).
fn trigger_of(shortcut: &Value) -> Result<Trigger, String> {
    let unavailable = || "This shortcut is not available on this system.".to_string();
    match shortcut.get("kind").and_then(Value::as_str) {
        Some("both-shift-keys") => return Ok(Trigger::Pair(0xA0, 0xA1)),
        Some("modifier-pair") => {
            return match shortcut.get("modifier").and_then(Value::as_str) {
                Some("shift") => Ok(Trigger::Pair(0xA0, 0xA1)),
                Some("control") => Ok(Trigger::Pair(0xA2, 0xA3)),
                Some("alt") => Ok(Trigger::Pair(0xA4, 0xA5)),
                Some("meta") => Ok(Trigger::Pair(0x5B, 0x5C)),
                _ => Err(unavailable()),
            }
        }
        Some(_) => return Err(unavailable()),
        None => {}
    }
    let flag = |name: &str| shortcut.get(name).and_then(Value::as_bool).unwrap_or(false);
    let (ctrl, shift, alt, win) = (flag("ctrlKey") || flag("modKey"), flag("shiftKey"), flag("altKey"), flag("metaKey"));
    let name = shortcut.get("key").and_then(Value::as_str).unwrap_or_default().to_ascii_lowercase();
    if !(ctrl || shift || alt || win) {
        return Err("A snapshot shortcut needs a modifier.".into());
    }
    if [ctrl, shift, alt, win].iter().filter(|held| **held).count() == 1 {
        if shift {
            return Err("Shift combinations are used for typing and text selection. Add another modifier.".into());
        }
        if ctrl {
            if let Some((_, action)) = COMMON_MOD_ACTIONS.iter().find(|(key, _)| *key == name) {
                return Err(format!("This shortcut is {action} in most apps."));
            }
        }
        if alt && name == "tab" {
            return Err("The system uses Alt+Tab to switch apps.".into());
        }
        if win && (name == "l" || name == "space") {
            return Err("The system already uses this shortcut.".into());
        }
    }
    let key = virtual_key(&name).ok_or_else(|| "Willow can't watch for that key. Choose another.".to_string())?;
    Ok(Trigger::Chord { key, ctrl, shift, alt, win })
}

/// A key as T3's keybindings name it (`normalizeShortcutKeyToken`), as a Windows virtual-key code.
fn virtual_key(name: &str) -> Option<u8> {
    if let [character] = name.as_bytes() {
        return match character {
            b'a'..=b'z' => Some(character - b'a' + 0x41),
            b'0'..=b'9' => Some(character - b'0' + 0x30),
            _ => platform::virtual_key_for(*character as char),
        };
    }
    if let Some(number) = name.strip_prefix('f').and_then(|number| number.parse::<u8>().ok()) {
        return (1..=24).contains(&number).then_some(0x6F + number);
    }
    Some(match name {
        "space" => 0x20,
        "enter" => 0x0D,
        "tab" => 0x09,
        "esc" => 0x1B,
        "backspace" => 0x08,
        "delete" => 0x2E,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        "arrowup" => 0x26,
        "arrowdown" => 0x28,
        "arrowleft" => 0x25,
        "arrowright" => 0x27,
        _ => return None,
    })
}

/// What the keyboard hook has seen of the keys held, and the shortcut it is armed with.
pub(crate) struct Watch {
    trigger: Option<Trigger>,
    suppressed: bool,
    keys: [bool; 256],
    /// A pair fired since its keys went down, or another key joined them: no capture until both
    /// are up again.
    spent: bool,
    /// The chord's key went down as the shortcut; its release is kept from the app too.
    swallowing: bool,
}

/// What one key does: take a capture, and whether the app in front must not see it.
#[derive(Debug, PartialEq, Eq, Default)]
pub(crate) struct Press {
    pub(crate) fire: bool,
    pub(crate) swallow: bool,
}

impl Watch {
    pub(crate) const fn new() -> Self {
        Watch { trigger: None, suppressed: false, keys: [false; 256], spent: false, swallowing: false }
    }

    pub(crate) fn arm(&mut self, trigger: Option<Trigger>) {
        self.trigger = trigger;
        self.spent = false;
        self.swallowing = false;
    }

    pub(crate) fn suppress(&mut self, suppressed: bool) {
        self.suppressed = suppressed;
    }

    /// One key (a virtual-key code) going down or up.
    pub(crate) fn press(&mut self, key: usize, down: bool) -> Press {
        let key = key & 0xFF;
        let repeat = down && self.keys[key];
        self.keys[key] = down;
        let Some(trigger) = self.trigger.filter(|_| !self.suppressed) else { return Press::default() };
        match trigger {
            Trigger::Pair(left, right) => {
                let (left, right) = (usize::from(left), usize::from(right));
                let is_pair = key == left || key == right;
                if down && !repeat && !is_pair && (self.keys[left] || self.keys[right]) {
                    self.spent = true;
                }
                let alone = self.keys.iter().enumerate().all(|(other, held)| !held || other == left || other == right);
                let fire = down && !repeat && is_pair && self.keys[left] && self.keys[right] && alone && !self.spent;
                if fire {
                    self.spent = true;
                }
                if !self.keys[left] && !self.keys[right] {
                    self.spent = false;
                }
                Press { fire, swallow: false }
            }
            Trigger::Chord { key: chord_key, ctrl, shift, alt, win } => {
                if key != usize::from(chord_key) {
                    return Press::default();
                }
                if !down {
                    return Press { fire: false, swallow: std::mem::take(&mut self.swallowing) };
                }
                let either = |left: usize| self.keys[left] || self.keys[left + 1];
                let matches = either(0xA2) == ctrl && either(0xA0) == shift && either(0xA4) == alt && either(0x5B) == win;
                if matches {
                    self.swallowing = true;
                }
                Press { fire: matches && !repeat, swallow: matches }
            }
        }
    }
}

struct Capture {
    id: String,
    name: String,
    png: Vec<u8>,
    source: Value,
}

#[derive(Default)]
struct State {
    enabled: bool,
    /// The agents' "Include app text" (`snapShotIncludeAccessibility`).
    include_text: bool,
    shortcut: Option<Value>,
    registered: bool,
    shortcut_message: Option<String>,
    /// Why the last capture failed, for the one state read that follows its `failed` event.
    failure: Option<String>,
    pending: Vec<Capture>,
}

#[derive(Default)]
pub struct SnapShots(Mutex<State>);

fn with_state<T>(app: &AppHandle, f: impl FnOnce(&mut State) -> T) -> T {
    let shots = app.state::<SnapShots>();
    let mut state: MutexGuard<'_, State> = shots.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut state)
}

/// A capture's lifecycle, for the agents' page (`DesktopSnapShotEvent`), through Willow's page.
fn tell(app: &AppHandle, event: Value) {
    if let Some(page) = app.get_webview(crate::tabs::PAGE) {
        let message = json!({ "kind": "snapshot", "event": event });
        let _ = page.eval(format!("window.__WILLOW_DESKTOP__ && window.__WILLOW_DESKTOP__.receive({message})"));
    }
}

/// UTC now as ISO 8601 with milliseconds, as T3's sources carry `capturedAt`.
fn iso_now() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = now.as_secs() as i64;
    let (days, rest) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    // Days since 1970-01-01 to a civil date (Howard Hinnant's `civil_from_days`).
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60,
        now.subsec_millis()
    )
}

fn clipped(text: &str, max: usize) -> String {
    text.trim().chars().take(max).collect::<String>().trim().to_string()
}

fn encode_png(width: u32, height: u32, rgb: &[u8]) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    let mut encoder = png::Encoder::new(&mut png, width, height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
    writer.write_image_data(rgb).map_err(|error| error.to_string())?;
    writer.finish().map_err(|error| error.to_string())?;
    Ok(png)
}

/// The shortcut was pressed: the window in front, for the composer, then Willow to the front.
fn take(app: &AppHandle) {
    let id = uuid::Uuid::new_v4().to_string();
    tell(app, json!({ "type": "requested", "id": id }));
    tell(app, json!({ "type": "started", "id": id }));
    let shot = platform::capture().and_then(|shot| Ok((encode_png(shot.width, shot.height, &shot.rgb)?, shot)));
    match shot {
        Ok((png, shot)) => {
            let captured_at = iso_now();
            let app_name = clipped(&shot.app, 255);
            let mut source = json!({
                "kind": "snap-shot",
                "capturedAt": captured_at,
                "appName": if app_name.is_empty() { "Window".to_string() } else { app_name },
                "windowTitle": clipped(&shot.title, 1_000),
            });
            if with_state(app, |state| state.include_text) {
                if let Some(text) = platform::accessible_text(shot.window) {
                    source["accessibleText"] = Value::String(text);
                }
            }
            let name = format!("window-{}.png", captured_at.replace(':', "-"));
            with_state(app, |state| {
                state.pending.push(Capture { id: id.clone(), name, png, source });
                let excess = state.pending.len().saturating_sub(MAX_PENDING);
                state.pending.drain(..excess);
            });
            tell(app, json!({ "type": "ready", "id": id }));
            crate::show_main(app);
        }
        Err(message) => {
            with_state(app, |state| state.failure = Some(message));
            tell(app, json!({ "type": "failed", "id": id }));
        }
    }
}

fn pending_json(capture: &Capture) -> Value {
    json!({
        "id": capture.id,
        "name": capture.name,
        "mimeType": "image/png",
        "sizeBytes": capture.png.len(),
        "source": capture.source,
    })
}

/// `DesktopSnapShotState`: Windows captures directly, with nothing to set up but the shortcut.
fn state_json(app: &AppHandle) -> Value {
    with_state(app, |state| {
        json!({
            "mode": if cfg!(windows) { "direct" } else { "unavailable" },
            "windows": cfg!(windows),
            "shortcut": state.shortcut.clone().unwrap_or_else(|| json!({ "kind": "both-shift-keys" })),
            "shortcutRegistered": state.registered,
            "shortcutMessage": state.shortcut_message,
            "message": if cfg!(windows) {
                state.failure.take()
            } else {
                Some("Willow captures windows on Windows.".to_string())
            },
        })
    })
}

/// The agents' capture settings (`snapShotEnabled`, `snapShotShortcut`,
/// `snapShotIncludeAccessibility`), each time they are saved.
#[tauri::command]
pub fn snapshot_configure(app: AppHandle, enabled: bool, shortcut: Value, include_accessibility: Option<bool>) -> Value {
    let (trigger, message) = match trigger_of(&shortcut) {
        Ok(trigger) if enabled => match platform::watch(&app) {
            Ok(()) => (Some(trigger), None),
            Err(message) => (None, Some(message)),
        },
        Ok(_) => (None, None),
        Err(message) => (None, enabled.then_some(message)),
    };
    platform::arm(trigger);
    with_state(&app, |state| {
        state.enabled = enabled;
        state.include_text = include_accessibility.unwrap_or(true);
        state.shortcut = Some(shortcut);
        state.registered = trigger.is_some();
        state.shortcut_message = message;
    });
    state_json(&app)
}

#[tauri::command]
pub fn snapshot_state(app: AppHandle) -> Value {
    state_json(&app)
}

#[tauri::command]
pub fn snapshot_check_shortcut(shortcut: Value) -> Value {
    match trigger_of(&shortcut) {
        Ok(_) if cfg!(windows) => json!({ "available": true, "message": null }),
        Ok(_) => json!({ "available": false, "message": "Willow captures windows on Windows." }),
        Err(message) => json!({ "available": false, "message": message }),
    }
}

/// While the settings record a new shortcut, the current one must not capture.
#[tauri::command]
pub fn snapshot_suppress(suppressed: bool) {
    platform::suppress(suppressed);
}

#[tauri::command]
pub fn snapshot_pending(app: AppHandle) -> Vec<Value> {
    with_state(&app, |state| state.pending.iter().map(pending_json).collect())
}

#[tauri::command]
pub fn snapshot_read(app: AppHandle, id: String) -> Result<Value, String> {
    with_state(&app, |state| {
        let capture =
            state.pending.iter().find(|capture| capture.id == id).ok_or_else(|| "That capture is gone.".to_string())?;
        let mut value = pending_json(capture);
        value["dataUrl"] =
            Value::String(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&capture.png)));
        Ok(value)
    })
}

#[tauri::command]
pub fn snapshot_ack(app: AppHandle, id: String) {
    with_state(&app, |state| state.pending.retain(|capture| capture.id != id));
}

/// The window in front, as rows of RGB pixels.
pub(crate) struct Shot {
    width: u32,
    height: u32,
    rgb: Vec<u8>,
    title: String,
    app: String,
    /// The window's handle, for its app text.
    window: isize,
}

/// T3's limits on a capture's app text (`SNAP_SHOT_ACCESSIBLE_TEXT_MAX_CHARS`, `…_MAX_NODES`), in
/// UTF-16 units as the agents' page counts them.
const ACCESSIBLE_TEXT_MAX_UNITS: usize = 32_000;
const ACCESSIBLE_TEXT_MAX_NODES: usize = 10_000;
/// Some apps answer UI Automation slowly; the capture does not wait longer than this for its text.
const ACCESSIBLE_TEXT_BUDGET: std::time::Duration = std::time::Duration::from_millis(1_500);

/// Joins an element's name or value onto the app text, once per distinct string (T3's
/// `accessibleWindowText`); false once the text is full.
fn add_accessible_text(text: &mut String, units: &mut usize, seen: &mut std::collections::HashSet<String>, value: &str) -> bool {
    let candidate = value.replace('\0', "");
    let candidate = candidate.trim();
    if candidate.is_empty() || seen.contains(candidate) {
        return true;
    }
    let separator = usize::from(!text.is_empty());
    if *units + separator >= ACCESSIBLE_TEXT_MAX_UNITS {
        return false;
    }
    if separator == 1 {
        text.push('\n');
        *units += 1;
    }
    for character in candidate.chars() {
        if *units + character.len_utf16() > ACCESSIBLE_TEXT_MAX_UNITS {
            return false;
        }
        text.push(character);
        *units += character.len_utf16();
    }
    seen.insert(candidate.to_string());
    true
}

#[cfg(windows)]
mod platform {
    use std::{
        ffi::c_void,
        mem, ptr,
        sync::{mpsc, Mutex, MutexGuard, OnceLock},
    };

    use tauri::AppHandle;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::{
                BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, BITMAPINFO,
                BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
            },
        },
        Storage::Xps::PrintWindow,
        System::{
            LibraryLoader::GetModuleHandleW,
            Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION},
        },
        UI::{
            Input::KeyboardAndMouse::VkKeyScanW,
            WindowsAndMessaging::{
                CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowRect, GetWindowTextLengthW,
                GetWindowTextW, GetWindowThreadProcessId, IsIconic, SetWindowsHookExW, TranslateMessage, HC_ACTION,
                KBDLLHOOKSTRUCT, MSG, PW_RENDERFULLCONTENT, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
            },
        },
    };

    use super::{Shot, Trigger, Watch};

    static WATCH: Mutex<Watch> = Mutex::new(Watch::new());
    static SHUTTER: OnceLock<mpsc::Sender<()>> = OnceLock::new();
    static STARTED: OnceLock<Result<(), String>> = OnceLock::new();

    fn watching() -> MutexGuard<'static, Watch> {
        WATCH.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn arm(trigger: Option<Trigger>) {
        watching().arm(trigger);
    }

    pub fn suppress(suppressed: bool) {
        watching().suppress(suppressed);
    }

    /// A printable character's key on this keyboard layout, when it needs no modifier of its own.
    pub fn virtual_key_for(character: char) -> Option<u8> {
        let mut units = [0u16; 2];
        let [unit] = character.encode_utf16(&mut units) else { return None };
        // SAFETY: a pure lookup in the current keyboard layout.
        let scan = unsafe { VkKeyScanW(*unit) };
        (scan != -1 && (scan as u16) >> 8 == 0).then_some((scan & 0xFF) as u8)
    }

    /// Installs the keyboard hook and the thread that takes the pictures, the first time capture
    /// is turned on; they stay for the rest of the run, idle while no shortcut is armed.
    pub fn watch(app: &AppHandle) -> Result<(), String> {
        STARTED.get_or_init(|| start(app)).clone()
    }

    fn start(app: &AppHandle) -> Result<(), String> {
        let (shutter, presses) = mpsc::channel::<()>();
        let (report, installed) = mpsc::channel::<bool>();
        // Its own thread: every key pressed anywhere waits on the hook, so it must never wait on
        // Willow's window.
        std::thread::Builder::new()
            .name("willow-snapshot-keys".into())
            .spawn(move || {
                // SAFETY: the hook calls back on this thread, from the message loop below.
                unsafe {
                    let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), GetModuleHandleW(ptr::null()), 0);
                    let _ = report.send(!hook.is_null());
                    if hook.is_null() {
                        return;
                    }
                    let mut message: MSG = mem::zeroed();
                    while GetMessageW(&mut message, ptr::null_mut(), 0, 0) > 0 {
                        TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        if !installed.recv().unwrap_or(false) {
            return Err("Willow could not watch the keyboard for the shortcut.".into());
        }
        let _ = SHUTTER.set(shutter);
        let app = app.clone();
        std::thread::Builder::new()
            .name("willow-snapshot".into())
            .spawn(move || {
                for () in presses {
                    super::take(&app);
                }
            })
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    unsafe extern "system" fn keyboard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            // SAFETY: for HC_ACTION, lparam points at the key's KBDLLHOOKSTRUCT.
            let key = ((*(lparam as *const KBDLLHOOKSTRUCT)).vkCode & 0xFF) as usize;
            let message = wparam as u32;
            let down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            if down || message == WM_KEYUP || message == WM_SYSKEYUP {
                let press = watching().press(key, down);
                if press.fire {
                    shoot();
                }
                if press.swallow {
                    return 1;
                }
            }
        }
        CallNextHookEx(ptr::null_mut(), code, wparam, lparam)
    }

    fn shoot() {
        if let Some(shutter) = SHUTTER.get() {
            let _ = shutter.send(());
        }
    }

    /// The window in front, drawn whole and cropped to the frame DWM shows (without its resize
    /// borders and shadow).
    pub fn capture() -> Result<Shot, String> {
        // SAFETY: Win32 calls on the window in front; every DC and bitmap made here is released here.
        unsafe {
            let window = GetForegroundWindow();
            if window.is_null() {
                return Err("No window is in front to capture.".into());
            }
            if IsIconic(window) != 0 {
                return Err("The window in front is minimised.".into());
            }
            let mut outer: RECT = mem::zeroed();
            if GetWindowRect(window, &mut outer) == 0 {
                return Err("Willow could not measure the window in front.".into());
            }
            let mut frame = outer;
            DwmGetWindowAttribute(
                window,
                DWMWA_EXTENDED_FRAME_BOUNDS as u32,
                &mut frame as *mut RECT as *mut c_void,
                mem::size_of::<RECT>() as u32,
            );
            let (width, height) = (outer.right - outer.left, outer.bottom - outer.top);
            if width <= 0 || height <= 0 {
                return Err("The window in front has no size.".into());
            }
            let (rgb, crop_width, crop_height) = draw(window, &outer, &frame, width, height)?;
            Ok(Shot {
                width: crop_width,
                height: crop_height,
                rgb,
                title: title_of(window),
                app: app_of(window),
                window: window as isize,
            })
        }
    }

    unsafe fn draw(window: HWND, outer: &RECT, frame: &RECT, width: i32, height: i32) -> Result<(Vec<u8>, u32, u32), String> {
        let screen = GetDC(ptr::null_mut());
        let memory = CreateCompatibleDC(screen);
        let mut info: BITMAPINFO = mem::zeroed();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..mem::zeroed()
        };
        let mut bits: *mut c_void = ptr::null_mut();
        let bitmap = CreateDIBSection(memory, &info, DIB_RGB_COLORS, &mut bits, ptr::null_mut(), 0);
        let result = if bitmap.is_null() || bits.is_null() {
            Err("Willow could not make room for the picture.".to_string())
        } else {
            let previous = SelectObject(memory, bitmap);
            if PrintWindow(window, memory, PW_RENDERFULLCONTENT) == 0 {
                BitBlt(memory, 0, 0, width, height, screen, outer.left, outer.top, SRCCOPY | CAPTUREBLT);
            }
            let pixels = std::slice::from_raw_parts(bits as *const u8, width as usize * height as usize * 4);
            let left = (frame.left - outer.left).clamp(0, width - 1);
            let top = (frame.top - outer.top).clamp(0, height - 1);
            let crop_width = (frame.right - frame.left).clamp(1, width - left);
            let crop_height = (frame.bottom - frame.top).clamp(1, height - top);
            let mut rgb = Vec::with_capacity(crop_width as usize * crop_height as usize * 3);
            for row in top..top + crop_height {
                let start = (row as usize * width as usize + left as usize) * 4;
                for pixel in pixels[start..start + crop_width as usize * 4].chunks_exact(4) {
                    rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
                }
            }
            SelectObject(memory, previous);
            Ok((rgb, crop_width as u32, crop_height as u32))
        };
        if !bitmap.is_null() {
            DeleteObject(bitmap);
        }
        DeleteDC(memory);
        ReleaseDC(ptr::null_mut(), screen);
        result
    }

    /// The window's text and controls as UI Automation reads them: each element's name and value,
    /// walked depth first through the control view, within T3's limits and the time budget.
    pub fn accessible_text(window: isize) -> Option<String> {
        use windows::Win32::{
            Foundation::HWND as ComHwnd,
            System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED},
            UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationValuePattern, UIA_ValuePatternId},
        };

        let deadline = std::time::Instant::now() + super::ACCESSIBLE_TEXT_BUDGET;
        // SAFETY: COM on this thread, released before returning; the handle is the captured window's.
        unsafe {
            let initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            let walk = || -> windows::core::Result<String> {
                let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
                let walker = automation.ControlViewWalker()?;
                let mut stack = vec![automation.ElementFromHandle(ComHwnd(window as *mut c_void))?];
                let (mut text, mut units, mut seen, mut visited) = (String::new(), 0, std::collections::HashSet::new(), 0);
                while let Some(element) = stack.pop() {
                    if visited >= super::ACCESSIBLE_TEXT_MAX_NODES || std::time::Instant::now() >= deadline {
                        break;
                    }
                    visited += 1;
                    let name = element.CurrentName().map(|name| name.to_string()).unwrap_or_default();
                    let value = element
                        .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                        .and_then(|pattern| pattern.CurrentValue())
                        .map(|value| value.to_string())
                        .unwrap_or_default();
                    if !super::add_accessible_text(&mut text, &mut units, &mut seen, &name)
                        || !super::add_accessible_text(&mut text, &mut units, &mut seen, &value)
                    {
                        break;
                    }
                    let mut children = Vec::new();
                    let mut child = walker.GetFirstChildElement(&element).ok();
                    while let Some(current) = child {
                        child = walker.GetNextSiblingElement(&current).ok();
                        children.push(current);
                    }
                    stack.extend(children.into_iter().rev());
                }
                Ok(text)
            };
            let text = walk();
            if initialized {
                CoUninitialize();
            }
            text.ok().filter(|text| !text.is_empty())
        }
    }

    unsafe fn title_of(window: HWND) -> String {
        let length = GetWindowTextLengthW(window);
        if length <= 0 {
            return String::new();
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let copied = GetWindowTextW(window, buffer.as_mut_ptr(), buffer.len() as i32);
        String::from_utf16_lossy(&buffer[..copied.max(0) as usize])
    }

    /// The program behind the window, as its executable's name without `.exe` (T3's `appName`).
    unsafe fn app_of(window: HWND) -> String {
        let mut process_id = 0u32;
        GetWindowThreadProcessId(window, &mut process_id);
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process.is_null() {
            return String::new();
        }
        let mut buffer = vec![0u16; 1_024];
        let mut size = buffer.len() as u32;
        let named = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut size) != 0;
        CloseHandle(process);
        if !named {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        std::path::Path::new(&path).file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default()
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::AppHandle;

    use super::{Shot, Trigger};

    pub fn arm(_trigger: Option<Trigger>) {}

    pub fn suppress(_suppressed: bool) {}

    pub fn virtual_key_for(_character: char) -> Option<u8> {
        None
    }

    pub fn watch(_app: &AppHandle) -> Result<(), String> {
        Err("Willow captures windows on Windows.".into())
    }

    pub fn capture() -> Result<Shot, String> {
        Err("Willow captures windows on Windows.".into())
    }

    pub fn accessible_text(_window: isize) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_t3_shortcuts() {
        assert_eq!(trigger_of(&json!({ "kind": "both-shift-keys" })), Ok(Trigger::Pair(0xA0, 0xA1)));
        assert_eq!(trigger_of(&json!({ "kind": "modifier-pair", "modifier": "control" })), Ok(Trigger::Pair(0xA2, 0xA3)));
        assert_eq!(
            trigger_of(&json!({ "key": "2", "ctrlKey": false, "modKey": true, "shiftKey": true, "altKey": false, "metaKey": false })),
            Ok(Trigger::Chord { key: 0x32, ctrl: true, shift: true, alt: false, win: false })
        );
        assert_eq!(
            trigger_of(&json!({ "key": "f8", "ctrlKey": false, "modKey": false, "shiftKey": false, "altKey": true, "metaKey": false })),
            Ok(Trigger::Chord { key: 0x77, ctrl: false, shift: false, alt: true, win: false })
        );
    }

    #[test]
    fn refuses_what_other_apps_use() {
        let chord = |key: &str, ctrl: bool| json!({ "key": key, "ctrlKey": false, "modKey": ctrl, "shiftKey": !ctrl, "altKey": false, "metaKey": false });
        assert_eq!(trigger_of(&chord("c", true)), Err("This shortcut is Copy in most apps.".into()));
        assert!(trigger_of(&chord("k", false)).unwrap_err().starts_with("Shift combinations"));
        assert!(trigger_of(&json!({ "key": "k", "ctrlKey": false, "modKey": false, "shiftKey": false, "altKey": false, "metaKey": false })).is_err());
    }

    const LEFT_SHIFT: usize = 0xA0;
    const RIGHT_SHIFT: usize = 0xA1;

    #[test]
    fn both_shift_keys_capture_once_per_press() {
        let mut watch = Watch::new();
        watch.arm(Some(Trigger::Pair(0xA0, 0xA1)));
        assert!(!watch.press(LEFT_SHIFT, true).fire);
        assert!(watch.press(RIGHT_SHIFT, true).fire);
        assert!(!watch.press(RIGHT_SHIFT, true).fire, "a held key repeating is not another press");
        watch.press(RIGHT_SHIFT, false);
        assert!(!watch.press(RIGHT_SHIFT, true).fire, "not again until both are up");
        watch.press(RIGHT_SHIFT, false);
        watch.press(LEFT_SHIFT, false);
        watch.press(RIGHT_SHIFT, true);
        assert!(watch.press(LEFT_SHIFT, true).fire);
        assert!(!watch.press(LEFT_SHIFT, false).swallow, "the pair's keys still reach the app");
    }

    #[test]
    fn typing_with_shift_held_never_captures() {
        let mut watch = Watch::new();
        watch.arm(Some(Trigger::Pair(0xA0, 0xA1)));
        watch.press(LEFT_SHIFT, true);
        watch.press(0x41, true);
        watch.press(0x41, false);
        assert!(!watch.press(RIGHT_SHIFT, true).fire);
        watch.press(LEFT_SHIFT, false);
        watch.press(RIGHT_SHIFT, false);
        watch.press(0x41, true);
        watch.press(LEFT_SHIFT, true);
        assert!(!watch.press(RIGHT_SHIFT, true).fire, "a key already held spoils the pair");
    }

    #[test]
    fn a_chord_captures_and_is_kept_from_the_app() {
        let mut watch = Watch::new();
        watch.arm(Some(Trigger::Chord { key: 0x32, ctrl: true, shift: true, alt: false, win: false }));
        watch.press(0xA2, true);
        assert_eq!(watch.press(0x32, true), Press { fire: false, swallow: false }, "Ctrl+2 alone is not it");
        watch.press(0x32, false);
        watch.press(LEFT_SHIFT, true);
        assert_eq!(watch.press(0x32, true), Press { fire: true, swallow: true });
        assert_eq!(watch.press(0x32, true), Press { fire: false, swallow: true });
        assert_eq!(watch.press(0x32, false), Press { fire: false, swallow: true });
        assert_eq!(watch.press(0x33, true), Press::default());
    }

    #[test]
    fn suppressed_or_disarmed_watches_nothing() {
        let mut watch = Watch::new();
        watch.arm(Some(Trigger::Pair(0xA0, 0xA1)));
        watch.suppress(true);
        watch.press(LEFT_SHIFT, true);
        assert!(!watch.press(RIGHT_SHIFT, true).fire);
        watch.suppress(false);
        watch.arm(None);
        watch.press(LEFT_SHIFT, false);
        watch.press(RIGHT_SHIFT, false);
        watch.press(LEFT_SHIFT, true);
        assert!(!watch.press(RIGHT_SHIFT, true).fire);
    }

    #[test]
    fn app_text_keeps_each_string_once_within_the_limit() {
        let (mut text, mut units, mut seen) = (String::new(), 0, std::collections::HashSet::new());
        for value in ["  Save ", "", "Save", "Name\0", "Untitled"] {
            assert!(add_accessible_text(&mut text, &mut units, &mut seen, value));
        }
        assert_eq!(text, "Save\nName\nUntitled");
        assert_eq!(units, text.encode_utf16().count());
        let long = "x".repeat(ACCESSIBLE_TEXT_MAX_UNITS);
        assert!(!add_accessible_text(&mut text, &mut units, &mut seen, &long));
        assert!(text.encode_utf16().count() <= ACCESSIBLE_TEXT_MAX_UNITS);
    }

    #[test]
    fn dates_captures_in_utc() {
        let now = iso_now();
        assert_eq!(now.len(), 24);
        assert!(now.ends_with('Z') && now.as_bytes()[10] == b'T');
    }
}
