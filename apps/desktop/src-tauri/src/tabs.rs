//! Willow's window: one Willow page in its own webview, under a strip across the
//! top that is itself a small local webview, with the window's buttons, back and
//! forward, the File, Edit and View menus, and the pet's paw.
//!
//! The state lives here; the strip only draws it. After every change Rust calls
//! `window.willowTabs.render(snapshot)` in the strip, and the strip and Willow's
//! page ask for changes through the commands at the end. The lock is never held
//! across a call into Tauri, which may wait on the main thread while the main
//! thread waits on the lock.

use std::{fs, sync::Mutex, thread};

use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowFeatures, NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse, WebviewBuilder},
    window::{Color, WindowBuilder},
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Rect, Size, Url,
    Webview, WebviewUrl, Wry,
};
use tauri_plugin_opener::OpenerExt;

pub const MAIN: &str = "main";
pub const STRIP: &str = "tabstrip";
/// The webview Willow's page is in.
pub const PAGE: &str = "page";
/// The strip's height in logical pixels; `shell/tabs.html` is drawn to the same number.
pub const STRIP_HEIGHT: f64 = 40.0;
/// As small as Codex lets its window go (`getPrimaryMinimumSize`). Willow's page has its narrow
/// layout below 961px.
const MIN_WIDTH: f64 = 480.0;
const MIN_HEIGHT: f64 = 600.0;

/// Windows 11's Mica behind the strip and the frame around Willow's page, as Codex's window has
/// it there (`backgroundMaterial: 'mica'`, on Windows 11 22H2 and later, which have
/// `DWMWA_SYSTEMBACKDROP_TYPE`): the window has no surface of its own
/// (`WS_EX_NOREDIRECTIONBITMAP`), so wherever its webviews are see-through DWM's backdrop is what
/// shows, and the strip and the frame lay the workspace tint over it. Extending the frame over
/// the window, or a transparent window, would leave holes onto the windows behind instead.
/// Earlier Windows has no Mica, so they draw their flat colour, as on macOS and Linux.
#[cfg(windows)]
pub fn mica() -> bool {
    use std::sync::OnceLock;
    use windows_sys::{Wdk::System::SystemServices::RtlGetVersion, Win32::System::SystemInformation::OSVERSIONINFOW};
    static MICA: OnceLock<bool> = OnceLock::new();
    *MICA.get_or_init(|| {
        // SAFETY: RtlGetVersion fills the struct it is handed, sized as it asks.
        let mut info: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
        info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
        let status = unsafe { RtlGetVersion(&mut info) };
        status == 0 && info.dwBuildNumber >= 22621
    })
}

#[cfg(not(windows))]
pub fn mica() -> bool {
    false
}

/// Has DWM draw Mica behind the window. Its light or dark follows the window's theme, which is
/// Willow's (`theme`), never the system's.
#[cfg(windows)]
fn apply_mica(window: &tauri::Window) {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMSBT_MAINWINDOW, DWMWA_SYSTEMBACKDROP_TYPE};
    let Ok(hwnd) = window.hwnd() else { return };
    let backdrop = DWMSBT_MAINWINDOW;
    // SAFETY: a live window handle; DWM copies the value, of the size it is told.
    unsafe {
        DwmSetWindowAttribute(hwnd.0 as _, DWMWA_SYSTEMBACKDROP_TYPE as _, &backdrop as *const _ as _, std::mem::size_of_val(&backdrop) as u32)
    };
}

fn theme(light: bool) -> tauri::Theme {
    if light {
        tauri::Theme::Light
    } else {
        tauri::Theme::Dark
    }
}

/// For Willow's pages and the strip: what is behind them, `"mica"` or nothing (a flat colour).
pub fn material_script() -> String {
    format!("window.__WILLOW_MATERIAL__ = {};", if mica() { "\"mica\"" } else { "null" })
}

/// Willow's page surface (its `body`), which the loading page and the page's own first paint
/// are drawn on. The window and the page's webview are this colour wherever nothing has been
/// drawn yet, so no white shows before a page paints, between two of them, or along an edge
/// the webviews have not caught up with while the window is resized.
fn page_color(light: bool) -> Color {
    if light {
        Color(0xfa, 0xf9, 0xf9, 0xff)
    } else {
        Color(0x0f, 0x0f, 0x0f, 0xff)
    }
}

/// What the strip paints itself (`shell/tabs.html`): the frame's colour as a 35% tint over the
/// grey Mica falls back to, mixed as CSS's `color-mix` in sRGB does.
fn strip_color(frame: Option<&Frame>) -> Color {
    let light = frame.is_some_and(|frame| frame.light);
    let base: [u8; 3] = if light { [0xf3; 3] } else { [0x20; 3] };
    let tint = frame.and_then(|frame| rgb(&frame.color)).unwrap_or(if light { [0xf3; 3] } else { [0x1f; 3] });
    let mix = |index: usize| (f64::from(tint[index]) * 0.35 + f64::from(base[index]) * 0.65).round() as u8;
    Color(mix(0), mix(1), mix(2), 0xff)
}

fn rgb(color: &str) -> Option<[u8; 3]> {
    if !is_hex_color(color) {
        return None;
    }
    let channel = |at: usize| u8::from_str_radix(&color[at..at + 2], 16).ok();
    Some([channel(1)?, channel(3)?, channel(5)?])
}

/// Whether Willow's window is the one in front. On Windows the window's focus flag turns off
/// whenever the page's webview takes the keyboard, so the foreground window is asked instead.
fn window_active(app: &AppHandle) -> bool {
    let Some(window) = app.get_window(MAIN) else { return false };
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOTOWNER};
        let Ok(hwnd) = window.hwnd() else { return true };
        // SAFETY: queries on window handles, which may be stale but are never dereferenced.
        unsafe { GetAncestor(GetForegroundWindow(), GA_ROOTOWNER) == hwnd.0 as _ }
    }
    #[cfg(not(windows))]
    window.is_focused().unwrap_or(true)
}

/// What the page's webview is built with.
pub struct ContentSetup {
    /// Willow's origin. Only its addresses are remembered, and only its pages are let in
    /// further than the webview lets any site (`permission`).
    pub origin: Url,
    /// Run before Willow's own scripts on every load.
    pub scripts: Vec<String>,
    /// WebView2's arguments, which must be the same for every webview of the app.
    pub browser_args: Option<String>,
}

struct Page {
    /// Where it is, among Willow's own addresses.
    url: String,
    /// Where its history goes, as the page reports it: among Willow's own pages only.
    back: bool,
    forward: bool,
}

#[derive(Default)]
struct State {
    page: Option<Page>,
    /// Willow's server answers: the page may load it.
    ready: bool,
    setup: Option<ContentSetup>,
    frame: Option<Frame>,
    /// The application menu open over the page (`file`, `edit` or `view`).
    menu: Option<String>,
    /// Alt is held: the menus' names underline their access keys.
    mnemonics: bool,
    /// Labs' macOS window buttons, at the strip's left, instead of Windows' at its right.
    mac_buttons: bool,
    /// The agents' side panel's tabs, while an agent tab with its panel open is on show.
    panel_tabs: Option<PanelTabs>,
}

/// The agents' side panel's tabs, which Willow's page hands the strip to draw over the panel:
/// `left` device pixels in, up to the window buttons (features/harness HarnessView.tsx).
#[derive(Serialize, Deserialize, Clone, PartialEq)]
pub struct PanelTabs {
    left: f64,
    tabs: Vec<PanelTab>,
    /// Whether the panel offers its +, a menu of what it can open, which the page draws.
    add: bool,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
struct PanelTab {
    id: String,
    title: String,
    active: bool,
    /// Something new in the tab since it was last on show.
    #[serde(default)]
    pending: bool,
    /// The site's icon, by address.
    #[serde(default)]
    image: Option<String>,
    /// The tab's glyph, drawn by the page as a PNG mask the strip fills with its text colour.
    #[serde(default)]
    mask: Option<String>,
}

const PANEL_TABS_MAX: usize = 100;
const PANEL_TAB_TEXT_MAX: usize = 300;
const PANEL_TAB_IMAGE_MAX: usize = 100_000;

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

impl PanelTabs {
    /// What the strip may draw: words as text, pictures by address (a mask only as PNG data).
    fn sanitized(mut self) -> Option<Self> {
        if !self.left.is_finite() {
            return None;
        }
        self.left = self.left.max(0.0);
        self.tabs.truncate(PANEL_TABS_MAX);
        for tab in &mut self.tabs {
            tab.id = clip(&tab.id, PANEL_TAB_TEXT_MAX);
            tab.title = clip(&tab.title, PANEL_TAB_TEXT_MAX);
            tab.image = tab.image.take().filter(|url| {
                url.len() <= PANEL_TAB_IMAGE_MAX && ["data:image/", "https://", "http://"].iter().any(|scheme| url.starts_with(scheme))
            });
            tab.mask = tab.mask.take().filter(|url| {
                url.len() <= PANEL_TAB_IMAGE_MAX
                    && url
                        .strip_prefix("data:image/png;base64,")
                        .is_some_and(|data| data.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"+/=".contains(&byte)))
            });
        }
        Some(self)
    }
}

/// The strip's application menus, Codex's on Windows (`windowsMenuBar`) less Help.
const MENUS: [&str; 3] = ["file", "edit", "view"];

/// The shell colour of the frame Willow's page draws around itself, which the strip
/// sits on: the workspace colour's, as Willow last said.
#[derive(Serialize, Deserialize, Clone, PartialEq)]
struct Frame {
    color: String,
    light: bool,
}

fn is_hex_color(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[derive(Default)]
pub struct Tabs(Mutex<State>);

#[derive(Serialize)]
pub struct Snapshot {
    maximized: bool,
    /// Whether the pet is out, once Willow has said; the strip's paw is hidden until then.
    pet: Option<bool>,
    frame: Option<Frame>,
    /// Whether the window is the one in front; behind another, the window buttons go grey.
    focused: bool,
    menu: Option<String>,
    mnemonics: bool,
    mac_buttons: bool,
    /// Where the page can go in its history: the strip's back and forward.
    back: bool,
    forward: bool,
    panel_tabs: Option<PanelTabs>,
}

#[derive(Serialize, Deserialize, Default)]
struct Saved {
    /// Where the page was, so it opens there again.
    #[serde(default)]
    url: Option<String>,
    /// So the strip opens in the frame's colour, and with the window buttons Labs chose,
    /// before Willow's page has loaded.
    #[serde(default)]
    frame: Option<Frame>,
    #[serde(default)]
    mac_buttons: bool,
    /// A file written while the window had tabs lists them; the page opens where the one in
    /// front was.
    #[serde(default, skip_serializing)]
    tabs: Vec<SavedTab>,
    #[serde(default, skip_serializing)]
    active: usize,
}

#[derive(Deserialize)]
struct SavedTab {
    url: String,
}

fn with_state<T>(app: &AppHandle, f: impl FnOnce(&mut State) -> T) -> T {
    let tabs = app.state::<Tabs>();
    let mut state = tabs.0.lock().unwrap();
    f(&mut state)
}

/// WebView2's arguments, for a webview the app adds to the window besides these two (the agent
/// tabs' browser, harness_preview.rs).
pub fn browser_args(app: &AppHandle) -> Option<String> {
    with_state(app, |state| state.setup.as_ref().and_then(|setup| setup.browser_args.clone()))
}

fn same_origin(url: &str, origin: &Url) -> bool {
    Url::parse(url).is_ok_and(|url| url.origin() == origin.origin())
}

/// Willow's own pages get the microphone (the composer's dictation, Live) without the webview
/// asking again under the system's prompt, and the folders the user picks for them in the folder
/// picker (its local folder) without the webview asking whether they may edit what was just
/// chosen. Anything else is left to the webview, which on Linux means no.
pub fn permission(webview: &Webview, kind: PermissionKind) -> PermissionResponse {
    if !matches!(kind, PermissionKind::Microphone | PermissionKind::FileSystemAccess) {
        return PermissionResponse::Default;
    }
    let Ok(url) = webview.url() else { return PermissionResponse::Default };
    let willow = with_state(webview.app_handle(), |state| {
        state.setup.as_ref().is_some_and(|setup| url.origin() == setup.origin.origin())
    });
    if willow {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Default
    }
}

/// The user's Willow is `com.willow.studio`. A build under any other identity is a test copy,
/// with its own data and none of the user's, so it says so in its title and its strip: a user
/// who sees it is not looking at their own Willow, and nothing they do there stays.
const IDENTIFIER: &str = "com.willow.studio";

fn test_copy(app: &AppHandle) -> Option<String> {
    let identifier = &app.config().identifier;
    (identifier != IDENTIFIER).then(|| identifier.clone())
}

/// The window, its strip, and Willow's page, which shows the loading page until Willow's
/// server answers and then opens where it was last time. All of it starts in the colours of the
/// theme Willow was last in.
pub fn open_window(app: &AppHandle, setup: ContentSetup, visible: bool) -> tauri::Result<()> {
    let test_copy = test_copy(app);
    let saved = load_saved(app, &setup.origin);
    let light = saved.frame.as_ref().is_some_and(|frame| frame.light);
    let builder = WindowBuilder::new(app, MAIN)
        .title(if test_copy.is_some() { "Willow (test copy)" } else { "Willow" })
        .inner_size(1280.0, 840.0)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .center()
        .visible(visible);
    // macOS keeps its traffic lights over the strip; elsewhere the strip draws the window controls.
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false).shadow(true);
    let builder = if mica() {
        builder.no_redirection_bitmap(true).theme(Some(theme(light)))
    } else {
        builder.background_color(page_color(light))
    };
    let window = builder.build()?;
    #[cfg(windows)]
    if mica() {
        apply_mica(&window);
    }

    let mut strip = WebviewBuilder::new(STRIP, WebviewUrl::App("tabs.html".into()))
        .transparent(mica())
        .initialization_script(format!(
            "window.__WILLOW_PLATFORM__ = {}; window.__WILLOW_FRAME__ = {}; window.__WILLOW_MAC_BUTTONS__ = {}; window.__WILLOW_TEST_COPY__ = {}; {}",
            serde_json::to_string(std::env::consts::OS).unwrap_or_default(),
            serde_json::to_string(&saved.frame).unwrap_or_else(|_| "null".into()),
            saved.mac_buttons,
            serde_json::to_string(&test_copy).unwrap_or_else(|_| "null".into()),
            material_script()
        ));
    if !mica() {
        strip = strip.background_color(strip_color(saved.frame.as_ref()));
    }
    if let Some(args) = &setup.browser_args {
        strip = strip.additional_browser_args(args);
    }
    let width = window.inner_size()?.to_logical::<f64>(window.scale_factor()?).width;
    window.add_child(strip, LogicalPosition::new(0.0, 0.0), LogicalSize::new(width, STRIP_HEIGHT))?;

    let url = with_state(app, |state| {
        let url = saved.url.unwrap_or_else(|| setup.origin.to_string());
        state.setup = Some(setup);
        state.frame = saved.frame;
        state.mac_buttons = saved.mac_buttons;
        state.page = Some(Page { url: url.clone(), back: false, forward: false });
        url
    });
    create_page(app, &url, light)?;
    #[cfg(windows)]
    crate::snap::install(app);
    layout(app);
    render(app);
    Ok(())
}

/// Willow's server answers: the page leaves the loading page for its address.
pub fn site_ready(app: &AppHandle) {
    let url = with_state(app, |state| {
        state.ready = true;
        state.page.as_ref().map(|page| page.url.clone())
    });
    if let (Some(webview), Some(Ok(url))) = (app.get_webview(PAGE), url.as_deref().map(Url::parse)) {
        let _ = webview.navigate(url);
    }
    render(app);
}

/// Gives Willow's page its webview, on the loading page unless Willow's server already answers.
fn create_page(app: &AppHandle, url: &str, light: bool) -> tauri::Result<()> {
    let Some((ready, scripts, browser_args, origin)) = with_state(app, |state| {
        let setup = state.setup.as_ref()?;
        Some((state.ready, setup.scripts.clone(), setup.browser_args.clone(), setup.origin.clone()))
    }) else {
        return Ok(());
    };
    let Some(window) = app.get_window(MAIN) else { return Ok(()) };
    // When the app answers Willow's pages, the page opens on the loading page and goes to its
    // address only once the webview can answer it (pages::install).
    #[cfg(windows)]
    let answered_here = crate::pages::active(app);
    #[cfg(not(windows))]
    let answered_here = false;
    let target = match Url::parse(url) {
        Ok(url) if ready && !answered_here => WebviewUrl::External(url),
        _ => WebviewUrl::App("index.html".into()),
    };
    // The loading page, and Willow's own first paint, draw the frame in the theme and colour
    // Willow was last in.
    let frame = with_state(app, |state| serde_json::to_string(&state.frame).unwrap_or_else(|_| "null".into()));
    let mut builder = WebviewBuilder::new(PAGE, target)
        .transparent(mica())
        .initialization_script(format!("window.__WILLOW_LIGHT__ = {light}; window.__WILLOW_FRAME__ = {frame};"));
    if !mica() {
        builder = builder.background_color(page_color(light));
    }
    for script in scripts {
        builder = builder.initialization_script(script);
    }
    if let Some(args) = &browser_args {
        builder = builder.additional_browser_args(args);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
    }
    #[cfg(windows)]
    let menu_origin = origin.clone();
    let popups = app.clone();
    builder = builder.on_new_window(move |url, features| new_window(&popups, &origin, url, features));
    let previews = app.clone();
    builder = builder.on_page_load(move |_, payload| {
        if matches!(payload.event(), PageLoadEvent::Started) {
            crate::harness_preview::page_loading(&previews);
            clear_panel_tabs(&previews);
        }
    });
    let (position, size) = content_bounds(app);
    let webview = window.add_child(builder, position, size)?;
    #[cfg(windows)]
    crate::menus::install(app, &webview, &menu_origin);
    // WebKitGTK has no getUserMedia until it is switched on, and dictation and Live record.
    #[cfg(target_os = "linux")]
    let _ = webview.with_webview(|platform| {
        use webkit2gtk::{SettingsExt, WebViewExt};
        if let Some(settings) = platform.inner().settings() {
            settings.set_enable_media_stream(true);
        }
    });
    #[cfg(windows)]
    if answered_here {
        crate::pages::install(app, &webview, Url::parse(url).ok().filter(|_| ready));
    }
    #[cfg(windows)]
    crate::snap::place(app);
    #[cfg(not(any(windows, target_os = "linux")))]
    let _ = webview;
    Ok(())
}

/// Willow's own pages open in its page, moved there by its router as a link inside it would
/// move it, so nothing it is running stops. Its files (`blob:`) and sized popups (sign-in
/// windows) get windows of their own; anything else opens in the user's browser.
fn new_window(app: &AppHandle, origin: &Url, url: Url, features: NewWindowFeatures) -> NewWindowResponse<Wry> {
    if features.size().is_some() {
        return NewWindowResponse::Allow;
    }
    if url.origin() == origin.origin() {
        if !matches!(url.scheme(), "http" | "https") {
            return NewWindowResponse::Allow;
        }
        let mut path = url.path().to_string();
        if let Some(query) = url.query() {
            path.push('?');
            path.push_str(query);
        }
        if let Some(fragment) = url.fragment() {
            path.push('#');
            path.push_str(fragment);
        }
        let path = serde_json::to_string(&path).unwrap_or_default();
        let app = app.clone();
        // Off WebView2's callback, which is still running while the page would take the script.
        thread::spawn(move || {
            if let Some(webview) = app.get_webview(PAGE) {
                let _ = webview.eval(format!("history.pushState(null, '', {path}); dispatchEvent(new PopStateEvent('popstate'));"));
            }
        });
        return NewWindowResponse::Deny;
    }
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
    NewWindowResponse::Deny
}

/// Where the page goes: everything below the strip.
fn content_bounds(app: &AppHandle) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let window = app.get_window(MAIN);
    let size = window.as_ref().and_then(|window| window.inner_size().ok()).unwrap_or(PhysicalSize::new(1280, 840));
    let scale = window.as_ref().and_then(|window| window.scale_factor().ok()).unwrap_or(1.0);
    let strip = ((STRIP_HEIGHT * scale).round() as u32).min(size.height);
    (PhysicalPosition::new(0, strip as i32), PhysicalSize::new(size.width, size.height - strip))
}

/// Fits the strip and the page to the window. Called on every resize.
pub fn layout(app: &AppHandle) {
    let Some(window) = app.get_window(MAIN) else { return };
    let Ok(size) = window.inner_size() else { return };
    if size.width == 0 || size.height == 0 {
        return;
    }
    let (position, content) = content_bounds(app);
    let rect = |position: PhysicalPosition<i32>, size: PhysicalSize<u32>| Rect { position: Position::Physical(position), size: Size::Physical(size) };
    if let Some(strip) = app.get_webview(STRIP) {
        let _ = strip.set_bounds(rect(PhysicalPosition::new(0, 0), PhysicalSize::new(size.width, position.y as u32)));
    }
    if let Some(page) = app.get_webview(PAGE) {
        let _ = page.set_bounds(rect(position, content));
    }
    #[cfg(windows)]
    crate::snap::place(app);
}

/// Puts keyboard focus in the page on show.
pub fn focus_page(app: &AppHandle) {
    if let Some(webview) = app.get_webview(PAGE) {
        let _ = webview.set_focus();
    }
}

fn snapshot(app: &AppHandle) -> Snapshot {
    let maximized = app.get_window(MAIN).and_then(|window| window.is_maximized().ok()).unwrap_or(false);
    let pet = crate::pets::paw(app);
    let focused = window_active(app);
    with_state(app, |state| {
        let (back, forward) = state.page.as_ref().map_or((false, false), |page| (page.back, page.forward));
        Snapshot {
            maximized,
            pet,
            frame: state.frame.clone(),
            focused,
            menu: state.menu.clone(),
            mnemonics: state.mnemonics,
            mac_buttons: state.mac_buttons,
            back,
            forward,
            panel_tabs: state.panel_tabs.clone(),
        }
    })
}

/// Whether the strip shows Labs' macOS window buttons rather than Windows' (snap.rs follows it).
pub fn mac_buttons(app: &AppHandle) -> bool {
    with_state(app, |state| state.mac_buttons)
}

/// Redraws the strip.
pub fn render(app: &AppHandle) {
    let json = serde_json::to_string(&snapshot(app)).unwrap_or_default();
    if let Some(strip) = app.get_webview(STRIP) {
        let _ = strip.eval(format!("window.willowTabs && window.willowTabs.render({json})"));
    }
}

fn saved_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("tabs.json"))
}

fn persist(app: &AppHandle) {
    let saved = with_state(app, |state| {
        let origin = state.setup.as_ref()?.origin.clone();
        Some(Saved {
            url: state.page.as_ref().map(|page| page.url.clone()).filter(|url| same_origin(url, &origin)),
            frame: state.frame.clone(),
            mac_buttons: state.mac_buttons,
            ..Saved::default()
        })
    });
    if let (Some(saved), Some(path)) = (saved, saved_path(app)) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(path, serde_json::to_string_pretty(&saved).unwrap_or_default());
    }
}

fn load_saved(app: &AppHandle, origin: &Url) -> Saved {
    let mut saved: Saved = saved_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let listed = saved.tabs.get(saved.active).map(|tab| tab.url.clone());
    saved.url = saved.url.take().or(listed).filter(|url| same_origin(url, origin));
    saved.frame = saved.frame.filter(|frame| is_hex_color(&frame.color));
    saved
}

/* Commands. Async, so a command that makes a webview runs off the main thread: a synchronous
   one would make the webview from inside the IPC handler and deadlock on Windows. */

#[tauri::command]
pub async fn tabs_snapshot(app: AppHandle) -> Snapshot {
    snapshot(&app)
}

/// Where the page is, as Willow's router moves it, and where its history can go from there:
/// back and forward among Willow's own pages (the Navigation API's, which leaves out the loading
/// page it starts on), for the strip's arrows.
#[tauri::command]
pub async fn tab_report(app: AppHandle, webview: Webview, url: String, back: Option<bool>, forward: Option<bool>) {
    if webview.label() != PAGE {
        return;
    }
    let (moved, history) = with_state(&app, |state| {
        let origin = state.setup.as_ref().map(|setup| setup.origin.clone());
        let Some(page) = state.page.as_mut() else { return (false, false) };
        let moved = origin.is_some_and(|origin| same_origin(&url, &origin)) && page.url != url;
        if moved {
            page.url = url;
        }
        let history = match (back, forward) {
            (Some(back), Some(forward)) if (back, forward) != (page.back, page.forward) => {
                page.back = back;
                page.forward = forward;
                true
            }
            _ => false,
        };
        (moved, history)
    });
    if moved {
        persist(&app);
    }
    if history {
        render(&app);
    }
}

/// The strip's back (`-1`) and forward (`1`): the page goes through its own history.
#[tauri::command]
pub async fn tab_history(app: AppHandle, step: i32) {
    if let Some(webview) = app.get_webview(PAGE) {
        let _ = webview.eval(if step < 0 { "history.back()" } else { "history.forward()" });
    }
}

/// File → Close (Ctrl+W), as the window's own close button: Willow goes on in the tray.
#[tauri::command]
pub async fn window_close(app: AppHandle) -> Result<(), String> {
    let window = app.get_window(MAIN).ok_or("Willow's window is not open")?;
    window.close().map_err(|error| error.to_string())
}

/// The frame's shell colour (`#rrggbb`) as Willow's page draws it; the strip takes it on, and
/// the window and both webviews keep its theme's colours where nothing is drawn yet.
#[tauri::command]
pub async fn tab_frame(app: AppHandle, color: String, light: bool) -> Result<(), String> {
    if !is_hex_color(&color) {
        return Err(format!("{color} is not a #rrggbb colour"));
    }
    let frame = Frame { color: color.to_ascii_lowercase(), light };
    let strip = strip_color(Some(&frame));
    let frame = Some(frame);
    let (changed, theme_changed) = with_state(&app, |state| {
        let changed = state.frame != frame;
        let theme_changed = state.frame.as_ref().map(|frame| frame.light) != Some(light);
        state.frame = frame;
        (changed, theme_changed)
    });
    if !changed {
        return Ok(());
    }
    if mica() {
        if let (true, Some(window)) = (theme_changed, app.get_window(MAIN)) {
            let _ = window.set_theme(Some(theme(light)));
        }
    } else {
        if let Some(webview) = app.get_webview(STRIP) {
            let _ = webview.set_background_color(Some(strip));
        }
        if theme_changed {
            if let Some(webview) = app.get_webview(PAGE) {
                let _ = webview.set_background_color(Some(page_color(light)));
            }
            if let Some(window) = app.get_window(MAIN) {
                let _ = window.set_background_color(Some(page_color(light)));
            }
        }
    }
    persist(&app);
    render(&app);
    Ok(())
}

/// Labs' "macOS window buttons", as Willow's page has it: the strip draws them at its left in
/// place of Windows' caption buttons, and the snap-layouts window moves to their green one.
#[tauri::command]
pub async fn window_buttons(app: AppHandle, mac: bool) {
    if !with_state(&app, |state| std::mem::replace(&mut state.mac_buttons, mac) != mac) {
        return;
    }
    persist(&app);
    render(&app);
    #[cfg(windows)]
    crate::snap::place(&app);
}

/// Opens one of the strip's menus, or closes it (`None`). The strip has no room below its
/// 40px, so the page draws the menu (AppMenu in Willow's page), `left` device pixels in, under
/// the strip's button; the strip and the page both open and close it through here.
#[tauri::command]
pub async fn menu_open(app: AppHandle, menu: Option<String>, left: Option<f64>) {
    let menu = menu.filter(|menu| MENUS.contains(&menu.as_str()));
    let changed = with_state(&app, |state| {
        let changed = state.menu != menu;
        state.menu = menu.clone();
        changed
    });
    if let Some(webview) = app.get_webview(PAGE) {
        // An open menu has the keyboard, as Codex's does, for its arrows, Enter and Esc.
        if menu.is_some() {
            let _ = webview.set_focus();
        }
        let message = serde_json::json!({ "kind": "app-menu", "menu": menu, "left": left.unwrap_or(0.0) });
        let _ = webview.eval(format!("window.__WILLOW_DESKTOP__ && window.__WILLOW_DESKTOP__.receive({message})"));
    }
    if changed {
        render(&app);
    }
}

/// One of the strip's tooltips, or none: the page draws it as Willow's own under the button that
/// spans `left` to `right` device pixels of the strip (StripTooltip in Willow's page), for the
/// same want of room as the menus.
#[tauri::command]
pub async fn strip_tooltip(app: AppHandle, text: Option<String>, left: f64, right: f64) {
    if let Some(webview) = app.get_webview(PAGE) {
        let message = serde_json::json!({ "kind": "strip-tooltip", "text": text, "left": left, "right": right });
        let _ = webview.eval(format!("window.__WILLOW_DESKTOP__ && window.__WILLOW_DESKTOP__.receive({message})"));
    }
}

/// The agents' side panel's tabs, or none, from Willow's page: the strip draws them over the panel.
#[tauri::command]
pub async fn strip_panel_tabs(app: AppHandle, webview: Webview, tabs: Option<PanelTabs>) {
    if webview.label() != PAGE {
        return;
    }
    let tabs = tabs.and_then(PanelTabs::sanitized);
    let changed = with_state(&app, |state| {
        let changed = state.panel_tabs != tabs;
        state.panel_tabs = tabs;
        changed
    });
    if changed {
        render(&app);
    }
}

/// A panel tab chosen, closed or right-clicked in the strip, or its + pressed. The page acts on
/// it and draws what opens (the + menu, the tab's menu) under the strip, `left` to `right`
/// device pixels, for the same want of room as the menus.
#[tauri::command]
pub async fn panel_tab(app: AppHandle, webview: Webview, action: String, id: Option<String>, left: Option<f64>, right: Option<f64>) {
    if webview.label() != STRIP || !["select", "close", "add", "menu"].contains(&action.as_str()) {
        return;
    }
    if let Some(page) = app.get_webview(PAGE) {
        // What the strip opens has the keyboard there, and a chosen tab leaves it to the page.
        if action != "close" {
            let _ = page.set_focus();
        }
        let message = serde_json::json!({
            "kind": "panel-tab",
            "action": action,
            "id": id,
            "left": left.unwrap_or(0.0),
            "right": right.unwrap_or(0.0),
        });
        let _ = page.eval(format!("window.__WILLOW_DESKTOP__ && window.__WILLOW_DESKTOP__.receive({message})"));
    }
}

/// Willow's page started loading: the tabs it handed the strip go with it.
pub fn clear_panel_tabs(app: &AppHandle) {
    if with_state(app, |state| state.panel_tabs.take().is_some()) {
        render(app);
    }
}

/// Alt+F, Alt+E, Alt+V or F10 in a page: the strip opens the menu under its own button.
#[tauri::command]
pub async fn menu_key(app: AppHandle, menu: String) {
    if !MENUS.contains(&menu.as_str()) {
        return;
    }
    if let Some(strip) = app.get_webview(STRIP) {
        let _ = strip.eval(format!("window.willowTabs && window.willowTabs.openMenu({})", serde_json::to_string(&menu).unwrap_or_default()));
    }
}

/// Alt held or let go, wherever the keyboard is: the menus' names underline their access keys.
#[tauri::command]
pub async fn menu_mnemonics(app: AppHandle, shown: bool) {
    if with_state(&app, |state| std::mem::replace(&mut state.mnemonics, shown) != shown) {
        render(&app);
    }
}

/// The Edit menu's commands and the View menu's zoom, as their keys, to the page that has the
/// keyboard: it then does what it does for them, its own undo and paste included, as it would
/// for a native menu's.
#[tauri::command]
pub async fn menu_keys(app: AppHandle, webview: Webview, action: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VK_DELETE, VK_OEM_MINUS, VK_OEM_PLUS};
        // Keys go to whichever window is in front: never press them into another app's.
        if !window_active(&app) {
            return Err("Willow is not the window in front".into());
        }
        let (ctrl, key) = match action.as_str() {
            "undo" => (true, u16::from(b'Z')),
            "redo" => (true, u16::from(b'Y')),
            "cut" => (true, u16::from(b'X')),
            "copy" => (true, u16::from(b'C')),
            "paste" => (true, u16::from(b'V')),
            "delete" => (false, VK_DELETE),
            "selectAll" => (true, u16::from(b'A')),
            "zoomIn" => (true, VK_OEM_PLUS),
            "zoomOut" => (true, VK_OEM_MINUS),
            "zoomReset" => (true, u16::from(b'0')),
            _ => return Err(format!("{action} is not a menu command")),
        };
        let _ = webview.set_focus();
        press(ctrl, key);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, webview, action);
        Err("menu keys are the page's own here".into())
    }
}

#[cfg(windows)]
fn press(ctrl: bool, key: u16) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VK_CONTROL, VK_DELETE,
    };
    let input = |vk: u16, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: (if up { KEYEVENTF_KEYUP } else { 0 }) | (if vk == VK_DELETE { KEYEVENTF_EXTENDEDKEY } else { 0 }),
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let mut inputs = Vec::with_capacity(4);
    if ctrl {
        inputs.push(input(VK_CONTROL, false));
    }
    inputs.push(input(key, false));
    inputs.push(input(key, true));
    if ctrl {
        inputs.push(input(VK_CONTROL, true));
    }
    // SAFETY: initialised INPUTs, as many as SendInput is told, each of the size it is told.
    unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
}

/// View → Toggle Full Screen (F11).
#[tauri::command]
pub async fn window_fullscreen(app: AppHandle) -> Result<(), String> {
    let window = app.get_window(MAIN).ok_or("Willow's window is not open")?;
    let full = window.is_fullscreen().map_err(|error| error.to_string())?;
    window.set_fullscreen(!full).map_err(|error| error.to_string())
}

/// For Willow's pages: the window's shortcuts, and where the page is as Willow's router moves it.
/// Main frame of Willow's own origin only.
pub fn page_script(origin: &Url) -> String {
    let origin = serde_json::to_string(&origin.origin().ascii_serialization()).unwrap_or_default();
    format!(
        r#"(() => {{
  if (window.location.origin !== {origin} || window.top !== window) return;
  const invoke = (command, args) => window.__TAURI_INTERNALS__?.invoke(command, args).catch(() => undefined);
  const mac = /Mac/.test(navigator.platform);
  // Close (Ctrl+W, and Ctrl+F4 on Windows, as Codex has it), and back and forward.
  window.addEventListener('keydown', (event) => {{
    if (event.altKey || event.shiftKey || !(mac ? event.metaKey : event.ctrlKey)) return;
    if (event.key.toLowerCase() === 'w' || (!mac && event.key === 'F4')) invoke('window_close');
    else if (event.key === '[') history.back();
    else if (event.key === ']') history.forward();
    else return;
    event.preventDefault(); event.stopImmediatePropagation();
  }}, true);
  // The strip's menus (Willow's AppMenu draws them here): Alt held underlines their access keys,
  // Alt+F, Alt+E, Alt+V or F10 opens one, and Quit (Ctrl+Q) and F11 work from anywhere.
  // macOS has its own menus.
  if (!mac) {{
    const menus = {{ f: 'file', e: 'edit', v: 'view' }};
    let alt = false;
    const mnemonics = (shown) => {{ if (alt !== shown) {{ alt = shown; invoke('menu_mnemonics', {{ shown }}); }} }};
    window.addEventListener('keydown', (event) => {{
      if (event.key === 'Alt' && !event.ctrlKey && !event.shiftKey) {{ if (!event.repeat) mnemonics(true); return; }}
      mnemonics(false);
      const menu = event.altKey && !event.ctrlKey && !event.shiftKey && menus[event.key.toLowerCase()];
      if (menu || (event.key === 'F10' && !event.altKey && !event.ctrlKey && !event.shiftKey)) invoke('menu_key', {{ menu: menu || 'file' }});
      else if (event.key === 'F11' && !event.altKey && !event.ctrlKey) invoke('window_fullscreen');
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'q') invoke('app_quit');
      else return;
      event.preventDefault(); event.stopImmediatePropagation();
    }}, true);
    window.addEventListener('keyup', (event) => {{ if (event.key === 'Alt') mnemonics(false); }}, true);
    window.addEventListener('blur', () => mnemonics(false));
  }}
  // Where the page is, and where the strip's back and forward can take it: the Navigation API
  // counts this origin's entries only, so never the loading page the page came from.
  const report = () => invoke('tab_report', {{
    url: window.location.href,
    back: window.navigation?.canGoBack ?? null,
    forward: window.navigation?.canGoForward ?? null,
  }});
  window.navigation?.addEventListener('currententrychange', () => queueMicrotask(report));
  for (const method of ['pushState', 'replaceState']) {{
    const original = history[method];
    history[method] = function (...args) {{ const result = original.apply(this, args); queueMicrotask(report); return result; }};
  }}
  window.addEventListener('popstate', report);
  window.addEventListener('hashchange', report);
  document.addEventListener('DOMContentLoaded', report);
}})();"#
    )
}
