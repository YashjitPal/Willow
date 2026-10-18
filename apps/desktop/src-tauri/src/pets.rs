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
//! - **The library.** Pets live in `Pets/` in the Willow folder (`local_folder.rs`),
//!   each a folder or a zip named anything, holding `pet.json` and a 1536 × 2288
//!   sprite sheet at its top or one folder down, and known by the id in its
//!   `pet.json`; `Pets/.hatching/<run>/progress.json` is a creation and its working
//!   files. Pages are told when anything there changes.
//! - **The routing.** Messages from the pet go to the page that opened it; the
//!   strip's paw goes to the page running the pet's sensor.

use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom},
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
const MAX_ZIP_BYTES: u64 = 16 * 1024 * 1024;
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

/// Lowercase words joined by single hyphens: a pet's id, and the name of a creation's folder.
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
    json_object(&fs::read(file).map_err(|error| error.to_string())?)
}

/// A JSON object, which may begin with the byte order mark Notepad saves.
fn json_object(bytes: &[u8]) -> Result<serde_json::Map<String, Value>, String> {
    match serde_json::from_slice::<Value>(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes)).map_err(|error| error.to_string())? {
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
    let mut bytes = vec![0; 32];
    let mut handle = fs::File::open(file).map_err(|error| error.to_string())?;
    let read = handle.read(&mut bytes).map_err(|error| error.to_string())?;
    bytes.truncate(read);
    Ok(bytes)
}

fn chars(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// A pet in the library, and where its sheet is.
struct Pet {
    /// Where it is: the folder or zip in the library, then the folder in that holding it, if one does.
    name: String,
    zipped: bool,
    record: PetRecord,
    sheet: Sheet,
}

/// A pet's sprite sheet and its type: a file, or a file in a zip.
enum Sheet {
    File(PathBuf, &'static str),
    Zipped(PathBuf, String, &'static str),
}

/// Every pet in the library, each with an id of its own, and why anything there that should be a
/// pet cannot be used. One pet in two places, such as a zip kept after unpacking it, is listed
/// once. Two pets given one id are both listed: the one kept second takes an id made from where it is.
fn scan(library: &Path) -> (Vec<Pet>, Vec<String>) {
    let (found, issues) = packages(library);
    let (mut pets, mut others): (Vec<Pet>, Vec<Pet>) = (Vec::new(), Vec::new());
    for pet in found {
        match pets.iter().find(|known| known.record.id == pet.record.id) {
            None => pets.push(pet),
            Some(known) if matches!((sheet_bytes(&known.sheet), sheet_bytes(&pet.sheet)), (Ok(a), Ok(b)) if a == b) => {}
            Some(_) => others.push(pet),
        }
    }
    for mut pet in others {
        let base = package_id("", &pet.name);
        let (mut id, mut suffix) = (base.clone(), 1);
        while pets.iter().any(|known| known.record.id == id) {
            suffix += 1;
            id = format!("{base}-{suffix}");
        }
        pet.record.id = id;
        pets.push(pet);
    }
    pets.sort_by(|a, b| a.record.id.cmp(&b.record.id));
    (pets, issues)
}

/// The pets in the library, and why anything there that should be one cannot be used. A pet is a
/// folder or a zip, named anything, with its `pet.json` at the top or in folders one down; Willow's
/// own folders begin with a dot. Of pets given one id, the first is the one that keeps it: a folder
/// before a zip, and the folder its id names before a copy.
fn packages(library: &Path) -> (Vec<Pet>, Vec<String>) {
    let mut entries: Vec<(String, bool)> = fs::read_dir(library)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| Some((entry.file_name().into_string().ok()?, entry.file_type().ok()?.is_dir())))
                .filter(|(name, _)| !name.starts_with('.'))
                .collect()
        })
        .unwrap_or_default();
    entries.sort();
    let (mut pets, mut issues) = (Vec::new(), Vec::new());
    for (name, is_dir) in entries {
        if pets.len() + issues.len() >= MAX_PACKAGES {
            break;
        }
        let found = if is_dir {
            folder_pets(library, &name)
        } else if name.to_ascii_lowercase().ends_with(".zip") {
            zip_pets(library, &name)
        } else {
            continue;
        };
        for pet in found {
            match pet {
                Ok(pet) => pets.push(pet),
                Err(issue) => issues.push(issue),
            }
        }
    }
    pets.sort_by_cached_key(|pet| (pet.zipped, pet.name != pet.record.id, pet.name.clone()));
    (pets, issues)
}

/// The pets in the library's folder `name`: the folder itself, or each folder in it holding a
/// `pet.json`. A folder with none is not a pet, or not yet: a copy still arriving.
fn folder_pets(library: &Path, name: &str) -> Vec<Result<Pet, String>> {
    let holds_pet = |folder: &Path| fs::symlink_metadata(library.join(folder).join("pet.json")).is_ok();
    let top = PathBuf::from(name);
    let folders = if holds_pet(&top) {
        vec![top]
    } else {
        let mut inner: Vec<PathBuf> = fs::read_dir(library.join(name))
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                    .map(|entry| top.join(entry.file_name()))
                    .filter(|folder| holds_pet(folder))
                    .collect()
            })
            .unwrap_or_default();
        inner.sort();
        inner
    };
    folders
        .iter()
        .map(|folder| {
            let label = folder.to_string_lossy().replace('\\', "/");
            folder_pet(library, folder, &label).map_err(|error| format!("{label}: {error}"))
        })
        .collect()
}

/// A pet in a folder: the manifest there, and the sheet that names.
fn folder_pet(library: &Path, folder: &Path, label: &str) -> Result<Pet, String> {
    let folder = beneath(library, &folder.to_string_lossy())?;
    let manifest_file = beneath(&folder, "pet.json")?;
    let manifest = read_json(&manifest_file)?;
    check_manifest(&manifest)?;
    let sheet = beneath(&folder, field(&manifest, "spritesheetPath"))?;
    let (mime, metadata) = check_image(&sheet)?;
    check_sheet(&header(&sheet)?)?;
    let manifest_metadata = fs::metadata(&manifest_file).map_err(|error| error.to_string())?;
    let stamp = format!("{}:{}:{}", modified_ms(&manifest_metadata), modified_ms(&metadata), metadata.len());
    Ok(Pet { name: label.to_string(), zipped: false, record: record_of(&manifest, label, stamp), sheet: Sheet::File(sheet, mime) })
}

/// The pets in the library's zip `name`, read where they are: at its top, or each in a folder there.
fn zip_pets(library: &Path, name: &str) -> Vec<Result<Pet, String>> {
    let opened = beneath(library, name).and_then(|file| Ok((Zip::open(&file)?, file)));
    let (zip, file) = match opened {
        Ok(opened) => opened,
        Err(error) => return vec![Err(format!("{name}: {error}"))],
    };
    let roots = zip.roots();
    if roots.is_empty() {
        return vec![Err(format!("{name}: There is no pet.json in this zip, at its top or one folder down."))];
    }
    roots
        .iter()
        .map(|root| {
            let label = format!("{name}/{root}").trim_end_matches('/').to_string();
            zip_pet(&zip, &file, root, &label).map_err(|error| format!("{label}: {error}"))
        })
        .collect()
}

/// A pet in a zip: the manifest in its folder `root`, and the sheet that names.
fn zip_pet(zip: &Zip, file: &Path, root: &str, label: &str) -> Result<Pet, String> {
    let manifest = json_object(&zip.read(&format!("{root}pet.json"), MAX_JSON_BYTES)?)?;
    check_manifest(&manifest)?;
    let sheet = zip_path(root, field(&manifest, "spritesheetPath"))?;
    let (head, size) = zip.head(&sheet)?;
    let mime = mime_of(Path::new(&sheet)).filter(|_| size <= MAX_IMAGE_BYTES).ok_or("Pets need a PNG or WebP image of at most 12 MB.")?;
    check_sheet(&head)?;
    let metadata = fs::metadata(file).map_err(|error| error.to_string())?;
    let stamp = format!("{}:{}", modified_ms(&metadata), metadata.len());
    Ok(Pet { name: label.to_string(), zipped: true, record: record_of(&manifest, label, stamp), sheet: Sheet::Zipped(file.to_path_buf(), sheet, mime) })
}

/// What a pet's manifest must say: that it is a version 2 pet, its name, and where its sheet is.
fn check_manifest(manifest: &serde_json::Map<String, Value>) -> Result<(), String> {
    match manifest.get("spriteVersionNumber").map_or(Some(1), Value::as_u64) {
        Some(2) => {}
        Some(version) => {
            return Err(format!("This is a version {version} pet. Willow can use only version 2 pets, whose sprite sheet is 1536 × 2288 pixels."));
        }
        None => return Err("Its spriteVersionNumber must be 2.".into()),
    }
    let has = |key: &str| manifest.get(key).is_some_and(Value::is_string);
    if field(manifest, "displayName").trim().is_empty() || !has("description") || !has("spritesheetPath") {
        return Err("Its pet.json needs a displayName, a description, and a spritesheetPath.".into());
    }
    Ok(())
}

fn check_sheet(head: &[u8]) -> Result<(), String> {
    match image_size(head) {
        Some((SHEET_WIDTH, SHEET_HEIGHT)) => Ok(()),
        Some(_) => Err("The version 2 sprite sheet must be 1536 × 2288 pixels.".into()),
        None => Err("The pet image could not be decoded.".into()),
    }
}

fn record_of(manifest: &serde_json::Map<String, Value>, label: &str, stamp: String) -> PetRecord {
    PetRecord {
        id: package_id(field(manifest, "id"), label),
        display_name: chars(field(manifest, "displayName").trim(), 100),
        description: chars(field(manifest, "description"), 500),
        sprite_version_number: 2,
        stamp,
    }
}

fn field<'a>(manifest: &'a serde_json::Map<String, Value>, key: &str) -> &'a str {
    manifest.get(key).and_then(Value::as_str).unwrap_or_default()
}

/// The id a manifest gives, made into one if it is not one; or else one made from the name of the
/// folder or zip the pet is in.
fn package_id(given: &str, label: &str) -> String {
    if valid_id(given) {
        return given.to_string();
    }
    let name = label.rsplit('/').next().unwrap_or(label).to_ascii_lowercase();
    let stem = name.strip_suffix(".zip").unwrap_or(&name);
    let stem = stem.strip_suffix(".codex-pet").unwrap_or(stem);
    [slug(given), slug(stem)].into_iter().find(|id| !id.is_empty()).unwrap_or_else(|| "pet".into())
}

/// Lowercase words joined by hyphens, as a creation makes its pet's id (`scripts/pet_bridge.py`).
fn slug(text: &str) -> String {
    let mut slug = text.to_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).filter(|word| !word.is_empty()).collect::<Vec<_>>().join("-");
    slug.truncate(60);
    slug.trim_end_matches('-').to_string()
}

const UNREADABLE_ZIP: &str = "This zip could not be read.";

/// A zip, as much of the format as pets need: files stored or deflated, without ZIP64 or encryption.
struct Zip {
    file: fs::File,
    entries: Vec<ZipEntry>,
}

/// A file in a zip, as the zip's directory describes it.
struct ZipEntry {
    name: String,
    flags: usize,
    method: usize,
    crc: u32,
    compressed: usize,
    size: usize,
    /// Where its local header starts.
    header: usize,
}

/// A little-endian number of `width` bytes at `at`.
fn le(bytes: &[u8], at: usize, width: usize) -> Result<usize, String> {
    let field = bytes.get(at..at + width).ok_or(UNREADABLE_ZIP)?;
    Ok(field.iter().rev().fold(0, |value, &byte| value << 8 | byte as usize))
}

/// `count` bytes of a zip from `at`.
fn read_at(mut file: &fs::File, at: u64, count: usize) -> Result<Vec<u8>, String> {
    file.seek(SeekFrom::Start(at)).map_err(|_| UNREADABLE_ZIP.to_string())?;
    let mut bytes = Vec::new();
    file.take(count as u64).read_to_end(&mut bytes).map_err(|_| UNREADABLE_ZIP.to_string())?;
    if bytes.len() != count {
        return Err(UNREADABLE_ZIP.into());
    }
    Ok(bytes)
}

impl Zip {
    fn open(path: &Path) -> Result<Self, String> {
        let file = fs::File::open(path).map_err(|error| error.to_string())?;
        let length = file.metadata().map_err(|error| error.to_string())?.len();
        if length > MAX_ZIP_BYTES {
            return Err("The zip is too large to be a pet.".into());
        }
        // The record ending the zip's directory: its last 22 bytes, or before a comment of up to 64 KB.
        let start = length.saturating_sub(22 + 0xffff);
        let tail = read_at(&file, start, (length - start) as usize)?;
        let last = tail.len().checked_sub(22).ok_or(UNREADABLE_ZIP)?;
        let end = (0..=last).rev().find(|&at| tail[at..].starts_with(b"PK\x05\x06")).ok_or(UNREADABLE_ZIP)?;
        let directory = read_at(&file, le(&tail, end + 16, 4)? as u64, le(&tail, end + 12, 4)?)?;
        let (mut entries, mut at) = (Vec::new(), 0);
        for _ in 0..le(&tail, end + 10, 2)? {
            if !directory.get(at..).is_some_and(|rest| rest.starts_with(b"PK\x01\x02")) {
                return Err(UNREADABLE_ZIP.into());
            }
            let named = at + 46 + le(&directory, at + 28, 2)?;
            entries.push(ZipEntry {
                name: String::from_utf8_lossy(directory.get(at + 46..named).ok_or(UNREADABLE_ZIP)?).replace('\\', "/"),
                flags: le(&directory, at + 8, 2)?,
                method: le(&directory, at + 10, 2)?,
                crc: le(&directory, at + 16, 4)? as u32,
                compressed: le(&directory, at + 20, 4)?,
                size: le(&directory, at + 24, 4)?,
                header: le(&directory, at + 42, 4)?,
            });
            at = named + le(&directory, at + 30, 2)? + le(&directory, at + 32, 2)?;
        }
        Ok(Zip { file, entries })
    }

    /// The folders in the zip holding a pet's `pet.json`: its top, or else each folder at its top that has one.
    fn roots(&self) -> Vec<String> {
        if self.entries.iter().any(|entry| entry.name == "pet.json") {
            return vec![String::new()];
        }
        let mut roots: Vec<String> = self
            .entries
            .iter()
            .filter_map(|entry| entry.name.strip_suffix("/pet.json"))
            .filter(|folder| !folder.is_empty() && !folder.contains('/'))
            .map(|folder| format!("{folder}/"))
            .collect();
        roots.sort();
        roots.dedup();
        roots
    }

    fn entry(&self, name: &str) -> Result<&ZipEntry, String> {
        self.entries.iter().find(|entry| entry.name == name).ok_or_else(|| format!("{name} is missing."))
    }

    /// Up to `count` bytes from the start of a file in the zip.
    fn contents(&self, entry: &ZipEntry, count: usize) -> Result<Vec<u8>, String> {
        if entry.flags & 1 != 0 {
            return Err("The zip is password-protected.".into());
        }
        let local = read_at(&self.file, entry.header as u64, 30)?;
        if !local.starts_with(b"PK\x03\x04") {
            return Err(UNREADABLE_ZIP.into());
        }
        let mut file = &self.file;
        file.seek(SeekFrom::Current((le(&local, 26, 2)? + le(&local, 28, 2)?) as i64)).map_err(|_| UNREADABLE_ZIP.to_string())?;
        let stored = file.take(entry.compressed as u64);
        let mut contents = Vec::new();
        let read = match entry.method {
            0 => stored.take(count as u64).read_to_end(&mut contents),
            8 => flate2::read::DeflateDecoder::new(stored).take(count as u64).read_to_end(&mut contents),
            _ => return Err("The zip is compressed in a way Willow cannot read.".into()),
        };
        read.map_err(|_| UNREADABLE_ZIP.to_string())?;
        Ok(contents)
    }

    /// The whole of a file in the zip, of at most `limit` bytes, checked against the size and
    /// checksum the zip gives it.
    fn read(&self, name: &str, limit: u64) -> Result<Vec<u8>, String> {
        let entry = self.entry(name)?;
        if entry.size as u64 > limit {
            return Err(format!("{name} is too large."));
        }
        let contents = self.contents(entry, entry.size)?;
        let mut crc = flate2::Crc::new();
        crc.update(&contents);
        if contents.len() != entry.size || crc.sum() != entry.crc {
            return Err(UNREADABLE_ZIP.into());
        }
        Ok(contents)
    }

    /// The start of a file in the zip, enough for an image's header, and the file's whole size.
    fn head(&self, name: &str) -> Result<(Vec<u8>, u64), String> {
        let entry = self.entry(name)?;
        Ok((self.contents(entry, 32)?, entry.size as u64))
    }
}

/// A file in a zip, by its path from the folder `root` holding the pet, refusing paths that leave it.
fn zip_path(root: &str, relative: &str) -> Result<String, String> {
    let parts: Vec<&str> = relative.split(['/', '\\']).collect();
    if relative.contains(['\0', ':']) || parts.iter().any(|part| matches!(*part, "" | "." | "..")) {
        return Err("A pet file escapes its package.".into());
    }
    Ok(format!("{root}{}", parts.join("/")))
}

fn sheet_bytes(sheet: &Sheet) -> Result<Vec<u8>, String> {
    match sheet {
        Sheet::File(file, _) => fs::read(file).map_err(|error| error.to_string()),
        Sheet::Zipped(file, name, _) => Zip::open(file)?.read(name, MAX_IMAGE_BYTES),
    }
}

fn sheet_url(sheet: &Sheet) -> Result<String, String> {
    let (Sheet::File(_, mime) | Sheet::Zipped(_, _, mime)) = sheet;
    Ok(encoded(&sheet_bytes(sheet)?, mime))
}

fn data_url(file: &Path, mime: &str) -> Result<String, String> {
    let bytes = fs::read(file).map_err(|error| error.to_string())?;
    Ok(encoded(&bytes, mime))
}

fn encoded(bytes: &[u8], mime: &str) -> String {
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
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
    let (found, unusable) = scan(&library);
    issues.extend(unusable);
    let pets: Vec<PetRecord> = found.into_iter().map(|pet| pet.record).collect();
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
    let pet = scan(&library).0.into_iter().find(|pet| pet.record.id == id).ok_or("That pet is not in the library any more.")?;
    Ok(PetSprite { spritesheet_data_url: sheet_url(&pet.sheet)?, record: pet.record })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// As much of a PNG as Willow reads: its signature, and the header giving its size.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0]);
        bytes
    }

    fn manifest(id: &str, version: Option<u64>) -> Vec<u8> {
        let mut manifest = json!({ "id": id, "displayName": "Clawd", "description": "A crab.", "spritesheetPath": "spritesheet.png" });
        if let Some(version) = version {
            manifest["spriteVersionNumber"] = json!(version);
        }
        manifest.to_string().into_bytes()
    }

    /// A zip of `files`, the first stored and the rest deflated, as zip tools mix the two.
    fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let (mut bytes, mut directory): (Vec<u8>, Vec<u8>) = (Vec::new(), Vec::new());
        for (index, (name, contents)) in files.iter().enumerate() {
            let (method, data) = if index == 0 {
                (0u16, contents.to_vec())
            } else {
                let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
                encoder.write_all(contents).unwrap();
                (8, encoder.finish().unwrap())
            };
            let mut crc = flate2::Crc::new();
            crc.update(contents);
            // What a file's local header and its entry in the directory share, from the version needed to extract it on.
            let mut shared: Vec<u8> = Vec::new();
            shared.extend(20u16.to_le_bytes());
            shared.extend(0u16.to_le_bytes());
            shared.extend(method.to_le_bytes());
            shared.extend([0; 4]);
            shared.extend(crc.sum().to_le_bytes());
            shared.extend((data.len() as u32).to_le_bytes());
            shared.extend((contents.len() as u32).to_le_bytes());
            shared.extend((name.len() as u16).to_le_bytes());
            shared.extend(0u16.to_le_bytes());
            directory.extend(b"PK\x01\x02\x14\0");
            directory.extend(&shared);
            directory.extend([0; 10]);
            directory.extend((bytes.len() as u32).to_le_bytes());
            directory.extend(name.as_bytes());
            bytes.extend(b"PK\x03\x04");
            bytes.extend(&shared);
            bytes.extend(name.as_bytes());
            bytes.extend(&data);
        }
        let at = bytes.len() as u32;
        let count = (files.len() as u16).to_le_bytes();
        bytes.extend(&directory);
        bytes.extend(b"PK\x05\x06\0\0\0\0");
        bytes.extend(count);
        bytes.extend(count);
        bytes.extend((directory.len() as u32).to_le_bytes());
        bytes.extend(at.to_le_bytes());
        bytes.extend([0; 2]);
        bytes
    }

    fn library() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("willow-pets-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(file: PathBuf, bytes: &[u8]) {
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, bytes).unwrap();
    }

    fn ids(pets: &[Pet]) -> Vec<&str> {
        pets.iter().map(|pet| pet.record.id.as_str()).collect()
    }

    #[test]
    fn finds_a_pet_whatever_its_folder_or_zip_is_called() {
        let dir = library();
        let sheet = png(SHEET_WIDTH, SHEET_HEIGHT);
        // Unzipped by Windows, which names the folder after the zip.
        write(dir.join("clawd-chef.codex-pet/pet.json"), &manifest("clawd-chef", Some(2)));
        write(dir.join("clawd-chef.codex-pet/spritesheet.png"), &sheet);
        // Unzipped into a folder of its own, its manifest saved by Notepad.
        write(dir.join("Rocket Pet/rocket/pet.json"), &[&b"\xef\xbb\xbf"[..], &manifest("rocket", Some(2))[..]].concat());
        write(dir.join("Rocket Pet/rocket/spritesheet.png"), &sheet);
        // Zips, as they came: a pet at the top, one whose id is not one, and two in folders of their own.
        write(dir.join("clawd-svg.codex-pet.zip"), &zip(&[("pet.json", &manifest("clawd-svg", Some(2))), ("spritesheet.png", &sheet)]));
        write(dir.join("Moon.codex-pet.zip"), &zip(&[("pet.json", &manifest("Moon Pet!", Some(2))), ("spritesheet.png", &sheet)]));
        write(
            dir.join("Pack (1).zip"),
            &zip(&[
                ("disco/", b""),
                ("disco/pet.json", &manifest("disco", Some(2))),
                ("disco/spritesheet.png", &sheet),
                ("star/pet.json", &manifest("", Some(2))),
                ("star/spritesheet.png", &sheet),
            ]),
        );
        // A creation in progress, and a folder with no pet in it.
        write(dir.join(".hatching/run/progress.json"), b"{}");
        fs::create_dir_all(dir.join("New folder")).unwrap();

        let (pets, issues) = scan(&dir);
        assert_eq!(ids(&pets), ["clawd-chef", "clawd-svg", "disco", "moon-pet", "rocket", "star"]);
        assert!(issues.is_empty(), "{issues:?}");
        for pet in &pets {
            assert_eq!(sheet_bytes(&pet.sheet).unwrap(), sheet, "{}'s sheet", pet.name);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_one_pet_once_and_two_pets_with_one_id_twice() {
        let dir = library();
        let sheet = png(SHEET_WIDTH, SHEET_HEIGHT);
        write(dir.join("clawd-chef/pet.json"), &manifest("clawd-chef", Some(2)));
        write(dir.join("clawd-chef/spritesheet.png"), &sheet);
        // The zip it came from, kept after unpacking it, and that downloaded again.
        let package = zip(&[("pet.json", &manifest("clawd-chef", Some(2))), ("spritesheet.png", &sheet)]);
        write(dir.join("clawd-chef.codex-pet.zip"), &package);
        write(dir.join("clawd-chef.codex-pet (1).zip"), &package);
        // Copies redrawn into other pets, keeping the id.
        write(dir.join("clawd-chef - Copy/pet.json"), &manifest("clawd-chef", Some(2)));
        write(dir.join("clawd-chef - Copy/spritesheet.png"), &[&sheet[..], &b"redrawn"[..]].concat());
        write(
            dir.join("Clawd Chef Copy.zip"),
            &zip(&[("pet.json", &manifest("clawd-chef", Some(2))), ("spritesheet.png", &[&sheet[..], &b"again"[..]].concat())]),
        );

        let (pets, issues) = scan(&dir);
        let found: Vec<(&str, &str)> = pets.iter().map(|pet| (pet.record.id.as_str(), pet.name.as_str())).collect();
        assert_eq!(found, [("clawd-chef", "clawd-chef"), ("clawd-chef-copy", "clawd-chef - Copy"), ("clawd-chef-copy-2", "Clawd Chef Copy.zip")]);
        assert!(issues.is_empty(), "{issues:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn says_why_a_pet_cannot_be_used() {
        let dir = library();
        write(dir.join("big-sheet/pet.json"), &manifest("big-sheet", Some(2)));
        write(dir.join("big-sheet/spritesheet.png"), &png(SHEET_WIDTH * 2, SHEET_HEIGHT * 2));
        write(dir.join("broken.zip"), b"PK\x03\x04 cut short");
        write(dir.join("clawd-laptop.codex-pet.zip"), &zip(&[("pet.json", &manifest("clawd-laptop", None)), ("spritesheet.png", &png(SHEET_WIDTH, 1872))]));
        write(
            dir.join("Pack.zip"),
            &zip(&[
                ("good/pet.json", &manifest("good", Some(2))),
                ("good/spritesheet.png", &png(SHEET_WIDTH, SHEET_HEIGHT)),
                ("old/pet.json", &manifest("old", Some(1))),
            ]),
        );
        write(dir.join("photos.zip"), &zip(&[("beach.jpg", b"not a pet")]));
        let sneaky = json!({ "id": "sneaky", "spriteVersionNumber": 2, "displayName": "Sneaky", "description": "", "spritesheetPath": "../spritesheet.png" });
        write(dir.join("sneaky.zip"), &zip(&[("pet.json", sneaky.to_string().as_bytes())]));
        write(dir.join("notes.txt"), b"not a pet either");

        let (pets, issues) = scan(&dir);
        assert_eq!(ids(&pets), ["good"]);
        assert_eq!(
            issues,
            [
                "Pack.zip/old: This is a version 1 pet. Willow can use only version 2 pets, whose sprite sheet is 1536 × 2288 pixels.",
                "big-sheet: The version 2 sprite sheet must be 1536 × 2288 pixels.",
                "broken.zip: This zip could not be read.",
                "clawd-laptop.codex-pet.zip: This is a version 1 pet. Willow can use only version 2 pets, whose sprite sheet is 1536 × 2288 pixels.",
                "photos.zip: There is no pet.json in this zip, at its top or one folder down.",
                "sneaky.zip: A pet file escapes its package.",
            ]
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
