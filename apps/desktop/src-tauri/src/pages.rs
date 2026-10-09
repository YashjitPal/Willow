//! Willow's pages without a server (Windows).
//!
//! Every request the page makes to Willow's address — http://localhost:<port>/…,
//! and Spark's remote-browser sites at http://<site>.wb.localhost:<port>/… — is
//! answered inside the app, so nothing listens on that port and only the app's
//! own windows can open Willow. The address itself is unchanged, and with it
//! everything the pages keep there: chats, settings, sign-in.
//!
//! Willow's built files come straight from the install, served as `bin/willow.js`
//! serves them. The requests that need Willow's server — Spark's browser,
//! `/llm-proxy` and `/api/fetch-source` — go to `bin/willow.js` over a named
//! pipe, started the first time one arrives, which accepts only requests that
//! carry this launch's token.
//!
//! WebView2 hands a page an answered request's body only once all of it has
//! arrived. That is fine for files and pages, but it would turn a model's
//! streamed answer into one block at the end, so the page's fetches for
//! `/llm-proxy` come through `stream` instead (see `stream_script`), and the
//! reply goes back in pieces as it arrives.

use std::{
    collections::HashSet,
    fs,
    io::{self, BufRead, BufReader, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tauri::{AppHandle, Manager, Url, Webview};
use webview2_com::{take_pwstr, Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler};
use windows::{
    core::{Interface, BOOL, HSTRING, PWSTR},
    Win32::{System::Com::IStream, UI::Shell::SHCreateMemStream},
};

use crate::processes::{Children, Launch};

const BROWSE_SUFFIX: &str = ".wb.localhost";
const SERVER_START: Duration = Duration::from_secs(20);
/// Busy: every instance of the pipe is serving someone. Not found: the server is still starting.
const PIPE_BUSY: i32 = 231;
const PIPE_MISSING: i32 = 2;

/// Where Willow's pages come from, for the whole run.
pub struct Pages {
    port: u16,
    dist: PathBuf,
    root: PathBuf,
    node: PathBuf,
    log: PathBuf,
    server: Mutex<Option<Arc<Server>>>,
    /// Streams their page stopped reading, by webview and the page's own id.
    cancelled: Mutex<HashSet<String>>,
}

struct Server {
    name: String,
    pipe: String,
    token: String,
}

impl Pages {
    pub fn new(port: u16, root: PathBuf, node: PathBuf, log: PathBuf) -> Self {
        Pages {
            port,
            dist: root.join("apps").join("studio").join("dist"),
            root,
            node,
            log,
            server: Mutex::new(None),
            cancelled: Mutex::new(HashSet::new()),
        }
    }

    pub fn ready(&self) -> Result<(), String> {
        if self.dist.join("index.html").is_file() {
            Ok(())
        } else {
            Err(format!("Willow's interface is missing ({}). Reinstall Willow.", self.dist.display()))
        }
    }

    /// Willow's server, started on first use and again if it has stopped.
    fn server(&self, app: &AppHandle) -> Result<Arc<Server>, String> {
        let children = app.state::<Children>();
        let mut slot = self.server.lock().unwrap();
        if let Some(server) = slot.as_ref() {
            if children.exit_status(&server.name).is_none() {
                return Ok(server.clone());
            }
        }
        let id = uuid::Uuid::new_v4().simple().to_string();
        let server = Server {
            name: format!("server-{id}"),
            pipe: format!(r"\\.\pipe\willow-{id}"),
            token: format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple()),
        };
        let script = self.root.join("bin").join("willow.js");
        let script = script.to_string_lossy();
        children
            .spawn(Launch {
                name: &server.name,
                program: &self.node,
                args: &[&script, "--pipe", &server.pipe, "--no-open"],
                cwd: &self.root,
                env: &[("WILLOW_PIPE_TOKEN", &server.token)],
                log: &self.log,
            })
            .map_err(|error| format!("Willow's server could not start: {error}"))?;
        let started = Instant::now();
        loop {
            match fs::OpenOptions::new().read(true).write(true).open(&server.pipe) {
                Ok(_) => break,
                Err(_) if children.exit_status(&server.name).is_some() => {
                    return Err(format!("Willow's server stopped while starting. Details: {}", self.log.display()));
                }
                Err(_) if started.elapsed() < SERVER_START => thread::sleep(Duration::from_millis(25)),
                Err(error) => return Err(format!("Willow's server did not start: {error}")),
            }
        }
        let server = Arc::new(server);
        *slot = Some(server.clone());
        Ok(server)
    }
}

/// Whether this run answers Willow's pages itself.
pub fn active(app: &AppHandle) -> bool {
    app.try_state::<Pages>().is_some()
}

/// Has the webview answer Willow's addresses, then sends it to `then`.
pub fn install(app: &AppHandle, webview: &Webview, then: Option<Url>) {
    let Some(port) = app.try_state::<Pages>().map(|pages| pages.port) else { return };
    let app = app.clone();
    let target = webview.clone();
    let result = webview.with_webview(move |platform| {
        // SAFETY: WebView2 calls made on the webview's own thread, where this runs.
        let attached = unsafe { attach(&app, &platform.controller(), port) };
        if let Err(error) = attached {
            eprintln!("[willow] pages could not be attached to the page's webview: {error}");
        }
        if let Some(url) = then {
            let _ = target.navigate(url);
        }
    });
    if let Err(error) = result {
        eprintln!("[willow] pages could not be attached to the page's webview: {error}");
    }
}

unsafe fn attach(app: &AppHandle, controller: &ICoreWebView2Controller, port: u16) -> windows::core::Result<()> {
    let webview = controller.CoreWebView2()?;
    let env = webview.cast::<ICoreWebView2_2>()?.Environment()?;
    for filter in [format!("http://localhost:{port}/*"), format!("http://*{BROWSE_SUFFIX}:{port}/*")] {
        let filter = HSTRING::from(filter);
        // The newer filter also covers workers, which the older one misses.
        if let Ok(webview) = webview.cast::<ICoreWebView2_22>() {
            webview.AddWebResourceRequestedFilterWithRequestSourceKinds(
                &filter,
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )?;
        } else {
            webview.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;
        }
    }
    let app = app.clone();
    let mut token = 0i64;
    webview.add_WebResourceRequested(
        &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                accept(&app, &env, port, args);
            }
            Ok(())
        })),
        &mut token,
    )?;
    Ok(())
}

/* ------------------------------------------------------------------------ */
/* Requests                                                                  */
/* ------------------------------------------------------------------------ */

enum Route {
    File(String),
    Server,
}

/// Which of Willow's addresses this is, if any. Tauri's own pages pass through untouched.
fn route(url: &Url, port: u16) -> Option<Route> {
    if url.scheme() != "http" || url.port() != Some(port) {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    if host.ends_with(BROWSE_SUFFIX) {
        return Some(Route::Server);
    }
    if host != "localhost" {
        return None;
    }
    let path = url.path();
    if path.starts_with("/llm-proxy") || path.starts_with("/api/fetch-source") {
        Some(Route::Server)
    } else {
        Some(Route::File(path.to_string()))
    }
}

struct Request {
    method: String,
    url: Url,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

/// WebView2 objects stay on the webview's thread; this carries them back to it.
struct OnMainThread<T>(T);
// SAFETY: only ever opened again inside `run_on_main_thread`, on the thread that made them.
unsafe impl<T> Send for OnMainThread<T> {}

impl<T> OnMainThread<T> {
    /// Taken as a whole, so a closure moves the wrapper and not its non-`Send` insides.
    fn into_inner(self) -> T {
        self.0
    }
}

struct Pending {
    args: ICoreWebView2WebResourceRequestedEventArgs,
    env: ICoreWebView2Environment,
    deferral: ICoreWebView2Deferral,
}

/// Runs on the webview's thread for every request WebView2 is about to make.
fn accept(app: &AppHandle, env: &ICoreWebView2Environment, port: u16, args: ICoreWebView2WebResourceRequestedEventArgs) {
    // SAFETY: WebView2 calls on its own thread, inside its event.
    let read = unsafe { read_request(&args) };
    let Some(request) = read else { return };
    let Some(route) = route(&request.url, port) else { return };
    // SAFETY: as above.
    let Ok(deferral) = (unsafe { args.GetDeferral() }) else { return };
    let pending = OnMainThread(Pending { args, env: env.clone(), deferral });
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (head, body) = match (route, app.try_state::<Pages>()) {
            (_, None) => error(503, "Willow is not ready."),
            (Route::File(path), Some(pages)) => serve_file(&pages.dist, &request.method, &path),
            (Route::Server, Some(pages)) => match pages.server(&app).and_then(|server| fetch(&server, &request)) {
                Ok(reply) => reply,
                Err(message) => error(502, &message),
            },
        };
        respond(&app, pending, head, body);
    });
}

unsafe fn read_request(args: &ICoreWebView2WebResourceRequestedEventArgs) -> Option<Request> {
    let request = args.Request().ok()?;
    let mut uri = PWSTR::null();
    request.Uri(&mut uri).ok()?;
    let url = Url::parse(&take_pwstr(uri)).ok()?;
    let mut method = PWSTR::null();
    request.Method(&mut method).ok()?;
    let method = take_pwstr(method);

    let mut headers = Vec::new();
    if let Ok(iterator) = request.Headers().and_then(|headers| headers.GetIterator()) {
        let mut more = BOOL::default();
        let _ = iterator.HasCurrentHeader(&mut more);
        while more.as_bool() {
            let (mut name, mut value) = (PWSTR::null(), PWSTR::null());
            if iterator.GetCurrentHeader(&mut name, &mut value).is_ok() {
                headers.push((take_pwstr(name), take_pwstr(value)));
            }
            if iterator.MoveNext(&mut more).is_err() {
                break;
            }
        }
    }

    let mut body = Vec::new();
    if let Ok(content) = request.Content() {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            let mut read = 0u32;
            if content.Read(buffer.as_mut_ptr().cast(), buffer.len() as u32, Some(&mut read)).is_err() || read == 0 {
                break;
            }
            body.extend_from_slice(&buffer[..read as usize]);
        }
    }
    Some(Request { method, url, headers, body })
}

struct Head {
    status: u16,
    reason: String,
    headers: Vec<(String, String)>,
}

fn error(status: u16, message: &str) -> (Head, Vec<u8>) {
    let head = Head {
        status,
        reason: reason(status).to_string(),
        headers: vec![("Content-Type".into(), "text/plain; charset=utf-8".into())],
    };
    (head, message.as_bytes().to_vec())
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "",
    }
}

/// Hands the response to WebView2, on its thread.
fn respond(app: &AppHandle, pending: OnMainThread<Pending>, head: Head, body: Vec<u8>) {
    let _ = app.run_on_main_thread(move || {
        let Pending { args, env, deferral } = pending.into_inner();
        let headers: String = head.headers.iter().map(|(name, value)| format!("{name}: {value}\r\n")).collect();
        // SAFETY: WebView2 calls on its own thread.
        unsafe {
            let content: Option<IStream> = if body.is_empty() { None } else { SHCreateMemStream(Some(&body)) };
            if let Ok(response) = env.CreateWebResourceResponse(
                content.as_ref(),
                i32::from(head.status),
                &HSTRING::from(head.reason.as_str()),
                &HSTRING::from(headers),
            ) {
                let _ = args.SetResponse(&response);
            }
            let _ = deferral.Complete();
        }
    });
}

/* ------------------------------------------------------------------------ */
/* Willow's files, as bin/willow.js serves them                              */
/* ------------------------------------------------------------------------ */

const MIME_TYPES: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("js", "application/javascript; charset=utf-8"),
    ("mjs", "application/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json; charset=utf-8"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
    ("ico", "image/x-icon"),
    ("wasm", "application/wasm"),
    ("woff2", "font/woff2"),
    ("woff", "font/woff"),
    ("ttf", "font/ttf"),
    ("mp3", "audio/mpeg"),
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("txt", "text/plain; charset=utf-8"),
];

fn serve_file(dist: &Path, method: &str, raw_path: &str) -> (Head, Vec<u8>) {
    if method != "GET" && method != "HEAD" {
        return error(405, "Method Not Allowed");
    }
    let Some(path) = decode_path(raw_path) else { return error(400, "Bad Request") };
    let mut segments = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => return error(403, "Forbidden"),
            segment if segment.contains(['\\', ':']) => return error(403, "Forbidden"),
            segment => segments.push(segment),
        }
    }
    let mut file = segments.iter().fold(dist.to_path_buf(), |path, segment| path.join(segment));
    if file.is_dir() {
        file = file.join("index.html");
    }
    // Pages fall back to the app; a missing asset is a 404.
    let is_asset = path.starts_with("/assets/") || segments.last().is_some_and(|name| name.contains('.'));
    if !file.is_file() && !is_asset {
        file = dist.join("index.html");
    }
    let Ok(bytes) = fs::read(&file) else { return error(404, "Not Found") };

    let extension = file.extension().and_then(|extension| extension.to_str()).unwrap_or("").to_ascii_lowercase();
    let content_type = MIME_TYPES.iter().find(|(known, _)| *known == extension).map_or("application/octet-stream", |(_, mime)| mime);
    let mut headers = vec![("Content-Type".to_string(), content_type.to_string())];
    // The dot character's frame alone is isolated: its engine needs SharedArrayBuffer.
    if is_dot_character_frame(&path) {
        headers.push(("Document-Isolation-Policy".into(), "isolate-and-require-corp".into()));
        headers.push(("Content-Security-Policy".into(), "frame-ancestors 'self'".into()));
    }
    let immutable = file.strip_prefix(dist).is_ok_and(|relative| relative.starts_with("assets"));
    headers.push(("Cache-Control".into(), if immutable { "public, max-age=31536000, immutable" } else { "no-cache" }.into()));
    headers.push(("Content-Length".into(), bytes.len().to_string()));
    let head = Head { status: 200, reason: "OK".into(), headers };
    (head, if method == "HEAD" { Vec::new() } else { bytes })
}

/// `/codex/assets/orbit-character-<16 hex>/<16 hex>/frame.html`
fn is_dot_character_frame(path: &str) -> bool {
    let hex = |text: &str| text.len() == 16 && text.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'));
    matches!(
        path.split('/').collect::<Vec<_>>().as_slice(),
        ["", "codex", "assets", character, version, "frame.html"]
            if character.strip_prefix("orbit-character-").is_some_and(hex) && hex(version)
    )
}

fn decode_path(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = raw.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

/* ------------------------------------------------------------------------ */
/* Willow's server, over its pipe                                            */
/* ------------------------------------------------------------------------ */

/// Headers HTTP/1.1 uses for the connection itself, which each side sets for its own.
const HOP_BY_HOP: &[&str] = &["connection", "keep-alive", "transfer-encoding", "content-length", "host", "x-willow-pipe-token"];

/// The whole reply, for WebView2.
fn fetch(server: &Server, request: &Request) -> Result<(Head, Vec<u8>), String> {
    let (head, mut reader, framing) = exchange(server, request).map_err(|error| format!("Willow's server did not answer: {error}"))?;
    let mut body = Vec::new();
    framing
        .copy(&mut reader, &mut |bytes| {
            body.extend_from_slice(bytes);
            true
        })
        .map_err(|error| format!("Willow's server stopped mid-reply: {error}"))?;
    Ok((head, body))
}

enum Framing {
    Chunked,
    Length(u64),
    UntilClose,
    None,
}

impl Framing {
    /// Passes the body on as it arrives, until it ends or `sink` says to stop.
    fn copy(&self, reader: &mut impl BufRead, sink: &mut dyn FnMut(&[u8]) -> bool) -> io::Result<()> {
        let mut buffer = vec![0u8; 16 * 1024];
        let size = buffer.len();
        match self {
            Framing::None => Ok(()),
            Framing::Length(length) => {
                let mut left = *length;
                while left > 0 {
                    let read = reader.read(&mut buffer[..left.min(size as u64) as usize])?;
                    if read == 0 || !sink(&buffer[..read]) {
                        break;
                    }
                    left -= read as u64;
                }
                Ok(())
            }
            Framing::UntilClose => loop {
                let read = reader.read(&mut buffer)?;
                if read == 0 || !sink(&buffer[..read]) {
                    return Ok(());
                }
            },
            Framing::Chunked => loop {
                let mut line = String::new();
                reader.read_line(&mut line)?;
                let chunk = usize::from_str_radix(line.trim().split(';').next().unwrap_or(""), 16)
                    .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "bad chunk"))?;
                if chunk == 0 {
                    return Ok(());
                }
                let mut left = chunk;
                while left > 0 {
                    let read = reader.read(&mut buffer[..left.min(size)])?;
                    if read == 0 || !sink(&buffer[..read]) {
                        return Ok(());
                    }
                    left -= read;
                }
                let mut end = [0u8; 2];
                reader.read_exact(&mut end)?;
            },
        }
    }
}

/// Sends the request over a fresh connection and reads the reply's head.
fn exchange(server: &Server, request: &Request) -> io::Result<(Head, BufReader<fs::File>, Framing)> {
    let mut pipe = connect(&server.pipe)?;
    let host = match request.url.port() {
        Some(port) => format!("{}:{port}", request.url.host_str().unwrap_or("localhost")),
        None => request.url.host_str().unwrap_or("localhost").to_string(),
    };
    let target = match request.url.query() {
        Some(query) => format!("{}?{query}", request.url.path()),
        None => request.url.path().to_string(),
    };
    let mut head = format!("{} {target} HTTP/1.1\r\nHost: {host}\r\n", request.method);
    for (name, value) in &request.headers {
        if !HOP_BY_HOP.contains(&name.to_ascii_lowercase().as_str()) && !value.contains(['\r', '\n']) {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
    }
    head.push_str(&format!(
        "x-willow-pipe-token: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        server.token,
        request.body.len()
    ));
    pipe.write_all(head.as_bytes())?;
    pipe.write_all(&request.body)?;
    pipe.flush()?;

    let mut reader = BufReader::new(pipe);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.trim_end().splitn(3, ' ');
    let status = parts
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "no status line"))?;
    let reason_phrase = parts.next().unwrap_or_default().to_string();

    let mut headers = Vec::new();
    let mut length = None;
    let mut chunked = false;
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let text = line.trim_end();
        if text.is_empty() {
            break;
        }
        let Some((name, value)) = text.split_once(':') else { continue };
        let (name, value) = (name.trim(), value.trim());
        match name.to_ascii_lowercase().as_str() {
            "transfer-encoding" => chunked = value.to_ascii_lowercase().contains("chunked"),
            "content-length" => {
                length = value.parse::<u64>().ok();
                headers.push((name.to_string(), value.to_string()));
            }
            "connection" | "keep-alive" => {}
            _ => headers.push((name.to_string(), value.to_string())),
        }
    }
    let framing = if request.method == "HEAD" || matches!(status, 204 | 304) || (100..200).contains(&status) {
        Framing::None
    } else if chunked {
        headers.retain(|(name, _)| !name.eq_ignore_ascii_case("content-length"));
        Framing::Chunked
    } else if let Some(length) = length {
        Framing::Length(length)
    } else {
        Framing::UntilClose
    };
    Ok((Head { status, reason: reason_phrase, headers }, reader, framing))
}

fn connect(pipe: &str) -> io::Result<fs::File> {
    let started = Instant::now();
    loop {
        match fs::OpenOptions::new().read(true).write(true).open(pipe) {
            Ok(file) => return Ok(file),
            Err(error)
                if matches!(error.raw_os_error(), Some(PIPE_BUSY | PIPE_MISSING)) && started.elapsed() < Duration::from_secs(10) =>
            {
                thread::sleep(Duration::from_millis(5));
            }
            Err(error) => return Err(error),
        }
    }
}

/* ------------------------------------------------------------------------ */
/* /llm-proxy, streamed                                                      */
/* ------------------------------------------------------------------------ */

/// Answers a page's fetch for `/llm-proxy` in pieces: `head`, then each `chunk` as it
/// arrives, then `end` (or `error`), each delivered to the page's `__willowPagesStream`.
pub fn stream(
    app: &AppHandle,
    webview: Webview,
    id: u64,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<(), String> {
    let pages = app.try_state::<Pages>().ok_or("Willow is not answering its pages here.")?;
    let url = Url::parse(&url).map_err(|error| error.to_string())?;
    if url.host_str() != Some("localhost") || !matches!(route(&url, pages.port), Some(Route::Server)) || !url.path().starts_with("/llm-proxy") {
        return Err("Only /llm-proxy is streamed this way.".into());
    }
    let body = match body {
        Some(text) => BASE64.decode(text).map_err(|error| error.to_string())?,
        None => Vec::new(),
    };
    let request = Request { method, url, headers, body };
    let key = format!("{}:{id}", webview.label());
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let emit = |kind: &str, payload: serde_json::Value| {
            let _ = webview.eval(format!("window.__willowPagesStream && window.__willowPagesStream({id}, {kind:?}, {payload})"));
        };
        let Some(pages) = app.try_state::<Pages>() else { return };
        let reply = pages
            .server(&app)
            .and_then(|server| exchange(&server, &request).map_err(|error| format!("Willow's server did not answer: {error}")));
        match reply {
            Err(message) => emit("error", serde_json::json!(message)),
            Ok((head, mut reader, framing)) => {
                emit("head", serde_json::json!({ "status": head.status, "statusText": head.reason, "headers": head.headers }));
                let copied = framing.copy(&mut reader, &mut |bytes| {
                    if pages.cancelled.lock().unwrap().contains(&key) {
                        return false;
                    }
                    emit("chunk", serde_json::json!(BASE64.encode(bytes)));
                    true
                });
                match copied {
                    Ok(()) => emit("end", serde_json::Value::Null),
                    Err(error) => emit("error", serde_json::json!(format!("Willow's server stopped mid-reply: {error}"))),
                }
            }
        }
        pages.cancelled.lock().unwrap().remove(&key);
    });
    Ok(())
}

/// The page stopped reading a stream; it ends at its next piece.
pub fn cancel(app: &AppHandle, webview: &Webview, id: u64) {
    if let Some(pages) = app.try_state::<Pages>() {
        pages.cancelled.lock().unwrap().insert(format!("{}:{id}", webview.label()));
    }
}

/// Runs before Willow's scripts: its fetches for `/llm-proxy` go through `stream`.
pub fn stream_script(origin: &Url) -> String {
    let origin = serde_json::to_string(&origin.origin().ascii_serialization()).unwrap_or_default();
    format!(
        r#"(() => {{
  if (window.location.origin !== {origin}) return;
  const internals = window.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== 'function') return;
  const native = window.fetch.bind(window);
  const streams = new Map();
  let next = 1;
  const toBase64 = (bytes) => {{
    let text = '';
    for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
    return btoa(text);
  }};
  const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  window.__willowPagesStream = (id, kind, payload) => {{
    const stream = streams.get(id);
    if (stream) stream[kind](payload);
  }};
  window.fetch = function (input, init) {{
    // Anything but /llm-proxy goes to the browser untouched. Its address is read without making
    // a Request of it: a Request made from another takes that one's body, and Firestore's
    // channel, which sends Requests with bodies, then has nothing left to send.
    let url;
    try {{ url = new URL(input instanceof Request ? input.url : String(input), window.location.href); }} catch {{ return native(input, init); }}
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/llm-proxy')) return native(input, init);
    let request;
    try {{ request = new Request(input, init); }} catch {{ return native(input, init); }}
    return new Promise((resolve, reject) => {{
      const id = next++;
      let controller;
      let settled = false;
      const stop = () => {{ streams.delete(id); internals.invoke('pages_stream_cancel', {{ id }}).catch(() => {{}}); }};
      const body = new ReadableStream({{ start(c) {{ controller = c; }}, cancel: stop }});
      const fail = (error) => {{
        streams.delete(id);
        if (!settled) {{ settled = true; reject(error); }}
        else {{ try {{ controller.error(error); }} catch {{}} }}
      }};
      const signal = request.signal;
      if (signal) {{
        if (signal.aborted) return reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
        signal.addEventListener('abort', () => {{ stop(); fail(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')); }}, {{ once: true }});
      }}
      streams.set(id, {{
        head({{ status, statusText, headers }}) {{
          settled = true;
          resolve(new Response(status === 204 || status === 304 ? null : body, {{ status, statusText, headers }}));
        }},
        chunk(text) {{ try {{ controller.enqueue(fromBase64(text)); }} catch {{}} }},
        end() {{ streams.delete(id); try {{ controller.close(); }} catch {{}} }},
        error(message) {{ fail(new TypeError(message || 'Failed to fetch')); }},
      }});
      const send = (payload) => internals.invoke('pages_stream', {{ id, method: request.method, url: url.href, headers: [...request.headers], body: payload }})
        .catch((error) => fail(new TypeError(String(error))));
      if (request.method === 'GET' || request.method === 'HEAD') send(null);
      else request.arrayBuffer().then((buffer) => send(toBase64(new Uint8Array(buffer))), fail);
    }});
  }};
}})();"#
    )
}
