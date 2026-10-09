//! The coding agents' server: T3 Code's, forked into `vendor/t3code` and restyled for Willow's
//! agent tabs (`features/harness`). It runs on Willow's Node with a data folder of its own and
//! answers on a port kept across launches: the tabs show its page, whose storage belongs to that
//! origin, so a new port would be a new, empty T3. It starts the first time a tab asks for it and
//! again whenever it has stopped.
//!
//! A tab signs in as T3's desktop renderer does: the bootstrap token handed to the server on
//! stdin is exchanged in the page for a bearer session (`/oauth/token`). The token lasts as long
//! as Willow runs, so a restart (for network access, say) leaves the open tabs signed in.
//!
//! Network access is T3 desktop's: the server binds every interface instead of loopback, and the
//! page pairs phones and other computers with the address it advertises, this computer's on the
//! local network (`DesktopServerExposure.ts`). Tailscale Serve, when on, is the server's to run.

use std::{
    fs,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::processes::{Children, Launch};

/// Where the port is picked from, the first time; Willow's own server keeps 41730.
const PORTS: std::ops::Range<u16> = 41760..41800;
/// The first start creates T3's database, which takes a while on a slow disk.
const START_TIMEOUT: Duration = Duration::from_secs(120);
/// T3 takes these from its environment ahead of the bootstrap (`cli/config.ts`), so one inherited
/// from wherever Willow was started would move the server off the port, data folder or page that
/// Willow gave it and waits on. The `WILLOW_*` ones are Willow's to give it, or to leave unset.
const BOOTSTRAPPED: &[&str] = &[
    "T3CODE_MODE",
    "T3CODE_PORT",
    "T3CODE_HOST",
    "T3CODE_HOME",
    "T3CODE_NO_BROWSER",
    "T3CODE_BOOTSTRAP_FD",
    "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
    "T3CODE_TAILSCALE_SERVE",
    "T3CODE_TAILSCALE_SERVE_PORT",
    "VITE_DEV_SERVER_URL",
    "WILLOW_MOBILE_PORT",
    "WILLOW_COMPANION_PORT",
    "WILLOW_COMPANION_TOKEN",
    "WILLOW_FOLDER",
    "WILLOW_ROOT",
];
const LOCAL_ONLY: &str = "local-only";
const NETWORK_ACCESSIBLE: &str = "network-accessible";

#[derive(Default)]
pub struct Harness(Mutex<State>);

#[derive(Default)]
struct State {
    run: Run,
    /// Each start's process has a name of its own, so a stopped one is not mistaken for its successor.
    generation: u32,
    token: Option<String>,
}

#[derive(Default)]
enum Run {
    #[default]
    Idle,
    Starting,
    Ready { connection: Connection, process: String },
}

#[derive(Clone, Serialize)]
pub struct Connection {
    /// The server's origin, which also serves the agent tabs' page.
    url: String,
    /// Exchanged by the page for its bearer session.
    token: String,
}

/// What `agents.json` keeps, beside Willow's `server.json`.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exposure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tailscale_serve_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tailscale_serve_port: Option<u16>,
}

impl Settings {
    fn network_accessible(&self) -> bool {
        self.exposure.as_deref() == Some(NETWORK_ACCESSIBLE)
    }

    fn tailscale_serve_port(&self) -> u16 {
        self.tailscale_serve_port.unwrap_or(443)
    }
}

/// T3's `DesktopServerExposureState`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exposure {
    mode: &'static str,
    endpoint_url: Option<String>,
    advertised_host: Option<String>,
    tailscale_serve_enabled: bool,
    tailscale_serve_port: u16,
    /// The server's port, which the page builds its other endpoints with.
    port: Option<u16>,
}

/// This computer on the tailnet, from `tailscale status --json`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tailscale {
    dns_name: Option<String>,
    ipv4: Option<String>,
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|error| error.to_string())?.join("agents.json"))
}

fn read_settings(app: &AppHandle) -> Settings {
    settings_file(app)
        .ok()
        .and_then(|file| fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let file = settings_file(app)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    fs::write(&file, serde_json::to_string(settings).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
}

/// The running server, started if need be. Blocks while it starts.
pub fn connection(app: &AppHandle) -> Result<Connection, String> {
    let harness = app.state::<Harness>();
    loop {
        let mut state = harness.0.lock().unwrap();
        match &state.run {
            Run::Ready { connection, process } => {
                if app.state::<Children>().exit_status(process).is_none() {
                    return Ok(connection.clone());
                }
                state.run = Run::Idle;
            }
            Run::Starting => {
                drop(state);
                std::thread::sleep(Duration::from_millis(250));
            }
            Run::Idle => {
                state.generation += 1;
                let process = format!("agents-{}", state.generation);
                let token = state
                    .token
                    .get_or_insert_with(|| format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple()))
                    .clone();
                state.run = Run::Starting;
                drop(state);
                let started = start(app, &process, token);
                let mut state = harness.0.lock().unwrap();
                state.run = match &started {
                    Ok(connection) => {
                        watch(app.clone(), process.clone());
                        Run::Ready { connection: connection.clone(), process }
                    }
                    Err(_) => Run::Idle,
                };
                return started;
            }
        }
    }
}

/// Starts the server again if it stops on its own, as T3's desktop shell does, waiting longer after
/// each failed start. A server stopped on purpose leaves the children's list (a restart also
/// replaces it), so it never reads as exited here.
fn watch(app: AppHandle, process: String) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let current = matches!(
                &app.state::<Harness>().0.lock().unwrap().run,
                Run::Ready { process: running, .. } if *running == process
            );
            if !current {
                return;
            }
            if app.state::<Children>().exit_status(&process).is_some() {
                break;
            }
        }
        let mut delay = Duration::from_secs(1);
        while connection(&app).is_err() {
            std::thread::sleep(delay);
            delay = (delay * 2).min(Duration::from_secs(30));
        }
    });
}

/// Stops the server if it runs and starts it again with the settings as they are now.
fn restart(app: &AppHandle) -> Result<(), String> {
    let harness = app.state::<Harness>();
    let was_running = loop {
        let mut state = harness.0.lock().unwrap();
        let running = match &state.run {
            Run::Starting => None,
            Run::Ready { process, .. } => Some(Some(process.clone())),
            Run::Idle => Some(None),
        };
        match running {
            None => {
                drop(state);
                std::thread::sleep(Duration::from_millis(250));
            }
            Some(Some(process)) => {
                app.state::<Children>().stop(&process);
                state.run = Run::Idle;
                break true;
            }
            Some(None) => break false,
        }
    };
    if was_running {
        connection(app)?;
    }
    Ok(())
}

fn start(app: &AppHandle, process: &str, token: String) -> Result<Connection, String> {
    let error = |error: std::io::Error| error.to_string();
    let root = crate::payload_root(app)?.join("vendor").join("t3code").join("apps").join("server");
    let entry = root.join("dist").join("bin.mjs");
    if !entry.exists() {
        return Err(format!("The agents' server is missing ({}). Reinstall Willow.", entry.display()));
    }
    let node = crate::bundled_node()?;
    // The server's working directory bounds the folders its diffs may read, and agents with no
    // project run in it.
    let user_home = app.path().home_dir().map_err(|error| error.to_string())?;
    let home = app.path().app_local_data_dir().map_err(|error| error.to_string())?.join("agents");
    fs::create_dir_all(&home).map_err(error)?;
    crate::agents_backup::restore_if_empty(app, &home);
    let logs = app.path().app_log_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&logs).map_err(error)?;
    let port = port(app)?;
    let settings = read_settings(app);
    // T3's desktop bootstrap envelope (`DesktopBackendBootstrap`), one line on stdin.
    let bootstrap = serde_json::json!({
        "mode": "desktop",
        "noBrowser": true,
        "port": port,
        "t3Home": home,
        "host": if settings.network_accessible() { "0.0.0.0" } else { "127.0.0.1" },
        "desktopBootstrapToken": token,
        "tailscaleServeEnabled": settings.tailscale_serve_enabled.unwrap_or(false),
        "tailscaleServePort": settings.tailscale_serve_port(),
    });
    let entry = entry.to_string_lossy();
    // Willow on a phone: its page listens beside the server, which relays the companion to it
    // (the server's `willow/mobile.ts`).
    let mobile_port = port.saturating_add(1).to_string();
    let companion = app.try_state::<crate::Companion>().map(|companion| (companion.port.to_string(), companion.token.clone()));
    // The phone's Willow works on this computer's Willow folder (the server's `willow/folder.ts`).
    let willow_folder = crate::local_folder::folder(app).map(|folder| folder.to_string_lossy().into_owned());
    let mut env = vec![("T3CODE_TELEMETRY_ENABLED", "false"), ("WILLOW_MOBILE_PORT", mobile_port.as_str())];
    if let Some((port, token)) = &companion {
        env.push(("WILLOW_COMPANION_PORT", port));
        env.push(("WILLOW_COMPANION_TOKEN", token));
    }
    if let Some(folder) = &willow_folder {
        env.push(("WILLOW_FOLDER", folder));
    }
    app.state::<Children>()
        .spawn_with_input(
            Launch {
                name: process,
                program: &node,
                args: &[&entry, "--bootstrap-fd", "0"],
                cwd: &user_home,
                env: &env,
                log: &logs.join("agents.log"),
            },
            Some(format!("{bootstrap}\n").as_bytes()),
            BOOTSTRAPPED,
        )
        .map_err(|error| format!("The agents' server could not start: {error}"))?;
    if let Err(error) = wait_until_ready(app, process, port) {
        // One that timed out may still be starting, and would hold the port and the database
        // against the next start.
        app.state::<Children>().stop(process);
        return Err(error);
    }
    Ok(Connection { url: format!("http://127.0.0.1:{port}"), token })
}

fn wait_until_ready(app: &AppHandle, process: &str, port: u16) -> Result<(), String> {
    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(status) = app.state::<Children>().exit_status(process) {
            return Err(format!("The agents' server stopped as it started ({status}); its log is agents.log in Willow's logs."));
        }
        if answers(port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("The agents' server did not start in time; its log is agents.log in Willow's logs.".into())
}

/// Whether T3's environment descriptor answers, as its desktop shell checks readiness.
fn answers(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!("GET /.well-known/t3/environment HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut head = [0u8; 12];
    stream.read_exact(&mut head).is_ok() && head.starts_with(b"HTTP/1.1 200")
}

/// The port chosen the first time, kept in `agents.json`. A server just stopped can hold it a
/// moment longer, and moving would leave the tabs' storage behind with the old origin.
fn port(app: &AppHandle) -> Result<u16, String> {
    let mut settings = read_settings(app);
    if let Some(port) = settings.port {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if free(port) {
                return Ok(port);
            }
            if Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }
    let port = PORTS
        .clone()
        .find(|port| free(*port))
        .ok_or_else(|| format!("No free port between {} and {} for the agents' server.", PORTS.start, PORTS.end - 1))?;
    settings.port = Some(port);
    write_settings(app, &settings)?;
    Ok(port)
}

fn free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok() && TcpListener::bind(("0.0.0.0", port)).is_ok()
}

/// Tailscale's addresses, 100.64.0.0/10, which are the tailnet's endpoint, not the local network's.
fn is_tailscale(address: Ipv4Addr) -> bool {
    let [first, second, ..] = address.octets();
    first == 100 && (second & 0xc0) == 64
}

/// This computer's address on the local network: the one its default route leaves from. Connecting
/// a UDP socket sends nothing; it only picks the route.
fn lan_address() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    socket.connect(("8.8.8.8", 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(address) if !address.is_loopback() && !address.is_link_local() && !address.is_unspecified() && !is_tailscale(address) => {
            Some(address)
        }
        _ => None,
    }
}

fn exposure(app: &AppHandle) -> Exposure {
    let settings = read_settings(app);
    let advertised = settings.network_accessible().then(lan_address).flatten();
    Exposure {
        mode: if settings.network_accessible() { NETWORK_ACCESSIBLE } else { LOCAL_ONLY },
        endpoint_url: match (advertised, settings.port) {
            (Some(address), Some(port)) => Some(format!("http://{address}:{port}")),
            _ => None,
        },
        advertised_host: advertised.map(|address| address.to_string()),
        tailscale_serve_enabled: settings.tailscale_serve_enabled.unwrap_or(false),
        tailscale_serve_port: settings.tailscale_serve_port(),
        port: settings.port,
    }
}

fn set_exposure(app: &AppHandle, mode: &str) -> Result<Exposure, String> {
    let network = match mode {
        LOCAL_ONLY => false,
        NETWORK_ACCESSIBLE => true,
        other => return Err(format!("Unknown network access mode: {other}.")),
    };
    if network && lan_address().is_none() {
        let port = read_settings(app).port.map(|port| format!(" on port {port}")).unwrap_or_default();
        return Err(format!("No reachable network address is available for network access{port}."));
    }
    let mut settings = read_settings(app);
    settings.exposure = Some(mode.to_string());
    write_settings(app, &settings)?;
    restart(app)?;
    Ok(exposure(app))
}

fn set_tailscale_serve(app: &AppHandle, enabled: bool, port: Option<u16>) -> Result<Exposure, String> {
    let mut settings = read_settings(app);
    settings.tailscale_serve_enabled = Some(enabled);
    if let Some(port) = port {
        settings.tailscale_serve_port = Some(port);
    }
    write_settings(app, &settings)?;
    restart(app)?;
    Ok(exposure(app))
}

fn tailscale() -> Option<Tailscale> {
    let mut command = std::process::Command::new("tailscale");
    command.args(["status", "--json"]).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().ok().filter(|output| output.status.success())?;
    let status: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let me = status.get("Self")?;
    let dns_name = me
        .get("DNSName")
        .and_then(|name| name.as_str())
        .map(|name| name.trim_end_matches('.').to_string())
        .filter(|name| !name.is_empty());
    let ipv4 = me
        .get("TailscaleIPs")
        .and_then(|ips| ips.as_array())
        .and_then(|ips| ips.iter().filter_map(|ip| ip.as_str()).find(|ip| ip.parse::<Ipv4Addr>().is_ok()))
        .map(str::to_string);
    Some(Tailscale { dns_name, ipv4 })
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| error.to_string())
}

/// The agents' server, for the agent tabs: its origin and the token its page signs in with.
#[tauri::command]
pub async fn harness_connection(app: AppHandle) -> Result<Connection, String> {
    blocking(move || connection(&app)).await?
}

/// Whether the agents' server is open to the network, and at which address.
#[tauri::command]
pub async fn harness_exposure(app: AppHandle) -> Result<Exposure, String> {
    blocking(move || exposure(&app)).await
}

/// Opens the agents' server to the local network or closes it again; the server restarts.
#[tauri::command]
pub async fn harness_set_exposure(app: AppHandle, mode: String) -> Result<Exposure, String> {
    blocking(move || set_exposure(&app, &mode)).await?
}

/// Turns the server's Tailscale Serve (HTTPS on the tailnet) on or off; the server restarts.
#[tauri::command]
pub async fn harness_set_tailscale_serve(app: AppHandle, enabled: bool, port: Option<u16>) -> Result<Exposure, String> {
    blocking(move || set_tailscale_serve(&app, enabled, port)).await?
}

/// This computer on the tailnet, or nothing when Tailscale is not installed or not signed in.
#[tauri::command]
pub async fn harness_tailscale() -> Result<Option<Tailscale>, String> {
    blocking(tailscale).await
}

/// How many agent threads wait on the user, on Willow's taskbar button: the page's drawing as an
/// overlay on Windows (`rgba`, `size` pixels square), the platform's badge count elsewhere.
#[tauri::command]
pub fn harness_set_badge(app: AppHandle, count: u32, rgba: Option<Vec<u8>>, size: Option<u32>) -> Result<(), String> {
    let Some(window) = app.get_window(crate::tabs::MAIN) else { return Ok(()) };
    #[cfg(windows)]
    {
        let icon = match (rgba, size) {
            (Some(rgba), Some(size)) if count > 0 && rgba.len() == (size as usize).pow(2) * 4 => {
                Some(tauri::image::Image::new_owned(rgba, size, size))
            }
            _ => None,
        };
        window.set_overlay_icon(icon).map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (rgba, size);
        window.set_badge_count((count > 0).then_some(i64::from(count))).map_err(|error| error.to_string())
    }
}
