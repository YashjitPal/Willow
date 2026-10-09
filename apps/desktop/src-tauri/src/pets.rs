//! Pets: the desktop half of Willow's pet (`features/spark/src/pets`).
//!
//! The pet stands on the desktop, in a transparent always-on-top window over a
//! display's work area — `shell/overlay.html`, a blank page that is handed a
//! surface (a function's source, its styles and its data) by the Willow page
//! that opened it, and talks back through here. Everything in this module is
//! the host side of BetterGravity's `plugin.overlay` and `plugin.pets`, which the
//! pet was written against:
//!
//! - **The overlay.** Click-through except over what the surface drew (it says
//!   so with `setInteractive`), focusable only while it is being typed into, fed
//!   the cursor every 25 ms because a click-through window hears no pointer
//!   moves, carried to the display under the cursor while the pet is dragged,
//!   and given a native context menu.
//! - **The library.** Pets live in `Pets/<id>/pet.json` and a 1536 × 2288 sprite
//!   sheet in the Willow folder (`local_folder.rs`); `Pets/.hatching/<run>/progress.json`
//!   is a creation and its working files. Pages are told when anything there changes.
//! - **The routing.** Messages from the pet go to the page that opened it; the
//!   strip's paw goes to the page running the pet's sensor.

use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, Webview, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

use crate::tabs;

pub const OVERLAY: &str = "overlay";
const POINTER_INTERVAL: Duration = Duration::from_millis(25);
/// A stationary cursor is re-sent this often, which repairs state lost to a focus change.
const POINTER_REPEAT: Duration = Duration::from_millis(250);
/// How long the overlay page has to run its surface before the window is given up on.
const ATTACH_TIMEOUT: Duration = Duration::from_secs(3);
const MENU_PREFIX: &str = "overlay-menu\u{1f}";

const SHEET_WIDTH: u32 = 1536;
const SHEET_HEIGHT: u32 = 2288;
const MAX_JSON_BYTES: u64 = 64 * 1024;
const MAX_IMAGE_BYTES: u64 = 12 * 1024 * 1024;
const MAX_PACKAGES: usize = 100;
const STAGES: [&str; 6] = ["preparing", "imagining", "posing", "hatching", "ready", "error"];

#[derive(Default)]
pub struct Pets(Mutex<State>);

#[derive(Default)]
struct State {
    live: Option<Live>,
    generation: u64,
    /// The page running the pet's sensor, as it last said.
    sensor: Option<String>,
    /// Whether the pet is out, as the sensor last reported it: the strip's paw.
    shown: Option<bool>,
    browser_args: Option<String>,
}

struct Live {
    generation: u64,
    /// The page that opened the overlay, which hears everything the surface says.
    owner: String,
    surface: Option<Surface>,
    attached: bool,
    interactive: bool,
    focusable: bool,
    dragging: bool,
    area: Area,
    scale: f64,
}

/// A display's work area, in physical pixels.
#[derive(Clone, Copy, PartialEq)]
struct Area {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Area {
    fn of(monitor: &Monitor) -> Self {
        let area = monitor.work_area();
        Area { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height }
    }

    fn bounds(self, scale: f64) -> Bounds {
        Bounds {
            x: self.x as f64 / scale,
            y: self.y as f64 / scale,
            width: self.width as f64 / scale,
            height: self.height as f64 / scale,
            scale_factor: scale,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Surface {
    script: String,
    #[serde(default)]
    styles: String,
    #[serde(default)]
    data: Value,
}

#[derive(Deserialize)]
pub struct OpenRequest {
    #[serde(flatten)]
    surface: Surface,
    /// `primary` (the default) or `cursor`.
    #[serde(default)]
    display: Option<String>,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale_factor: f64,
}

#[derive(Serialize)]
pub struct OverlayStatus {
    open: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    bounds: Option<Bounds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn refused(message: &str) -> OverlayStatus {
    OverlayStatus { open: false, bounds: None, message: Some(message.to_string()) }
}

fn with_state<T>(app: &AppHandle, f: impl FnOnce(&mut State) -> T) -> T {
    let pets = app.state::<Pets>();
    let mut state = pets.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut state)
}

/// Remembers WebView2's arguments (every webview must share them), watches the
/// library, and routes context-menu choices back to the pet.
pub fn setup(app: &AppHandle, browser_args: Option<String>) {
    with_state(app, |state| state.browser_args = browser_args);
    app.on_menu_event(|app, event| menu_chosen(app, event.id().as_ref()));
    watch_library(app.clone());
}

/* ── Delivery ───────────────────────────────────────────────────────────── */

/// Hands a message to a Willow page, through `window.__WILLOW_DESKTOP__` (platform/core desktop-bridge.ts).
fn to_page(app: &AppHandle, label: &str, message: &Value) {
    if let Some(webview) = app.get_webview(label) {
        let _ = webview.eval(format!("window.__WILLOW_DESKTOP__ && window.__WILLOW_DESKTOP__.receive({message})"));
    }
}

fn to_overlay(app: &AppHandle, message: &Value) {
    if let Some(window) = app.get_webview_window(OVERLAY) {
        let _ = window.eval(format!("window.__willowOverlay && window.__willowOverlay.receive({message})"));
    }
}

/* ── The overlay ────────────────────────────────────────────────────────── */

fn display_for(app: &AppHandle, which: Option<&str>) -> Option<Monitor> {
    if which == Some("cursor") {
        if let Some((x, y)) = cursor(app) {
            if let Ok(Some(monitor)) = app.monitor_from_point(x, y) {
                return Some(monitor);
            }
        }
    }
    app.primary_monitor().ok().flatten().or_else(|| app.available_monitors().ok()?.into_iter().next())
}

/// Opens the overlay for `owner`, replacing any left open. One at a time: stacked
/// transparent always-on-top windows are not something a user can reason about.
fn open(app: &AppHandle, owner: &str, request: OpenRequest) -> OverlayStatus {
    close(app);
    // Destroying is asynchronous: until the old window is gone its label is still taken.
    let deadline = Instant::now() + Duration::from_secs(2);
    while app.get_webview_window(OVERLAY).is_some() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    if request.surface.script.is_empty() {
        return refused("An overlay needs a script to run.");
    }
    let Some(monitor) = display_for(app, request.display.as_deref()) else {
        return refused("There is no display to open the overlay on.");
    };
    let area = Area::of(&monitor);
    let scale = monitor.scale_factor();
    let (generation, browser_args) = with_state(app, |state| {
        state.generation += 1;
        (state.generation, state.browser_args.clone())
    });

    let logical = area.bounds(scale);
    let mut builder = WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("overlay.html".into()))
        .title("Willow pet")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        // Not Willow's child: a parent would take the pet with it when Willow is minimised.
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .position(logical.x, logical.y)
        .inner_size(logical.width, logical.height)
        .on_navigation(|url| url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"));
    if let Some(args) = &browser_args {
        builder = builder.additional_browser_args(args);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
    }
    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => return refused(&format!("The overlay window could not be created: {error}")),
    };
    // Physical, so a display at another scale than the one the window was made on cannot round it.
    let _ = window.set_position(PhysicalPosition::new(area.x, area.y));
    let _ = window.set_size(PhysicalSize::new(area.width, area.height));
    let _ = window.set_ignore_cursor_events(true);

    with_state(app, |state| {
        state.live = Some(Live {
            generation,
            owner: owner.to_string(),
            surface: Some(request.surface),
            attached: false,
            interactive: false,
            focusable: false,
            dragging: false,
            area,
            scale,
        });
    });
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(ATTACH_TIMEOUT);
        let stale = with_state(&app, |state| state.live.as_ref().is_some_and(|live| live.generation == generation && !live.attached));
        if stale {
            close(&app);
        }
    });
    OverlayStatus { open: true, bounds: Some(logical), message: None }
}

pub fn close(app: &AppHandle) {
    with_state(app, |state| {
        state.live = None;
        state.generation += 1;
    });
    if let Some(window) = app.get_webview_window(OVERLAY) {
        let _ = window.destroy();
    }
}

fn attached(app: &AppHandle) {
    let generation = with_state(app, |state| {
        let live = state.live.as_mut().filter(|live| !live.attached)?;
        live.attached = true;
        Some(live.generation)
    });
    let Some(generation) = generation else { return };
    // Not focusable, so this shows it without taking focus from anything.
    if let Some(window) = app.get_webview_window(OVERLAY) {
        let _ = window.show();
    }
    track_pointer(app.clone(), generation);
}

/// The cursor, in physical screen pixels.
#[cfg(windows)]
fn cursor(_app: &AppHandle) -> Option<(f64, f64)> {
    use windows_sys::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};
    let mut point = POINT { x: 0, y: 0 };
    // SAFETY: GetCursorPos writes one POINT, which is all `point` is.
    (unsafe { GetCursorPos(&mut point) } != 0).then_some((point.x as f64, point.y as f64))
}

#[cfg(not(windows))]
fn cursor(app: &AppHandle) -> Option<(f64, f64)> {
    app.cursor_position().ok().map(|position| (position.x, position.y))
}

/// Feeds the surface the cursor while the window is click-through, follows the
/// cursor to another display while the pet is being dragged, and keeps the
/// window on its display's work area as taskbars and resolutions change.
fn track_pointer(app: AppHandle, generation: u64) {
    thread::spawn(move || {
        let mut previous: Option<(f64, f64, Instant)> = None;
        let mut checked = Instant::now();
        loop {
            thread::sleep(POINTER_INTERVAL);
            let Some((mut area, mut scale, dragging)) =
                with_state(&app, |state| state.live.as_ref().filter(|live| live.generation == generation).map(|live| (live.area, live.scale, live.dragging)))
            else {
                return;
            };
            let Some((cx, cy)) = cursor(&app) else { continue };

            let target = if dragging || checked.elapsed() > Duration::from_secs(2) {
                checked = Instant::now();
                let probe = if dragging { (cx, cy) } else { (area.x as f64 + 1.0, area.y as f64 + 1.0) };
                app.monitor_from_point(probe.0, probe.1).ok().flatten().map(|monitor| (Area::of(&monitor), monitor.scale_factor()))
            } else {
                None
            };
            if let Some((next, next_scale)) = target.filter(|(next, _)| *next != area) {
                if let Some(window) = app.get_webview_window(OVERLAY) {
                    let _ = window.set_position(PhysicalPosition::new(next.x, next.y));
                    let _ = window.set_size(PhysicalSize::new(next.width, next.height));
                }
                with_state(&app, |state| {
                    if let Some(live) = state.live.as_mut().filter(|live| live.generation == generation) {
                        live.area = next;
                        live.scale = next_scale;
                    }
                });
                let moved_display = dragging;
                area = next;
                scale = next_scale;
                if moved_display {
                    let bounds = Bounds { x: 0.0, y: 0.0, ..area.bounds(scale) };
                    to_overlay(
                        &app,
                        &json!({
                            "type": "bettergravity:overlay-display-switched",
                            "bounds": bounds,
                            "cursorX": (cx - area.x as f64) / scale,
                            "cursorY": (cy - area.y as f64) / scale,
                        }),
                    );
                }
            }

            let x = (cx - area.x as f64) / scale;
            let y = (cy - area.y as f64) / scale;
            let now = Instant::now();
            if previous.is_some_and(|(px, py, at)| px == x && py == y && now.duration_since(at) < POINTER_REPEAT) {
                continue;
            }
            previous = Some((x, y, now));
            to_overlay(&app, &json!({ "type": "bettergravity:overlay-pointer", "x": x, "y": y }));
        }
    });
}

/// Solid while the cursor is over the surface; focusable while it is typed into —
/// and, on Windows, while it is solid, or a click there can be lost while another
/// application is in front.
fn apply_input(app: &AppHandle) {
    let Some((interactive, focusable)) = with_state(app, |state| state.live.as_ref().map(|live| (live.interactive, live.focusable))) else {
        return;
    };
    let Some(window) = app.get_webview_window(OVERLAY) else { return };
    let _ = window.set_ignore_cursor_events(!interactive);
    let _ = window.set_focusable(focusable || (cfg!(windows) && interactive));
}

fn set_interactive(app: &AppHandle, interactive: bool) {
    let changed = with_state(app, |state| {
        let live = state.live.as_mut()?;
        (live.interactive != interactive).then(|| live.interactive = interactive)
    });
    if changed.is_some() {
        apply_input(app);
    }
}

fn set_focusable(app: &AppHandle, focusable: bool) {
    let changed = with_state(app, |state| {
        let live = state.live.as_mut()?;
        (live.focusable != focusable).then(|| live.focusable = focusable)
    });
    if changed.is_none() {
        return;
    }
    apply_input(app);
    if focusable {
        if let Some(window) = app.get_webview_window(OVERLAY) {
            let _ = window.set_focus();
        }
    }
}

/// Everything the surface says. What the host acts on stays here; the rest is the page's.
fn from_overlay(app: &AppHandle, message: Value) {
    match message.get("type").and_then(Value::as_str) {
        Some("bettergravity:overlay-drag-state") => {
            let dragging = message.get("dragging").and_then(Value::as_bool) == Some(true);
            with_state(app, |state| {
                if let Some(live) = state.live.as_mut() {
                    live.dragging = dragging;
                }
            });
        }
        Some("bettergravity:overlay-context-menu") => show_menu(app, &message),
        Some("willow:overlay-focus-owner") => crate::show_main(app),
        _ => {
            if let Some(owner) = with_state(app, |state| state.live.as_ref().map(|live| live.owner.clone())) {
                to_page(app, &owner, &json!({ "kind": "overlay", "message": message }));
            }
        }
    }
}

/// A surface's plain actions, in the same native popup as the rest of the app.
fn show_menu(app: &AppHandle, request: &Value) {
    let Some(request_id) = request.get("requestId").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 128) else {
        return;
    };
    let items: Vec<(&str, &str)> = request
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(32)
                .filter_map(|item| Some((item.get("id")?.as_str()?, item.get("label")?.as_str()?)))
                .filter(|(id, label)| (1..=128).contains(&id.len()) && (1..=200).contains(&label.len()))
                .collect()
        })
        .unwrap_or_default();
    let Some(window) = app.get_webview_window(OVERLAY) else { return };
    let Ok(menu) = Menu::new(app) else { return };
    for (id, label) in items {
        if let Ok(item) = MenuItem::with_id(app, format!("{MENU_PREFIX}{request_id}\u{1f}{id}"), label, true, None::<&str>) {
            let _ = menu.append(&item);
        }
    }
    if menu.items().map(|items| items.is_empty()).unwrap_or(true) {
        return;
    }
    let _ = window.popup_menu(&menu);
}

fn menu_chosen(app: &AppHandle, id: &str) {
    let Some(rest) = id.strip_prefix(MENU_PREFIX) else { return };
    let Some((request_id, item)) = rest.split_once('\u{1f}') else { return };
    to_overlay(app, &json!({ "type": "bettergravity:overlay-context-menu-result", "requestId": request_id, "id": item }));
}

/* ── The library ────────────────────────────────────────────────────────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetRecord {
    id: String,
    display_name: String,
    description: String,
    sprite_version_number: u8,
    /// Changes whenever the manifest or the sheet does, so a page can cache what it drew from them.
    stamp: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetSprite {
    #[serde(flatten)]
    record: PetRecord,
    spritesheet_data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreationRun {
    id: String,
    name: String,
    stage: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pet_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview_data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryState {
    enabled: bool,
    directory: String,
    skill_path: Option<String>,
    pets: Vec<PetRecord>,
    runs: Vec<CreationRun>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Creation {
    skill_path: String,
    directory: String,
}

/// `Pets` in the Willow folder, beside the chats and projects, so a pet travels with the folder and
/// a reinstall finds it.
fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::local_folder::folder(app).ok_or("Willow could not find your Willow folder.")?.join("Pets");
    fs::create_dir_all(dir.join(".hatching")).map_err(|error| format!("The pet library could not be created: {error}"))?;
    static MOVED: std::sync::Once = std::sync::Once::new();
    MOVED.call_once(|| move_old_library(app, &dir));
    Ok(dir)
}

/// The library before it moved: `pets` in the app's data directory. Each pet and creation there
/// moves over once; one whose name the Willow folder already has stays where it was.
fn move_old_library(app: &AppHandle, library: &Path) {
    let Ok(old) = app.path().app_data_dir().map(|dir| dir.join("pets")) else { return };
    if !old.is_dir() {
        return;
    }
    for (from, to) in [(old.clone(), library.to_path_buf()), (old.join(".hatching"), library.join(".hatching"))] {
        for id in directories(&from) {
            let (source, target) = (from.join(&id), to.join(&id));
            if target.exists() {
                continue;
            }
            if fs::rename(&source, &target).is_ok() {
                continue;
            }
            // Another drive: copied, then removed; a copy that fails leaves no half package behind.
            match copy_tree(&source, &target) {
                Ok(()) => {
                    let _ = fs::remove_dir_all(&source);
                }
                Err(_) => {
                    let _ = fs::remove_dir_all(&target);
                }
            }
        }
    }
    // Only folders left empty go: anything else stays for the user to see.
    let _ = fs::remove_dir(old.join(".hatching"));
    let _ = fs::remove_dir(&old);
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// The Hatch Pet skill: staged beside Willow's server, or the repository's copy in development.
fn skill_file(app: &AppHandle) -> Option<PathBuf> {
    let file = crate::payload_root(app).ok()?.join("features/spark/src/pets/hatch-pet/SKILL.md");
    file.exists().then_some(file)
}

/// Lowercase words joined by single hyphens: the only folder names that are pets.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.split('-').all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit()))
}

fn directories(root: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(root)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .filter_map(|entry| entry.file_name().into_string().ok())
                .filter(|name| valid_id(name))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// A file inside `base`, refusing paths and links that lead out of it.
fn beneath(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.is_empty() || relative.contains('\0') || path.is_absolute() || path.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err("A pet file escapes its package.".into());
    }
    let real_base = fs::canonicalize(base).map_err(|error| error.to_string())?;
    let real = fs::canonicalize(base.join(path)).map_err(|_| format!("{relative} is missing."))?;
    if !real.starts_with(&real_base) || real == real_base {
        return Err("A pet file links outside its package.".into());
    }
    Ok(real)
}

fn read_json(file: &Path) -> Result<serde_json::Map<String, Value>, String> {
    let size = fs::metadata(file).map_err(|error| error.to_string())?.len();
    if size > MAX_JSON_BYTES {
        return Err("The pet metadata is too large.".into());
    }
    let text = fs::read_to_string(file).map_err(|error| error.to_string())?;
    match serde_json::from_str::<Value>(&text).map_err(|error| error.to_string())? {
        Value::Object(map) => Ok(map),
        _ => Err("Expected a JSON object.".into()),
    }
}

fn modified_ms(metadata: &fs::Metadata) -> u128 {
    metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map_or(0, |duration| duration.as_millis())
}

/// Width and height from a PNG or WebP header, without decoding the image.
fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let le16 = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]) as u32;
    let le24 = |at: usize| u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], 0]);
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") && &bytes[12..16] == b"IHDR" {
        let be32 = |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
        return Some((be32(16), be32(20)));
    }
    if bytes.len() < 30 || !bytes.starts_with(b"RIFF") || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8 " if bytes[23..26] == [0x9d, 0x01, 0x2a] => Some((le16(26) & 0x3fff, le16(28) & 0x3fff)),
        b"VP8L" if bytes[20] == 0x2f => {
            let bits = u32::from_le_bytes([bytes[21], bytes[22], bytes[23], bytes[24]]);
            Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
        }
        b"VP8X" => Some((le24(24) + 1, le24(27) + 1)),
        _ => None,
    }
}

fn mime_of(file: &Path) -> Option<&'static str> {
    match file.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// An image a pet may use: a PNG or WebP of at most 12 MB.
fn check_image(file: &Path) -> Result<(&'static str, fs::Metadata), String> {
    let metadata = fs::metadata(file).map_err(|error| error.to_string())?;
    match mime_of(file) {
        Some(mime) if metadata.len() <= MAX_IMAGE_BYTES => Ok((mime, metadata)),
        _ => Err("Pets need a PNG or WebP image of at most 12 MB.".into()),
    }
}

fn header(file: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut bytes = vec![0; 32];
    let mut handle = fs::File::open(file).map_err(|error| error.to_string())?;
    let read = handle.read(&mut bytes).map_err(|error| error.to_string())?;
    bytes.truncate(read);
    Ok(bytes)
}

fn chars(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// A pet package, validated: its manifest, and the sheet it names.
fn load_record(library: &Path, id: &str) -> Result<(PetRecord, PathBuf, &'static str), String> {
    if !valid_id(id) {
        return Err("Invalid pet id.".into());
    }
    let folder = beneath(library, id)?;
    let manifest_file = beneath(&folder, "pet.json")?;
    let manifest = read_json(&manifest_file)?;
    let text = |key: &str| manifest.get(key).and_then(Value::as_str);
    let valid = text("id") == Some(id)
        && manifest.get("spriteVersionNumber").and_then(Value::as_u64) == Some(2)
        && text("displayName").is_some_and(|name| !name.trim().is_empty())
        && text("description").is_some()
        && text("spritesheetPath").is_some();
    if !valid {
        return Err("The pet needs a version 2 manifest with its id, name, description, and sprite sheet.".into());
    }
    let sheet = beneath(&folder, text("spritesheetPath").unwrap_or_default())?;
    let (mime, metadata) = check_image(&sheet)?;
    match image_size(&header(&sheet)?) {
        Some((SHEET_WIDTH, SHEET_HEIGHT)) => {}
        Some(_) => return Err("The version 2 sprite sheet must be 1536 × 2288 pixels.".into()),
        None => return Err("The pet image could not be decoded.".into()),
    }
    let manifest_metadata = fs::metadata(&manifest_file).map_err(|error| error.to_string())?;
    let record = PetRecord {
        id: id.to_string(),
        display_name: chars(text("displayName").unwrap_or_default().trim(), 100),
        description: chars(text("description").unwrap_or_default(), 500),
        sprite_version_number: 2,
        stamp: format!("{}:{}:{}", modified_ms(&manifest_metadata), modified_ms(&metadata), metadata.len()),
    };
    Ok((record, sheet, mime))
}

fn data_url(file: &Path, mime: &str) -> Result<String, String> {
    let bytes = fs::read(file).map_err(|error| error.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn read_library(app: &AppHandle) -> LibraryState {
    let skill_path = skill_file(app).map(|file| file.to_string_lossy().into_owned());
    let library = match library_dir(app) {
        Ok(library) => library,
        Err(message) => {
            return LibraryState { enabled: true, directory: String::new(), skill_path, pets: Vec::new(), runs: Vec::new(), message: Some(message) }
        }
    };
    let mut issues = Vec::new();
    if skill_path.is_none() {
        issues.push("The Hatch Pet skill is missing. Reinstall Willow.".to_string());
    }
    let mut pets = Vec::new();
    let mut packages = 0;
    for id in directories(&library) {
        if packages >= MAX_PACKAGES {
            break;
        }
        // Generation output and unfinished folders are not packages yet.
        if fs::symlink_metadata(library.join(&id).join("pet.json")).is_err() {
            continue;
        }
        packages += 1;
        match load_record(&library, &id) {
            Ok((record, _, _)) => pets.push(record),
            Err(error) => issues.push(format!("{id}: {error}")),
        }
    }
    let runs = read_runs(&library, &pets);
    LibraryState {
        enabled: true,
        directory: library.to_string_lossy().into_owned(),
        skill_path,
        pets,
        runs,
        message: (!issues.is_empty()).then(|| issues.join("\n")),
    }
}

/// Creations in progress, newest first: what `scripts/pet_bridge.py` writes as it goes.
fn read_runs(library: &Path, pets: &[PetRecord]) -> Vec<CreationRun> {
    let root = library.join(".hatching");
    let names = directories(&root);
    let mut runs: Vec<CreationRun> = names[names.len().saturating_sub(30)..]
        .iter()
        .filter_map(|id| {
            let folder = beneath(&root, id).ok()?;
            let progress = read_json(&beneath(&folder, "progress.json").ok()?).ok()?;
            let text = |key: &str| progress.get(key).and_then(Value::as_str);
            let stage = text("stage").filter(|stage| STAGES.contains(stage))?;
            let name = text("name")?;
            let updated_at = text("updatedAt").filter(|at| !at.trim().is_empty())?;
            let pet_id = text("petId").map(str::to_string);
            if stage == "ready" && !pet_id.as_ref().is_some_and(|pet| pets.iter().any(|known| &known.id == pet)) {
                return None;
            }
            // An image still being written must not hide progress that is real.
            let preview_data_url = text("preview")
                .and_then(|preview| beneath(&folder, preview).ok())
                .and_then(|file| check_image(&file).ok().map(|(mime, _)| (file, mime)))
                .and_then(|(file, mime)| data_url(&file, mime).ok());
            Some(CreationRun {
                id: id.clone(),
                name: chars(name, 100),
                stage: stage.to_string(),
                updated_at: updated_at.to_string(),
                pet_id,
                preview_data_url,
                message: text("message").map(|message| chars(message, 500)),
            })
        })
        .collect();
    runs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    runs.truncate(8);
    runs
}

/// Tells Willow's page when anything in the library changes. Polled, because the
/// library is a handful of small folders and a second is soon enough.
fn watch_library(app: AppHandle) {
    thread::spawn(move || {
        let mut last = None;
        loop {
            thread::sleep(Duration::from_secs(1));
            let Ok(library) = library_dir(&app) else { continue };
            let mut hasher = DefaultHasher::new();
            stamp_tree(&library, 0, &mut hasher);
            let stamp = hasher.finish();
            if last.is_some_and(|last| last != stamp) {
                // Let a burst of writes settle into one notice.
                thread::sleep(Duration::from_millis(180));
                to_page(&app, tabs::PAGE, &json!({ "kind": "pets-changed" }));
            }
            last = Some(stamp);
        }
    });
}

fn stamp_tree(dir: &Path, depth: usize, hasher: &mut DefaultHasher) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let Ok(metadata) = entry.metadata() else { continue };
        entry.file_name().hash(hasher);
        metadata.len().hash(hasher);
        modified_ms(&metadata).hash(hasher);
        if metadata.is_dir() && depth < 2 {
            stamp_tree(&entry.path(), depth + 1, hasher);
        }
    }
}

/* ── Commands for Willow's pages ────────────────────────────────────────── */

#[tauri::command]
pub async fn overlay_open(app: AppHandle, webview: Webview, surface: OpenRequest) -> OverlayStatus {
    open(&app, webview.label(), surface)
}

#[tauri::command]
pub async fn overlay_close(app: AppHandle, webview: Webview) {
    let owner = with_state(&app, |state| state.live.as_ref().is_some_and(|live| live.owner == webview.label()));
    if owner {
        close(&app);
    }
}

/// Page to overlay. Only the page that opened it is heard.
#[tauri::command]
pub async fn overlay_post(app: AppHandle, webview: Webview, message: Value) {
    let attached = with_state(&app, |state| state.live.as_ref().is_some_and(|live| live.owner == webview.label() && live.attached));
    if attached {
        to_overlay(&app, &message);
    }
}

#[tauri::command]
pub async fn pets_read(app: AppHandle) -> LibraryState {
    read_library(&app)
}

#[tauri::command]
pub async fn pets_load(app: AppHandle, id: String) -> Result<PetSprite, String> {
    let library = library_dir(&app)?;
    let (record, sheet, mime) = load_record(&library, &id)?;
    Ok(PetSprite { record, spritesheet_data_url: data_url(&sheet, mime)? })
}

#[tauri::command]
pub async fn pets_prepare_creation(app: AppHandle) -> Result<Creation, String> {
    let directory = library_dir(&app)?;
    let skill = skill_file(&app).ok_or("The Hatch Pet skill is missing. Reinstall Willow.")?;
    Ok(Creation { skill_path: skill.to_string_lossy().into_owned(), directory: directory.to_string_lossy().into_owned() })
}

const OUTSIDE_RUN: &str = "Pet images live in a creation run: an absolute path inside the pet library's .hatching/<run> folder.";

/// The library's `.hatching` folder, where creations in progress live.
fn hatching_dir(app: &AppHandle) -> Result<PathBuf, String> {
    fs::canonicalize(library_dir(app)?.join(".hatching")).map_err(|error| error.to_string())
}

/// Whether a real path is strictly inside one of the runs.
fn inside_run(hatching: &Path, real: &Path) -> bool {
    real.strip_prefix(hatching).is_ok_and(|inside| inside.components().next().is_some())
}

fn plain(path: &Path) -> String {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\").filter(|rest| !rest.starts_with("UNC")).unwrap_or(&text).to_string()
}

/// An existing image in a creation run.
fn run_file(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let hatching = hatching_dir(app)?;
    let real = fs::canonicalize(path).map_err(|_| format!("{path} is missing."))?;
    if !Path::new(path).is_absolute() || !inside_run(&hatching, real.parent().unwrap_or(&real)) {
        return Err(OUTSIDE_RUN.into());
    }
    Ok(real)
}

/// Where a new image in a creation run goes. Its folders are made only once the
/// deepest one that exists is known to be inside a run.
fn run_target(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let hatching = hatching_dir(app)?;
    let target = Path::new(path);
    if !target.is_absolute() || target.components().any(|part| matches!(part, Component::ParentDir | Component::CurDir)) {
        return Err(OUTSIDE_RUN.into());
    }
    let name = target.file_name().ok_or(OUTSIDE_RUN)?;
    let parent = target.parent().ok_or(OUTSIDE_RUN)?;
    let existing = parent.ancestors().find(|ancestor| ancestor.exists()).ok_or(OUTSIDE_RUN)?;
    let real_existing = fs::canonicalize(existing).map_err(|error| error.to_string())?;
    if !inside_run(&hatching, &real_existing) {
        return Err(OUTSIDE_RUN.into());
    }
    let folder = real_existing.join(parent.strip_prefix(existing).map_err(|_| OUTSIDE_RUN.to_string())?);
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let real_folder = fs::canonicalize(&folder).map_err(|error| error.to_string())?;
    if !inside_run(&hatching, &real_folder) {
        return Err(OUTSIDE_RUN.into());
    }
    Ok(real_folder.join(name))
}

/// An image from a creation run, as a data URL: a reference for the next one.
#[tauri::command]
pub async fn pets_read_image(app: AppHandle, path: String) -> Result<String, String> {
    let file = run_file(&app, &path)?;
    let jpeg = file.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("jpg") || ext.eq_ignore_ascii_case("jpeg"));
    let mime = if jpeg && fs::metadata(&file).is_ok_and(|meta| meta.len() <= MAX_IMAGE_BYTES) { "image/jpeg" } else { check_image(&file)?.0 };
    data_url(&file, mime)
}

/// Saves a generated image (base64) into a creation run, and says where it went.
#[tauri::command]
pub async fn pets_write_image(app: AppHandle, path: String, data: String) -> Result<String, String> {
    let file = run_target(&app, &path)?;
    if mime_of(&file).is_none() {
        return Err("Save pet images as .png or .webp.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|_| "The image data was not base64.".to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("Pet images are at most 12 MB.".into());
    }
    fs::write(&file, bytes).map_err(|error| error.to_string())?;
    Ok(plain(&file))
}

#[tauri::command]
pub async fn pets_open_folder(app: AppHandle) -> Result<(), String> {
    let library = library_dir(&app)?;
    app.opener().open_path(library.to_string_lossy(), None::<&str>).map_err(|error| error.to_string())
}

/// The sensor's page says whether the pet is out; the strip's paw shows it.
#[tauri::command]
pub async fn pets_report_shown(app: AppHandle, webview: Webview, shown: bool) {
    with_state(&app, |state| {
        state.sensor = Some(webview.label().to_string());
        state.shown = Some(shown);
    });
    tabs::render(&app);
}

/// What the pet asks of Willow's window: raise it if asked, then have Willow's page
/// open a Spark task or focus its composer.
#[tauri::command]
pub async fn pets_show(app: AppHandle, task_id: Option<String>, composer: bool, raise: bool) {
    if raise {
        crate::show_main(&app);
    }
    to_page(&app, tabs::PAGE, &json!({ "kind": "pets-show", "taskId": task_id, "composer": composer }));
}

/// The strip's paw: shown or put away, by the page that keeps the pet.
#[tauri::command]
pub async fn pets_toggle(app: AppHandle) {
    if let Some(sensor) = with_state(&app, |state| state.sensor.clone()) {
        to_page(&app, &sensor, &json!({ "kind": "pets-toggle" }));
    }
}

/// What the strip draws for the paw: nothing until a sensor has spoken.
pub fn paw(app: &AppHandle) -> Option<bool> {
    with_state(app, |state| state.sensor.as_ref().and(state.shown))
}

/* ── Commands for the overlay page ──────────────────────────────────────── */

fn is_overlay(webview: &Webview) -> bool {
    webview.label() == OVERLAY
}

#[tauri::command]
pub async fn overlay_surface(app: AppHandle, webview: Webview) -> Option<Surface> {
    if !is_overlay(&webview) {
        return None;
    }
    // Handed over once: a reloaded overlay page is not a second pet.
    with_state(&app, |state| state.live.as_mut().and_then(|live| live.surface.take()))
}

#[tauri::command]
pub async fn overlay_attached(app: AppHandle, webview: Webview) {
    if is_overlay(&webview) {
        attached(&app);
    }
}

#[tauri::command]
pub async fn overlay_set_interactive(app: AppHandle, webview: Webview, interactive: bool) {
    if is_overlay(&webview) {
        set_interactive(&app, interactive);
    }
}

#[tauri::command]
pub async fn overlay_set_focusable(app: AppHandle, webview: Webview, focusable: bool) {
    if is_overlay(&webview) {
        set_focusable(&app, focusable);
    }
}

#[tauri::command]
pub async fn overlay_send(app: AppHandle, webview: Webview, message: Value) {
    if is_overlay(&webview) {
        from_overlay(&app, message);
    }
}
