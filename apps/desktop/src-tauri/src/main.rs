#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Willow as a desktop app.
//!
//! The window shows Willow served by Willow's own production server
//! (`bin/willow.js`), run with a bundled Node.js, so everything that needs a
//! server — Spark's remote-browser proxy and its `*.wb.localhost` sites —
//! works as it does from `npm start`. The local companion runs beside it with a
//! fresh pairing token on every launch. The window is one Willow page under a
//! strip (`tabs.rs`). Closing the window hides Willow to the tray: the page, and
//! with it every dot, keeps running until Willow is quit.

mod agents_backup;
mod harness;
mod harness_preview;
mod local_folder;
mod menus;
#[cfg(windows)]
mod pages;
mod pets;
mod processes;
#[cfg(windows)]
mod snap;
mod snapshots;
mod tabs;

use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

use processes::{Children, Launch};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, Url, WindowEvent,
};
use tabs::MAIN;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// Passed when Willow opens at login: it starts in the tray, without a window.
const HIDDEN: &str = "--hidden";
/// Where the server's port is chosen from, once (see `server_port`). Below
/// Windows' dynamic range, which Hyper-V and WSL reserve chunks of at boot.
const PORTS: std::ops::Range<u16> = 41730..41830;
static QUITTING: AtomicBool = AtomicBool::new(false);

/// Size and position are remembered; visibility is not, so quitting from the
/// tray never leaves the next launch hidden.
fn window_state_flags() -> StateFlags {
    StateFlags::all() & !StateFlags::VISIBLE
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                // The pet's window is placed on a display's work area every time it opens.
                .with_denylist(&[pets::OVERLAY])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Children::default())
        .manage(tabs::Tabs::default())
        .manage(pets::Pets::default())
        .manage(harness::Harness::default())
        .manage(harness_preview::Previews::default())
        .manage(snapshots::SnapShots::default())
        .invoke_handler(tauri::generate_handler![
            tabs::tabs_snapshot,
            tabs::tab_report,
            tabs::tab_history,
            tabs::window_close,
            tabs::tab_frame,
            tabs::window_buttons,
            tabs::menu_open,
            tabs::menu_key,
            tabs::menu_mnemonics,
            tabs::menu_keys,
            tabs::strip_tooltip,
            tabs::strip_panel_tabs,
            tabs::panel_tab,
            tabs::window_fullscreen,
            menus::context_menu_choose,
            app_quit,
            pets::overlay_open,
            pets::overlay_close,
            pets::overlay_post,
            pets::overlay_surface,
            pets::overlay_attached,
            pets::overlay_set_interactive,
            pets::overlay_set_focusable,
            pets::overlay_send,
            pets::pets_read,
            pets::pets_load,
            pets::pets_prepare_creation,
            pets::pets_open_folder,
            pets::pets_read_image,
            pets::pets_write_image,
            pets::pets_report_shown,
            pets::pets_show,
            pets::pets_toggle,
            pages_stream,
            pages_stream_cancel,
            harness::harness_connection,
            harness::harness_exposure,
            harness::harness_set_exposure,
            harness::harness_set_tailscale_serve,
            harness::harness_tailscale,
            harness::harness_set_badge,
            harness_preview::harness_preview,
            local_folder::local_folder_open,
            snapshots::snapshot_configure,
            snapshots::snapshot_state,
            snapshots::snapshot_check_shortcut,
            snapshots::snapshot_suppress,
            snapshots::snapshot_pending,
            snapshots::snapshot_read,
            snapshots::snapshot_ack,
        ])
        .on_permission_request(|webview, kind| tabs::permission(&webview, kind))
        .setup(|app| {
            start(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } if window.label() == MAIN && !QUITTING.load(Ordering::SeqCst) => {
                api.prevent_close();
                let _ = window.hide();
                explain_tray_once(window.app_handle());
            }
            // The strip and the page are laid out by hand; the strip also redraws its maximise button.
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } if window.label() == MAIN => {
                tabs::layout(window.app_handle());
                tabs::render(window.app_handle());
            }
            // The window buttons grey out behind other windows (on Windows, snap.rs hears it).
            #[cfg(not(windows))]
            WindowEvent::Focused(_) if window.label() == MAIN => tabs::render(window.app_handle()),
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("Willow could not start")
        .run(|app, event| match event {
            RunEvent::Exit => app.state::<Children>().stop_all(),
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main(app),
            _ => {}
        });
}

/// What the window shows: Willow's own server, or a Vite dev server in development.
struct Site {
    url: Url,
    port: u16,
    dev: bool,
}

fn site(app: &AppHandle) -> Result<Site, String> {
    if cfg!(debug_assertions) {
        if let Ok(dev) = std::env::var("WILLOW_DESKTOP_DEV_URL") {
            let url = Url::parse(&dev).map_err(|error| format!("WILLOW_DESKTOP_DEV_URL is not a URL: {error}"))?;
            let port = url.port_or_known_default().unwrap_or(80);
            return Ok(Site { url, port, dev: true });
        }
    }
    let port = server_port(app)?;
    let url = Url::parse(&format!("http://localhost:{port}/")).map_err(|error| error.to_string())?;
    Ok(Site { url, port, dev: false })
}

/// Willow keeps everything — chats, dots, settings, keys — in the webview's
/// storage for its origin. A new port would be a new origin, which looks like
/// a new, empty Willow, so the port is chosen once and kept.
fn server_port(app: &AppHandle) -> Result<u16, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    let file = dir.join("server.json");
    let saved = fs::read_to_string(&file)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("port")?.as_u64())
        .and_then(|port| u16::try_from(port).ok());
    if let Some(port) = saved {
        return Ok(port);
    }
    let port = PORTS
        .clone()
        .find(|port| port_free(*port))
        .ok_or_else(|| format!("No free port between {} and {} for Willow's server.", PORTS.start, PORTS.end - 1))?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    fs::write(&file, serde_json::json!({ "port": port }).to_string()).map_err(|error| error.to_string())?;
    Ok(port)
}

/// Free on both loopback addresses: the window asks for `localhost`, which may resolve to either.
fn port_free(port: u16) -> bool {
    let v6_free = match TcpListener::bind(("::1", port)) {
        Ok(_) => true,
        Err(error) => error.kind() != std::io::ErrorKind::AddrInUse,
    };
    TcpListener::bind(("127.0.0.1", port)).is_ok() && v6_free
}

fn any_free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

/// Where this launch's companion listens, and its pairing token: the agents' server relays it
/// to Willow on a phone (harness.rs).
pub(crate) struct Companion {
    pub(crate) port: u16,
    pub(crate) token: String,
}

fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let site = site(app)?;
    let companion_port = any_free_port()?;
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    app.manage(Companion { port: companion_port, token: token.clone() });

    #[cfg(windows)]
    let args = Some(browser_args());
    #[cfg(not(windows))]
    let args = None;
    let content = tabs::ContentSetup {
        origin: site.url.clone(),
        scripts: vec![
            companion_handoff(&site.url.origin().ascii_serialization(), companion_port, &token),
            tabs::page_script(&site.url),
            tabs::material_script(),
        ],
        browser_args: args.clone(),
    };
    // On Windows the app answers Willow's pages itself; see pages.rs.
    #[cfg(windows)]
    let content = {
        let mut content = content;
        // A missing part is reported by `launch`, which says so in a dialog.
        if let (false, Ok(root), Ok(node), Ok(logs)) = (site.dev, payload_root(app), bundled_node(), app.path().app_log_dir()) {
            app.manage(pages::Pages::new(site.port, root, node, logs.join("server.log")));
            content.scripts.push(pages::stream_script(&site.url));
        }
        content
    };
    pets::setup(app, args);
    tabs::open_window(app, content, !std::env::args().any(|arg| arg == HIDDEN))?;
    tray(app)?;
    agents_backup::start(app);

    let app = app.clone();
    thread::spawn(move || match launch(&app, &site, companion_port, &token) {
        Ok(()) => tabs::site_ready(&app),
        Err(message) => fail(&app, &message),
    });
    Ok(())
}

/// `/llm-proxy`, read as it arrives: WebView2 gives a page an answered request's body only
/// once all of it is there (pages.rs).
#[tauri::command]
fn pages_stream(
    app: AppHandle,
    webview: tauri::Webview,
    id: u64,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<(), String> {
    #[cfg(windows)]
    return pages::stream(&app, webview, id, method, url, headers, body);
    #[cfg(not(windows))]
    {
        let _ = (app, webview, id, method, url, headers, body);
        Err("Only the Windows app streams this way.".into())
    }
}

#[tauri::command]
fn pages_stream_cancel(app: AppHandle, webview: tauri::Webview, id: u64) {
    #[cfg(windows)]
    pages::cancel(&app, &webview, id);
    #[cfg(not(windows))]
    let _ = (app, webview, id);
}

/// Runs before Willow's scripts on every load of its page: where this launch's
/// companion listens, and its pairing token. Main frame only, and only on
/// Willow's own origin.
fn companion_handoff(origin: &str, port: u16, token: &str) -> String {
    let quote = |value: &str| serde_json::to_string(value).unwrap_or_default();
    format!(
        "(() => {{ if (window.location.origin !== {origin}) return; try {{ window.localStorage.setItem('willow_companion_url', {url}); window.localStorage.setItem('willow_companion_token', {token}); }} catch (error) {{}} }})();",
        origin = quote(origin),
        url = quote(&format!("ws://127.0.0.1:{port}/ws")),
        token = quote(token),
    )
}

/// wry's defaults, which setting arguments replaces, plus what keeps the page's
/// timers and renderer running while the window is hidden in the tray.
#[cfg(windows)]
fn browser_args() -> String {
    let mut args = String::from(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows",
    );
    if let Ok(port) = std::env::var("WILLOW_DESKTOP_DEBUG_PORT") {
        if port.parse::<u16>().is_ok() {
            args.push_str(&format!(" --remote-debugging-port={port}"));
        }
    }
    args
}

/// Willow's server and the companion's code: from the installed resources, or
/// straight from the repository in development.
pub(crate) fn payload_root(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        if let Some(root) = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3) {
            return Ok(root.to_path_buf());
        }
    }
    Ok(app.path().resource_dir().map_err(|error| error.to_string())?.join("willow"))
}

pub(crate) fn bundled_node() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let node = exe.with_file_name(if cfg!(windows) { "willow-node.exe" } else { "willow-node" });
    if node.exists() {
        Ok(node)
    } else {
        Err(format!("Willow's bundled Node.js is missing ({}). Reinstall Willow.", node.display()))
    }
}

fn launch(app: &AppHandle, site: &Site, companion_port: u16, token: &str) -> Result<(), String> {
    let children = app.state::<Children>();
    let logs = app.path().app_log_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&logs).map_err(|error| error.to_string())?;
    let node = bundled_node()?;
    let root = payload_root(app)?;
    let server_log = logs.join("server.log");

    // On Windows the app answers Willow's pages itself (pages.rs), so no server listens on the port.
    #[cfg(windows)]
    let answered_here = match app.try_state::<pages::Pages>() {
        Some(pages) => {
            pages.ready()?;
            true
        }
        None => false,
    };
    #[cfg(not(windows))]
    let answered_here = false;

    if !site.dev && !answered_here {
        if port_free(site.port) {
            let script = root.join("bin").join("willow.js");
            let script = script.to_string_lossy();
            let port = site.port.to_string();
            children
                .spawn(Launch {
                    name: "server",
                    program: &node,
                    args: &[&script, "--port", &port, "--host", "127.0.0.1", "--no-open"],
                    cwd: &root,
                    env: &[],
                    log: &server_log,
                })
                .map_err(|error| format!("Willow's server could not start: {error}"))?;
        } else if !serves_willow(site.port) {
            return Err(format!(
                "Willow keeps your data at port {} on this computer, and another program is using it now. Close that program, then open Willow again.",
                site.port
            ));
        }
    }

    // Optional: without the companion Willow still opens, minus local commands, files and the local browser.
    let companion = root.join("services").join("local-companion");
    let script = companion.join("src").join("index.mjs");
    let script = script.to_string_lossy();
    let port = companion_port.to_string();
    // Dots' own computers: disk images of a gigabyte or more each, so local, never roaming.
    let computers = app.path().app_local_data_dir().map_err(|error| error.to_string())?.join("computers");
    let computers = computers.to_string_lossy();
    if let Err(error) = children.spawn(Launch {
        name: "companion",
        program: &node,
        args: &[&script],
        cwd: &companion,
        env: &[("WILLOW_COMPANION_PORT", &port), ("WILLOW_COMPANION_TOKEN", token), ("WILLOW_COMPUTERS_DIR", &computers)],
        log: &logs.join("companion.log"),
    }) {
        eprintln!("[willow] the local companion did not start: {error}");
    }
    if answered_here {
        return Ok(());
    }

    let started = Instant::now();
    let timeout = Duration::from_secs(if site.dev { 120 } else { 45 });
    loop {
        if http_get(site.port, "/").is_some_and(|response| response.starts_with("HTTP/1.1 2")) {
            return Ok(());
        }
        if let Some(status) = children.exit_status("server") {
            return Err(format!("Willow's server stopped while starting ({status}). Details: {}", server_log.display()));
        }
        if started.elapsed() > timeout {
            return Err(format!("Willow's server did not answer within {} seconds. Details: {}", timeout.as_secs(), server_log.display()));
        }
        thread::sleep(Duration::from_millis(150));
    }
}

fn http_get(port: u16, path: &str) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(500)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    write!(stream, "GET {path} HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n\r\n").ok()?;
    let mut response = Vec::new();
    let _ = stream.take(64 * 1024).read_to_end(&mut response);
    Some(String::from_utf8_lossy(&response).into_owned())
}

/// A server left on Willow's port by an earlier run is Willow's own and can be used as it is.
fn serves_willow(port: u16) -> bool {
    http_get(port, "/").is_some_and(|response| response.starts_with("HTTP/1.1 200") && response.contains("Willow"))
}

fn fail(app: &AppHandle, message: &str) {
    app.dialog()
        .message(message)
        .title("Willow couldn't start")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    quit(app);
}

fn tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Willow", true, None::<&str>)?;
    let at_login = app.autolaunch().is_enabled().unwrap_or(false);
    let login = CheckMenuItem::with_id(app, "login", "Open Willow at login", true, at_login, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Willow", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &login, &quit_item])?;
    let mut builder = TrayIconBuilder::with_id("willow")
        .tooltip("Willow")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "login" => {
                let autolaunch = app.autolaunch();
                let wanted = !autolaunch.is_enabled().unwrap_or(false);
                let changed = if wanted { autolaunch.enable() } else { autolaunch.disable() };
                // The menu shows what actually took effect, not what was asked for.
                let _ = login.set_checked(autolaunch.is_enabled().unwrap_or(changed.is_ok() && wanted));
            }
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        tabs::focus_page(app);
    }
}

fn quit(app: &AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    let _ = app.save_window_state(window_state_flags());
    app.state::<Children>().stop_all();
    app.exit(0);
}

/// File → Quit Willow (Ctrl+Q), as the tray's Quit.
#[tauri::command]
async fn app_quit(app: AppHandle) {
    quit(&app);
}

/// The first time the window is closed, say where Willow went.
fn explain_tray_once(app: &AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let marker = dir.join("tray-explained");
    if marker.exists() {
        return;
    }
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(&marker, "");
    let _ = app
        .notification()
        .builder()
        .title("Willow is still running")
        .body("Your dots keep working in the background. Open or quit Willow from the tray.")
        .show();
}
