//! The agent tabs' browser (T3's preview, vendor/t3code/apps/web/src/willow/preview.ts) on
//! Windows. Most sites refuse to be shown in a frame, so each of its tabs is a webview of its
//! own, laid over the agents' page where T3 draws the tab: placed, shown and hidden as that page
//! says through Willow's (features/harness HarnessView), with holes where either page draws over
//! it — their menus, tooltips and dialogs. It is given none of the app's commands
//! (capabilities/willow.json is Willow's page's alone), and it tells the page what it shows.

use std::{collections::HashMap, sync::Mutex, thread};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Rect, Size, Url, Webview, WebviewBuilder, WebviewUrl,
};

use crate::tabs::{self, MAIN, PAGE};

/// Physical pixels from the top left of Willow's page, with the corners' radius.
#[derive(Deserialize, Clone, Copy, Default)]
pub struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    radius: f64,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Request {
    /// Shows `url` in the tab, making its webview the first time.
    Open { id: String, url: String },
    /// Where the tab is drawn, what the pages draw over it there, and its zoom (T3's, times
    /// Willow's page's pixel ratio); no `bounds` while it is not shown.
    Place {
        id: String,
        bounds: Option<Area>,
        #[serde(default)]
        holes: Vec<Area>,
        zoom: f64,
    },
    Back { id: String },
    Forward { id: String },
    Reload { id: String },
    Stop { id: String },
    Close { id: String },
    /// The agents' page that opened the tabs went away.
    CloseAll,
}

#[derive(Default)]
pub struct Previews(Mutex<State>);

#[derive(Default)]
struct State {
    made: u64,
    tabs: HashMap<String, Tab>,
    /// Where the page last asked each tab to go, kept for a webview still being made.
    wanted: HashMap<String, Wanted>,
}

#[derive(Clone)]
struct Wanted {
    bounds: Option<Area>,
    holes: Vec<Area>,
    zoom: f64,
}

struct Tab {
    label: String,
    zoom: f64,
    /// Where it was last put and the region it was cut to, so a page saying the same again costs nothing.
    placed: Option<(i32, i32, u32, u32)>,
    cut: String,
    shown: Shown,
}

/// What a tab shows, as the page hears it (`harness-preview` in platform/core desktop-bridge.ts).
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Shown {
    url: String,
    title: String,
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
    /// Why the page could not load, as Chromium names it (T3's unreachable page reads it).
    failed: Option<Failure>,
}

#[derive(Clone, Serialize)]
struct Failure {
    code: i32,
    description: &'static str,
}

fn with<T>(app: &AppHandle, f: impl FnOnce(&mut State) -> T) -> T {
    let previews = app.state::<Previews>();
    let mut state = previews.0.lock().unwrap();
    f(&mut state)
}

fn webview(app: &AppHandle, id: &str) -> Option<Webview> {
    let label = with(app, |state| state.tabs.get(id).map(|tab| tab.label.clone()))?;
    app.get_webview(&label)
}

/// Hands a message to Willow's page once WebView2's callback, which may still be running, returns.
fn deliver(app: &AppHandle, message: Value) {
    let page = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(webview) = page.get_webview(PAGE) {
            let _ = webview.eval(format!("window.__WILLOW_DESKTOP__ && window.__WILLOW_DESKTOP__.receive({message})"));
        }
    });
}

fn update(app: &AppHandle, id: &str, change: impl FnOnce(&mut Shown)) {
    let shown = with(app, |state| {
        let tab = state.tabs.get_mut(id)?;
        change(&mut tab.shown);
        Some(tab.shown.clone())
    });
    if let Some(shown) = shown {
        deliver(app, json!({ "kind": "harness-preview", "id": id, "state": shown }));
    }
}

/// Clicked into: the agents' page closes its menus, as a click on it would.
fn focused(app: &AppHandle, id: &str) {
    deliver(app, json!({ "kind": "harness-preview", "id": id, "focused": true }));
}

#[tauri::command]
pub async fn harness_preview(app: AppHandle, request: Request) -> Result<(), String> {
    match request {
        Request::Open { id, url } => open(&app, &id, &url),
        Request::Place { id, bounds, holes, zoom } => {
            let wanted = Wanted { bounds, holes, zoom };
            with(&app, |state| state.wanted.insert(id.clone(), wanted.clone()));
            if let Some(webview) = webview(&app, &id) {
                place(&app, &id, &webview, wanted);
            }
            Ok(())
        }
        Request::Back { id } => script(&app, &id, "history.back()"),
        Request::Forward { id } => script(&app, &id, "history.forward()"),
        Request::Stop { id } => script(&app, &id, "window.stop()"),
        Request::Reload { id } => match webview(&app, &id) {
            Some(webview) => webview.reload().map_err(|error| error.to_string()),
            None => Ok(()),
        },
        Request::Close { id } => {
            close(&app, Some(&id));
            Ok(())
        }
        Request::CloseAll => {
            close(&app, None);
            Ok(())
        }
    }
}

fn script(app: &AppHandle, id: &str, js: &str) -> Result<(), String> {
    match webview(app, id) {
        Some(webview) => webview.eval(js).map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

fn open(app: &AppHandle, id: &str, url: &str) -> Result<(), String> {
    let url = Url::parse(url).map_err(|error| format!("{url} is not an address: {error}"))?;
    if !matches!(url.scheme(), "http" | "https" | "about") {
        return Err(format!("The browser shows web pages, not {}: addresses.", url.scheme()));
    }
    match webview(app, id) {
        Some(webview) => webview.navigate(url).map_err(|error| error.to_string()),
        None => create(app, id, url).map_err(|error| error.to_string()),
    }
}

fn create(app: &AppHandle, id: &str, url: Url) -> tauri::Result<()> {
    let Some(window) = app.get_window(MAIN) else { return Ok(()) };
    let label = with(app, |state| {
        state.made += 1;
        let label = format!("harness-preview-{}", state.made);
        let shown = Shown { url: url.to_string(), loading: true, ..Shown::default() };
        state.tabs.insert(id.to_string(), Tab { label: label.clone(), zoom: 1.0, placed: None, cut: String::new(), shown });
        label
    });
    let (loads, load_id) = (app.clone(), id.to_string());
    let (titles, title_id) = (app.clone(), id.to_string());
    let (popups, popup_id) = (app.clone(), id.to_string());
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        // The web, and what pages make of it; never the computer's files or other apps.
        .on_navigation(|url| matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data"))
        .on_page_load(move |webview, payload| {
            let started = matches!(payload.event(), PageLoadEvent::Started);
            let url = payload.url().to_string();
            update(&loads, &load_id, |shown| {
                shown.url = url;
                shown.loading = started;
                if started {
                    shown.failed = None;
                }
            });
            // WebView2 may forget the zoom on another site.
            let zoom = with(&loads, |state| state.tabs.get(&load_id).map(|tab| tab.zoom)).unwrap_or(1.0);
            if !started && (zoom - 1.0).abs() > 0.001 {
                let _ = loads.run_on_main_thread(move || {
                    let _ = webview.set_zoom(zoom);
                });
            }
        })
        .on_document_title_changed(move |_, title| update(&titles, &title_id, |shown| shown.title = title))
        // Sign-in popups, which say how big they are, get windows of their own; any other new
        // window opens in the tab, as in a browser with one tab.
        .on_new_window(move |url, features| {
            if features.size().is_some() {
                return NewWindowResponse::Allow;
            }
            let (app, id) = (popups.clone(), popup_id.clone());
            // Off WebView2's callback, which is still running.
            thread::spawn(move || {
                if let Some(webview) = webview(&app, &id) {
                    let _ = webview.navigate(url);
                }
            });
            NewWindowResponse::Deny
        });
    if let Some(args) = tabs::browser_args(app) {
        builder = builder.additional_browser_args(&args);
    }
    // Out of sight until the page places it.
    let webview = window.add_child(builder, PhysicalPosition::new(-20_000, -20_000), PhysicalSize::new(1280, 800))?;
    let _ = webview.hide();
    #[cfg(windows)]
    windows_preview::watch(app, id, &webview);
    if let Some(wanted) = with(app, |state| state.wanted.get(id).cloned()) {
        place(app, id, &webview, wanted);
    }
    Ok(())
}

fn place(app: &AppHandle, id: &str, webview: &Webview, wanted: Wanted) {
    let Wanted { bounds, holes, zoom } = wanted;
    let Some(bounds) = bounds.filter(|bounds| bounds.width >= 1.0 && bounds.height >= 1.0) else {
        let was = with(app, |state| state.tabs.get_mut(id).and_then(|tab| tab.placed.take()));
        if was.is_some() {
            let _ = webview.hide();
        }
        return;
    };
    let origin = app.get_webview(PAGE).and_then(|page| page.position().ok()).unwrap_or(PhysicalPosition::new(0, 0));
    let rect = (
        origin.x + bounds.x.round() as i32,
        origin.y + bounds.y.round() as i32,
        bounds.width.round() as u32,
        bounds.height.round() as u32,
    );
    // WebView2 zooms on top of the display's scale, which Willow's pixel ratio already has.
    let scale = app.get_window(MAIN).and_then(|window| window.scale_factor().ok()).unwrap_or(1.0);
    let zoom = (zoom / scale).clamp(0.25, 5.0);
    let cut = region_key(&bounds, &holes);
    let Some((was, rezoom, recut)) = with(app, |state| {
        let tab = state.tabs.get_mut(id)?;
        let was = tab.placed.replace(rect);
        let rezoom = (tab.zoom - zoom).abs() > 0.001;
        tab.zoom = zoom;
        let recut = tab.cut != cut;
        tab.cut = cut;
        Some((was, rezoom, recut))
    }) else {
        return;
    };
    if was != Some(rect) {
        let _ = webview.set_bounds(Rect {
            position: Position::Physical(PhysicalPosition::new(rect.0, rect.1)),
            size: Size::Physical(PhysicalSize::new(rect.2, rect.3)),
        });
    }
    if rezoom {
        let _ = webview.set_zoom(zoom);
    }
    #[cfg(windows)]
    if recut {
        windows_preview::cut(webview, bounds, holes);
    }
    #[cfg(not(windows))]
    let _ = (recut, holes);
    if was.is_none() {
        let _ = webview.show();
    }
}

/// The region a tab is cut to, in its own pixels: its size and corners, less the holes.
fn region_key(bounds: &Area, holes: &[Area]) -> String {
    let mut key = format!("{}x{}r{}", bounds.width.round(), bounds.height.round(), bounds.radius.round());
    for hole in holes {
        key.push_str(&format!(
            "|{},{},{},{},{}",
            (hole.x - bounds.x).round(),
            (hole.y - bounds.y).round(),
            hole.width.round(),
            hole.height.round(),
            hole.radius.round()
        ));
    }
    key
}

/// Closes one tab, or all of them.
fn close(app: &AppHandle, id: Option<&str>) {
    let labels: Vec<String> = with(app, |state| match id {
        Some(id) => {
            state.wanted.remove(id);
            state.tabs.remove(id).map(|tab| vec![tab.label]).unwrap_or_default()
        }
        None => {
            state.wanted.clear();
            state.tabs.drain().map(|(_, tab)| tab.label).collect()
        }
    });
    if labels.is_empty() {
        return;
    }
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        for label in labels {
            if let Some(webview) = app.get_webview(&label) {
                let _ = webview.close();
            }
        }
    });
}

/// Willow's page is loading again: the agent tabs' browser went with the page that drew it.
pub fn page_loading(app: &AppHandle) {
    close(app, None);
}

#[cfg(windows)]
mod windows_preview {
    use tauri::{AppHandle, Webview};
    use webview2_com::{
        take_pwstr, FocusChangedEventHandler, HistoryChangedEventHandler, Microsoft::Web::WebView2::Win32::*,
        NavigationCompletedEventHandler, SourceChangedEventHandler,
    };
    use windows::core::{BOOL, PWSTR};
    use windows_sys::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_DIFF};

    use super::{focused, update, Area, Failure};

    /// WebView2's own word on where the tab can go back and forward to, its address as pages
    /// change it themselves, why a page did not load, and the tab being clicked into.
    pub fn watch(app: &AppHandle, id: &str, webview: &Webview) {
        let (app, id) = (app.clone(), id.to_string());
        let result = webview.with_webview(move |platform| {
            // SAFETY: WebView2 calls made on the webview's own thread, where this runs.
            if let Err(error) = unsafe { attach(&platform.controller(), app, id) } {
                eprintln!("[willow] the agents' browser could not follow its tab: {error}");
            }
        });
        if let Err(error) = result {
            eprintln!("[willow] the agents' browser could not follow its tab: {error}");
        }
    }

    unsafe fn attach(controller: &ICoreWebView2Controller, app: AppHandle, id: String) -> windows::core::Result<()> {
        let webview = controller.CoreWebView2()?;
        let mut token = 0i64;
        let (history, history_id) = (app.clone(), id.clone());
        webview.add_HistoryChanged(
            &HistoryChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    let (mut back, mut forward) = (BOOL::default(), BOOL::default());
                    sender.CanGoBack(&mut back)?;
                    sender.CanGoForward(&mut forward)?;
                    update(&history, &history_id, |shown| {
                        shown.can_go_back = back.as_bool();
                        shown.can_go_forward = forward.as_bool();
                    });
                }
                Ok(())
            })),
            &mut token,
        )?;
        let (sources, source_id) = (app.clone(), id.clone());
        webview.add_SourceChanged(
            &SourceChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    let mut source = PWSTR::null();
                    sender.Source(&mut source)?;
                    let url = take_pwstr(source);
                    update(&sources, &source_id, |shown| shown.url = url);
                }
                Ok(())
            })),
            &mut token,
        )?;
        let (loads, load_id) = (app.clone(), id.clone());
        webview.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut success = BOOL::default();
                    args.IsSuccess(&mut success)?;
                    let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                    args.WebErrorStatus(&mut status)?;
                    if let (false, Some(failure)) = (success.as_bool(), failure(status)) {
                        update(&loads, &load_id, |shown| {
                            shown.loading = false;
                            shown.failed = Some(failure);
                        });
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
        controller.add_GotFocus(
            &FocusChangedEventHandler::create(Box::new(move |_, _| {
                focused(&app, &id);
                Ok(())
            })),
            &mut token,
        )?;
        Ok(())
    }

    /// A page that could not be reached, by Chromium's name for why. Anything else WebView2 calls
    /// a failure (a server's own error page, a stopped load) stays the page's to show.
    fn failure(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> Option<Failure> {
        let (code, description) = match status {
            COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED => (-105, "ERR_NAME_NOT_RESOLVED"),
            COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT => (-102, "ERR_CONNECTION_REFUSED"),
            COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE => (-109, "ERR_ADDRESS_UNREACHABLE"),
            COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT => (-7, "ERR_TIMED_OUT"),
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED => (-100, "ERR_CONNECTION_CLOSED"),
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET => (-101, "ERR_CONNECTION_RESET"),
            COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED => (-106, "ERR_INTERNET_DISCONNECTED"),
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT => (-200, "ERR_CERT_COMMON_NAME_INVALID"),
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED => (-201, "ERR_CERT_DATE_INVALID"),
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID => (-202, "ERR_CERT_AUTHORITY_INVALID"),
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED => (-206, "ERR_CERT_REVOKED"),
            COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED => (-310, "ERR_TOO_MANY_REDIRECTS"),
            _ => return None,
        };
        Some(Failure { code, description })
    }

    /// Leaves out of the tab what the pages draw over it, and rounds its corners as theirs.
    pub fn cut(webview: &Webview, bounds: Area, holes: Vec<Area>) {
        let _ = webview.with_webview(move |platform| unsafe {
            // The window wry keeps the webview in, which the region clips with everything in it.
            let mut container = windows::Win32::Foundation::HWND::default();
            if platform.controller().ParentWindow(&mut container).is_err() {
                return;
            }
            let window = container.0;
            if holes.is_empty() && bounds.radius <= 0.0 {
                SetWindowRgn(window, std::ptr::null_mut(), 1);
                return;
            }
            let region = rounded(0.0, 0.0, bounds.width, bounds.height, bounds.radius);
            for hole in &holes {
                let cut = rounded(hole.x - bounds.x, hole.y - bounds.y, hole.width, hole.height, hole.radius);
                CombineRgn(region, region, cut, RGN_DIFF);
                DeleteObject(cut);
            }
            // The window owns the region from here.
            SetWindowRgn(window, region, 1);
        });
    }

    unsafe fn rounded(x: f64, y: f64, width: f64, height: f64, radius: f64) -> HRGN {
        let (left, top) = (x.round() as i32, y.round() as i32);
        let (right, bottom) = (left + width.round() as i32, top + height.round() as i32);
        if radius <= 0.0 {
            return CreateRectRgn(left, top, right, bottom);
        }
        let diameter = (radius * 2.0).round() as i32;
        CreateRoundRectRgn(left, top, right + 1, bottom + 1, diameter, diameter)
    }
}
