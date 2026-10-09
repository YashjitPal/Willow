//! The Willow folder: where Willow's pages keep chats, projects and media on this computer.
//!
//! In the app, saving there is always on. The page reaches the folder through the File System
//! Access API, as it does in a browser, but it never has to pick it: this hands it a handle
//! WebView2 makes for the folder, already allowed to read and write (Windows), so there is no
//! picker and no Authorize prompt on the first run or after a restart. The folder is
//! `<home>\Willow` until the user picks another in Settings; that pick is kept in
//! `local-folder.json` in the app's config folder.

use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager, Webview};

const PICKED: &str = "local-folder.json";

fn picked_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(PICKED))
}

/// The folder picked in Settings, else `<home>\Willow`. Also where the pet library lives (`pets.rs`).
pub(crate) fn folder(app: &AppHandle) -> Option<PathBuf> {
    // An editor may have saved it with a byte-order mark, which JSON does not allow.
    let picked = picked_file(app)
        .and_then(|file| fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}')).ok())
        .and_then(|saved| saved.get("path")?.as_str().map(PathBuf::from));
    picked.or_else(|| app.path().home_dir().ok().map(|home| home.join("Willow")))
}

fn remember(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let file = picked_file(app).ok_or("Willow has no settings folder to keep the pick in.")?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&file, serde_json::json!({ "path": dir }).to_string()).map_err(|error| error.to_string())
}

/// Hands the page its Willow folder, as the web message `{ willowLocalFolder: request }`: the
/// folder picked in Settings, else `<home>\Willow`, or `path`, which `keep` makes the folder
/// from then on. `create` makes the folder when it is missing; otherwise a missing folder is an
/// error. Answers with the folder's path.
#[tauri::command]
pub async fn local_folder_open(
    app: AppHandle,
    webview: Webview,
    request: u64,
    create: bool,
    path: Option<String>,
    keep: bool,
) -> Result<String, String> {
    let picked = keep && path.is_some();
    let dir = match path {
        Some(path) => PathBuf::from(path),
        None => folder(&app).ok_or("Willow could not find your home folder.")?,
    };
    if create {
        fs::create_dir_all(&dir).map_err(|error| format!("{} could not be made: {error}", dir.display()))?;
    }
    if !dir.is_dir() {
        return Err(format!("{} is not there.", dir.display()));
    }
    post(&webview, request, &dir).await?;
    if picked {
        remember(&app, &dir)?;
    }
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(windows)]
async fn post(webview: &Webview, request: u64, dir: &Path) -> Result<(), String> {
    use std::{sync::mpsc, time::Duration};
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::{
        core::{IUnknown, Interface, HSTRING},
        Win32::Foundation::E_POINTER,
    };

    let folder = HSTRING::from(dir);
    let message = HSTRING::from(serde_json::json!({ "willowLocalFolder": request }).to_string());
    let (sent, posted) = mpsc::channel::<Result<(), String>>();
    webview
        .with_webview(move |platform| {
            // SAFETY: WebView2 calls made on the webview's own thread, where this runs.
            let result = unsafe {
                (|| -> windows::core::Result<()> {
                    let core = platform.controller().CoreWebView2()?;
                    let env = core.cast::<ICoreWebView2_2>()?.Environment()?.cast::<ICoreWebView2Environment14>()?;
                    let handle = env.CreateWebFileSystemDirectoryHandle(&folder, COREWEBVIEW2_FILE_SYSTEM_HANDLE_PERMISSION_READ_WRITE)?;
                    let mut items = [Some(handle.cast::<IUnknown>()?)];
                    let mut collection = None;
                    env.CreateObjectCollection(1, items.as_mut_ptr(), &mut collection)?;
                    let collection = collection.ok_or_else(|| windows::core::Error::from(E_POINTER))?;
                    core.cast::<ICoreWebView2_23>()?
                        .PostWebMessageAsJsonWithAdditionalObjects(&message, &collection.cast::<ICoreWebView2ObjectCollectionView>()?)
                })()
            };
            let _ = sent.send(result.map_err(|error| format!("WebView2 could not hand over the folder: {error}")));
        })
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || posted.recv_timeout(Duration::from_secs(10)))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|_| "The page's webview did not take the folder.".to_string())?
}

#[cfg(not(windows))]
async fn post(_webview: &Webview, _request: u64, _dir: &Path) -> Result<(), String> {
    Err("Only Willow for Windows hands its pages their folder.".into())
}
