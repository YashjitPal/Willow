//! Willow's right-click menu, in Willow's own look (Windows).
//!
//! WebView2 raises `ContextMenuRequested` with its own menu for what was clicked — spelling
//! suggestions, editing, the link's and the image's commands, each enabled as it should be.
//! For Willow's pages that menu is drawn by the page instead, in Willow's menus (ContextMenu in
//! Willow's page), and the command chosen there is handed back to WebView2, which runs it on what
//! was clicked as its own menu would. Its commands for keeping or sending the page (save, print,
//! share, a link to the selected text) are left out: Willow's page is not a document, and its
//! address is the app's own. With text selected the page adds Ask Willow, so the selection
//! travels with the menu. Elsewhere the webviews keep their own menus.

use tauri::AppHandle;

#[cfg(windows)]
pub use windows_menu::install;

/// The page's answer to the menu it was shown: the command chosen, or none.
#[tauri::command]
pub async fn context_menu_choose(app: AppHandle, id: u64, command: Option<i32>) {
    #[cfg(windows)]
    {
        let _ = app.run_on_main_thread(move || windows_menu::answer(Some(id), command));
    }
    #[cfg(not(windows))]
    {
        let _ = (app, id, command);
    }
}

#[cfg(windows)]
mod windows_menu {
    use std::cell::{Cell, RefCell};

    use serde::Serialize;
    use tauri::{AppHandle, Manager, Url, Webview};
    use webview2_com::{take_pwstr, ContextMenuRequestedEventHandler, Microsoft::Web::WebView2::Win32::*};
    use windows::{
        core::{Interface, BOOL, PWSTR},
        Win32::Foundation::POINT,
    };

    /// WebView2's names for its commands that keep or send the page — a link to highlighted text
    /// included, which would point at the app's own address.
    const LEFT_OUT: [&str; 7] = ["saveAs", "print", "share", "createQrCode", "webCapture", "sendTabToSelf", "copyLinkToHighlight"];

    #[derive(Serialize)]
    struct Item {
        /// WebView2's own name for the command (`copy`, `paste`, `spellCheck`, …): the page draws
        /// its glyph by it.
        name: String,
        label: String,
        shortcut: String,
        /// `None` for a divider.
        command: Option<i32>,
        enabled: bool,
        /// A check box's state.
        checked: Option<bool>,
    }

    struct Open {
        id: u64,
        args: ICoreWebView2ContextMenuRequestedEventArgs,
        deferral: ICoreWebView2Deferral,
    }

    thread_local! {
        /// The menu the page is showing. WebView2 waits on it until it is answered, and its
        /// objects stay on the thread that raised the event, the main thread, as the answer does.
        static OPEN: RefCell<Option<Open>> = const { RefCell::new(None) };
        static NEXT: Cell<u64> = const { Cell::new(1) };
    }

    pub fn install(app: &AppHandle, webview: &Webview, origin: &Url) {
        let app = app.clone();
        let label = webview.label().to_string();
        let origin = origin.origin().ascii_serialization();
        let result = webview.with_webview(move |platform| {
            // SAFETY: WebView2 calls made on the webview's own thread, where this runs.
            let attached = unsafe { attach(&platform.controller(), app, label, origin) };
            if let Err(error) = attached {
                eprintln!("[willow] the right-click menu could not be attached: {error}");
            }
        });
        if let Err(error) = result {
            eprintln!("[willow] the right-click menu could not be attached: {error}");
        }
    }

    unsafe fn attach(controller: &ICoreWebView2Controller, app: AppHandle, label: String, origin: String) -> windows::core::Result<()> {
        let webview = controller.CoreWebView2()?.cast::<ICoreWebView2_11>()?;
        let zoom = controller.clone();
        let mut token = 0i64;
        webview.add_ContextMenuRequested(
            &ContextMenuRequestedEventHandler::create(Box::new(move |sender, args| {
                if let (Some(sender), Some(args)) = (sender, args) {
                    requested(&app, &label, &origin, &zoom, &sender, args);
                }
                Ok(())
            })),
            &mut token,
        )
    }

    /// Takes the menu over on Willow's own pages; anywhere else WebView2 draws its own.
    unsafe fn requested(
        app: &AppHandle,
        label: &str,
        origin: &str,
        controller: &ICoreWebView2Controller,
        sender: &ICoreWebView2,
        args: ICoreWebView2ContextMenuRequestedEventArgs,
    ) {
        let mut source = PWSTR::null();
        if sender.Source(&mut source).is_err() {
            return;
        }
        if !Url::parse(&take_pwstr(source)).is_ok_and(|url| url.origin().ascii_serialization() == origin) {
            return;
        }
        let Ok(collection) = args.MenuItems() else { return };
        let items = tidy(read(&collection));
        let selection = selection(&args);
        if selection.is_none() && items.iter().all(|item| item.command.is_none()) {
            // Nothing Willow would show: no menu at all, rather than the browser's.
            let _ = args.SetHandled(true);
            return;
        }
        // WebView2 says where in the webview's own pixels, which are the page's own at 100% zoom.
        let mut point = POINT::default();
        let _ = args.Location(&mut point);
        let mut zoom = 1.0f64;
        if controller.ZoomFactor(&mut zoom).is_err() || zoom <= 0.0 {
            zoom = 1.0;
        }
        let (x, y) = (f64::from(point.x) / zoom, f64::from(point.y) / zoom);
        let Ok(deferral) = args.GetDeferral() else { return };
        if args.SetHandled(true).is_err() {
            let _ = deferral.Complete();
            return;
        }
        // One at a time: a menu still up is answered with nothing first.
        answer(None, None);
        let id = NEXT.with(|next| {
            let id = next.get();
            next.set(id + 1);
            id
        });
        OPEN.with(|open| *open.borrow_mut() = Some(Open { id, args, deferral }));
        let message = serde_json::json!({ "kind": "context-menu", "id": id, "x": x, "y": y, "items": items, "selection": selection });
        let script = format!("window.__WILLOW_DESKTOP__ && window.__WILLOW_DESKTOP__.receive({message})");
        let (app, label) = (app.clone(), label.to_string());
        // After WebView2's callback has returned, which is still running now.
        let _ = app.clone().run_on_main_thread(move || {
            if let Some(webview) = app.get_webview(&label) {
                let _ = webview.eval(script);
            }
        });
    }

    /// Answers the menu that is up — the one with `id`, or whichever it is — with `command` run, or
    /// with nothing.
    pub fn answer(id: Option<u64>, command: Option<i32>) {
        let open = OPEN.with(|open| {
            let mut open = open.borrow_mut();
            let matches = open.as_ref().is_some_and(|open| id.is_none_or(|id| id == open.id));
            if matches { open.take() } else { None }
        });
        let Some(open) = open else { return };
        // SAFETY: WebView2's objects, on the thread that raised the event they belong to.
        unsafe {
            if let Some(command) = command {
                let _ = open.args.SetSelectedCommandId(command);
            }
            let _ = open.deferral.Complete();
        }
    }

    unsafe fn read(collection: &ICoreWebView2ContextMenuItemCollection) -> Vec<Item> {
        let mut count = 0u32;
        if collection.Count(&mut count).is_err() {
            return Vec::new();
        }
        let mut items = Vec::new();
        for index in 0..count {
            let Ok(item) = collection.GetValueAtIndex(index) else { continue };
            let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
            let _ = item.Kind(&mut kind);
            if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
                items.push(Item { name: String::new(), label: String::new(), shortcut: String::new(), command: None, enabled: false, checked: None });
                continue;
            }
            // Willow's menus open no flyouts.
            if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU {
                continue;
            }
            let name = text(|value| item.Name(value));
            if LEFT_OUT.contains(&name.as_str()) {
                continue;
            }
            let mut command = 0;
            let _ = item.CommandId(&mut command);
            let mut enabled = BOOL::default();
            let _ = item.IsEnabled(&mut enabled);
            let checked = if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_CHECK_BOX || kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_RADIO {
                let mut checked = BOOL::default();
                let _ = item.IsChecked(&mut checked);
                Some(checked.as_bool())
            } else {
                None
            };
            items.push(Item {
                name,
                label: plain(&text(|value| item.Label(value))),
                shortcut: text(|value| item.ShortcutKeyDescription(value)),
                command: Some(command),
                enabled: enabled.as_bool(),
                checked,
            });
        }
        items
    }

    /// The text selected where the menu was asked for, if any.
    unsafe fn selection(args: &ICoreWebView2ContextMenuRequestedEventArgs) -> Option<String> {
        let target = args.ContextMenuTarget().ok()?;
        let mut has = BOOL::default();
        target.HasSelection(&mut has).ok()?;
        if !has.as_bool() {
            return None;
        }
        let text = text(|value| target.SelectionText(value));
        (!text.trim().is_empty()).then_some(text)
    }

    unsafe fn text(get: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> String {
        let mut value = PWSTR::null();
        match get(&mut value) {
            Ok(()) => take_pwstr(value),
            Err(_) => String::new(),
        }
    }

    /// A label without its access key, which WebView2 marks with `&` (`&&` for an ampersand).
    fn plain(label: &str) -> String {
        let mut plain = String::with_capacity(label.len());
        let mut chars = label.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '&' {
                if chars.peek() == Some(&'&') {
                    plain.push('&');
                    chars.next();
                }
                continue;
            }
            plain.push(c);
        }
        plain
    }

    /// No divider first, last, or after another, once what is left out has gone.
    fn tidy(items: Vec<Item>) -> Vec<Item> {
        let mut tidy: Vec<Item> = Vec::with_capacity(items.len());
        for item in items {
            if item.command.is_none() && tidy.last().is_none_or(|last| last.command.is_none()) {
                continue;
            }
            tidy.push(item);
        }
        while tidy.last().is_some_and(|last| last.command.is_none()) {
            tidy.pop();
        }
        tidy
    }
}
