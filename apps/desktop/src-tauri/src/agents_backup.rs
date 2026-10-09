//! A copy of the agents' conversations in the Willow folder.
//!
//! The agents' tabs (Claude Code, Codex, Cursor and the rest, through T3 Code's server; see
//! `harness.rs`) keep every thread in one SQLite database in the app's local data,
//! `agents/userdata/statev2.sqlite`, which removing Willow's data would take with it. So a while
//! after Willow starts, and every half hour after that, a database that changed is copied to
//! `Agents/Backups/<date>.sqlite` in the Willow folder: the day's latest state, the last seven days
//! kept, beside a README saying how to put one back.
//!
//! The copy is SQLite's own online backup, run by the bundled Node (`node:sqlite`). The database is
//! open, and most of it sits in its write-ahead log, so copying the file would copy almost nothing,
//! and a copy taken in the middle of a write would not open. T3's settings and keybindings go too,
//! to `Agents/Settings`, with whatever could be a secret blanked (`scrub`); the server's own keys
//! (`userdata/secrets`) and its logs stay. A copy of Willow under another identifier (a test copy)
//! keeps no backups, so none of them replaces the app's own.
//!
//! Agents' data that is not there at all — Willow's data removed, a reinstall, another computer on
//! the same folder — is put back from the newest backup before the server first opens it
//! (`restore_if_empty`, from `harness.rs`).

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, SystemTime},
};

use serde_json::Value;
use tauri::{AppHandle, Manager};

const IDENTIFIER: &str = "com.willow.studio";
const FIRST_DELAY: Duration = Duration::from_secs(120);
const INTERVAL: Duration = Duration::from_secs(30 * 60);
const KEEP: usize = 7;
/// T3's own files beside its database (`userdata`) that are copied to `Agents/Settings`.
const SETTINGS: [&str; 2] = ["settings.json", "keybindings.json"];
/// Which database this is (`userdata/`), and which one the backups are of (`Agents/Backups/`). A database
/// that is not the one the backups came from — a fresh one, started while the folder could not be found —
/// never replaces or prunes them.
const DATABASE_ID: &str = "willow-database-id";
const BACKUPS_ID: &str = "database-id";

/// `node --no-warnings -e SCRIPT -- <database> <copy>`. The copy is left as one file, not in WAL mode.
const SCRIPT: &str = "const { DatabaseSync, backup } = require('node:sqlite');\
const [source, target] = process.argv.slice(1);\
const db = new DatabaseSync(source, { readOnly: true });\
backup(db, target).then(() => {\
  db.close();\
  const copy = new DatabaseSync(target);\
  copy.exec('PRAGMA journal_mode = DELETE');\
  copy.close();\
}).catch((error) => { console.error(String((error && error.message) || error)); process.exit(1); });";

pub fn start(app: &AppHandle) {
    if app.config().identifier != IDENTIFIER {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(FIRST_DELAY);
        let mut copied: Option<SystemTime> = None;
        loop {
            if let Err(error) = back_up(&app, &mut copied) {
                eprintln!("The agents' conversations could not be backed up: {error}");
            }
            back_up_settings(&app);
            thread::sleep(INTERVAL);
        }
    });
}

/// The agents' data as the newest backup left it, when there is none at all; before the server
/// first opens it. Settings come back as they were copied, their secrets blank.
pub fn restore_if_empty(app: &AppHandle, home: &Path) {
    let userdata = home.join("userdata");
    let db = userdata.join("statev2.sqlite");
    if db.exists() {
        return;
    }
    let Some(agents) = crate::local_folder::folder(app).map(|folder| folder.join("Agents")).filter(|agents| agents.is_dir()) else {
        return;
    };
    let backup = backup_days(&agents.join("Backups")).pop();
    let settings = agents.join("Settings");
    if backup.is_none() && !settings.is_dir() {
        return;
    }
    if fs::create_dir_all(&userdata).is_err() {
        return;
    }
    if let Some(backup) = backup {
        // A log left beside a database that is gone would be replayed into this one.
        for stale in ["statev2.sqlite-wal", "statev2.sqlite-shm"] {
            let _ = fs::remove_file(userdata.join(stale));
        }
        let partial = userdata.join("statev2.sqlite.partial");
        match fs::copy(&backup, &partial).and_then(|_| fs::rename(&partial, &db)) {
            Ok(()) => {
                // The database put back is the one the backups are of, and keeps backing up to them.
                let _ = fs::remove_file(userdata.join(DATABASE_ID));
                if let Some(id) = read_id(&agents.join("Backups").join(BACKUPS_ID)) {
                    let _ = fs::write(userdata.join(DATABASE_ID), id);
                }
                eprintln!("The agents' conversations were put back from {}.", backup.display());
            }
            Err(error) => {
                let _ = fs::remove_file(&partial);
                eprintln!("The agents' conversations could not be put back from {}: {error}", backup.display());
            }
        }
    }
    for name in SETTINGS {
        let (source, target) = (settings.join(name), userdata.join(name));
        if source.is_file() && !target.exists() {
            let _ = fs::copy(&source, &target);
        }
    }
}

/// T3's settings and keybindings, copied to `Agents/Settings` when they changed.
fn back_up_settings(app: &AppHandle) {
    let (Some(db), Some(folder)) = (database(app), crate::local_folder::folder(app).filter(|folder| folder.is_dir())) else {
        return;
    };
    let Some(userdata) = db.parent() else { return };
    let agents = folder.join("Agents");
    let target = agents.join("Settings");
    for name in SETTINGS {
        let Ok(text) = fs::read_to_string(userdata.join(name)) else { continue };
        let copy = if name == "settings.json" {
            let Ok(mut settings) = serde_json::from_str::<Value>(&text) else { continue };
            scrub(&mut settings);
            match serde_json::to_string_pretty(&settings) {
                Ok(text) => format!("{text}\n"),
                Err(_) => continue,
            }
        } else {
            text
        };
        if fs::read_to_string(target.join(name)).ok().as_deref() == Some(copy.as_str()) {
            continue;
        }
        if fs::create_dir_all(&target).is_err() {
            return;
        }
        let _ = fs::write(target.join(name), copy);
        write_readme(&agents, &db);
    }
}

/// Blanks what could be a secret, so the folder's copy holds none. T3 moves a provider's variables
/// marked sensitive into its own secret store, but an API key field, a server's password or a variable
/// left unmarked sit in its settings as typed.
fn scrub(value: &mut Value) {
    match value {
        Value::Object(map) => {
            let variable = map.get("sensitive").and_then(Value::as_bool) == Some(true)
                || map.get("name").and_then(Value::as_str).is_some_and(secret_variable);
            for (key, entry) in map.iter_mut() {
                if entry.is_string() && (secret_field(key) || (variable && key == "value")) {
                    *entry = Value::String(String::new());
                } else {
                    scrub(entry);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(scrub),
        _ => {}
    }
}

/// A settings field that may hold a secret: `apiKey`, `managementKey`, `accessToken`, `serverPassword`…
fn secret_field(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.ends_with("key") || ["token", "secret", "password", "passwd", "credential"].iter().any(|word| name.contains(word))
}

/// An environment variable that may hold a secret: `OPENAI_API_KEY`, `GH_TOKEN`, `GITHUB_PAT`… not `PATH`.
fn secret_variable(name: &str) -> bool {
    name.to_ascii_uppercase().split(|c: char| !c.is_ascii_alphanumeric()).any(|part| {
        part.ends_with("KEY")
            || part.ends_with("TOKEN")
            || ["SECRET", "PASS", "PASSWORD", "PASSWD", "AUTH", "CREDENTIAL", "CREDENTIALS", "PAT"].contains(&part)
    })
}

fn database(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_local_data_dir().ok()?.join("agents").join("userdata").join("statev2.sqlite"))
}

/// When the database last changed: the file or its write-ahead log, whichever is later.
fn changed(db: &Path) -> Option<SystemTime> {
    [db.to_path_buf(), db.with_file_name("statev2.sqlite-wal")]
        .iter()
        .filter_map(|file| fs::metadata(file).and_then(|metadata| metadata.modified()).ok())
        .max()
}

fn back_up(app: &AppHandle, copied: &mut Option<SystemTime>) -> Result<(), String> {
    let Some(db) = database(app).filter(|db| db.is_file()) else { return Ok(()) };
    let Some(changed_at) = changed(&db) else { return Ok(()) };
    if *copied == Some(changed_at) {
        return Ok(());
    }
    // The page makes the Willow folder; a backup is no reason to make one.
    let Some(folder) = crate::local_folder::folder(app).filter(|folder| folder.is_dir()) else { return Ok(()) };
    let agents = folder.join("Agents");
    let backups = agents.join("Backups");
    let ours = db.parent().and_then(database_id).ok_or("The agents' database could not be given an id.")?;
    let theirs = read_id(&backups.join(BACKUPS_ID));
    if !belongs(theirs.as_deref(), &ours) {
        // This database began without the backups (the folder was not found when the agents first
        // started, so none was put back); copied over them, it would take the history they hold.
        eprintln!("The agents' backups in {} are of another database, and are left as they are.", backups.display());
        *copied = Some(changed_at);
        return Ok(());
    }
    let target = backups.join(format!("{}.sqlite", today()));
    // Copied since the last change already, by an earlier run of Willow today.
    if fs::metadata(&target).and_then(|metadata| metadata.modified()).is_ok_and(|at| at >= changed_at) {
        *copied = Some(changed_at);
        return Ok(());
    }
    fs::create_dir_all(&backups).map_err(|error| error.to_string())?;
    if theirs.is_none() {
        fs::write(backups.join(BACKUPS_ID), &ours).map_err(|error| error.to_string())?;
    }
    write_readme(&agents, &db);
    let partial = backups.join(format!("{}.sqlite.partial", today()));
    let _ = fs::remove_file(&partial);
    let mut command = Command::new(crate::bundled_node()?);
    command.args(["--no-warnings", "-e", SCRIPT, "--"]).arg(&db).arg(&partial);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        let _ = fs::remove_file(&partial);
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    fs::rename(&partial, &target).map_err(|error| error.to_string())?;
    *copied = Some(changed_at);
    prune(&backups);
    Ok(())
}

/// This database's id (`userdata/willow-database-id`), made the first time it is asked for.
fn database_id(userdata: &Path) -> Option<String> {
    let file = userdata.join(DATABASE_ID);
    if let Some(id) = read_id(&file) {
        return Some(id);
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    fs::write(&file, &id).ok()?;
    Some(id)
}

fn read_id(file: &Path) -> Option<String> {
    fs::read_to_string(file).ok().map(|text| text.trim().to_string()).filter(|id| !id.is_empty())
}

/// Whether backups of `theirs` may take this database's copies: they are its own, or nobody's yet
/// (backups from before ids, which the database backing up to them then claims).
fn belongs(theirs: Option<&str>, ours: &str) -> bool {
    theirs.is_none_or(|theirs| theirs == ours)
}

/// The newest `KEEP` days stay; older backups go. They are copies Willow made, not the user's files.
fn prune(backups: &Path) {
    let days = backup_days(backups);
    let surplus = days.len().saturating_sub(KEEP);
    for old in &days[..surplus] {
        let _ = fs::remove_file(old);
    }
}

/// The day's backups in `backups`, oldest first.
fn backup_days(backups: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(backups) else { return Vec::new() };
    let mut days: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().is_some_and(|extension| extension == "sqlite")
                && path.file_stem().and_then(|stem| stem.to_str()).is_some_and(is_date)
        })
        .collect();
    days.sort();
    days
}

fn is_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| if index == 4 || index == 7 { *byte == b'-' } else { byte.is_ascii_digit() })
}

fn write_readme(agents: &Path, db: &Path) {
    let text = format!(
        "Willow keeps a copy of your agents' conversations here: Claude Code, Codex, Cursor and the other\r\n\
         agents in Willow's agent tabs.\r\n\
         \r\n\
         Backups\\<date>.sqlite is the agents' database as Willow last copied it that day. It is copied\r\n\
         every half hour while it changes, and the last {KEEP} days are kept. Settings\\ holds the\r\n\
         agents' settings and keybindings, with API keys, tokens and passwords left out.\r\n\
         \r\n\
         The agents work from their own copy, in Willow's app data:\r\n\
         \x20 {}\r\n\
         \r\n\
         When that copy is gone (Willow's data removed, or Willow installed afresh), Willow puts the\r\n\
         newest backup and the settings back before the agents start. To start the agents afresh\r\n\
         instead, move this folder somewhere else first.\r\n\
         \r\n\
         To put an older backup back: quit Willow (from the tray as well), copy the backup over that\r\n\
         file and name it statev2.sqlite, delete statev2.sqlite-wal and statev2.sqlite-shm beside it,\r\n\
         and start Willow again.\r\n",
        db.display()
    );
    let file = agents.join("README.txt");
    if fs::read_to_string(&file).ok().as_deref() != Some(text.as_str()) {
        let _ = fs::write(&file, text);
    }
}

/// Today in the computer's own time zone, as the user reads dates.
#[cfg(windows)]
fn today() -> String {
    use windows_sys::Win32::{Foundation::SYSTEMTIME, System::SystemInformation::GetLocalTime};
    // SAFETY: GetLocalTime only writes the struct it is given.
    let time = unsafe {
        let mut time: SYSTEMTIME = std::mem::zeroed();
        GetLocalTime(&mut time);
        time
    };
    format!("{:04}-{:02}-{:02}", time.wYear, time.wMonth, time.wDay)
}

/// Today in UTC: the civil date from days since 1970 (Howard Hinnant's algorithm).
#[cfg(not(windows))]
fn today() -> String {
    let days = SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_secs() / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backups_take_copies_of_their_own_database_only() {
        let dir = std::env::temp_dir().join(format!("willow-agents-id-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        let first = database_id(&dir).unwrap();
        assert_eq!(database_id(&dir).unwrap(), first, "an id is made once and kept");
        assert!(belongs(None, &first), "backups from before ids are claimed");
        assert!(belongs(Some(&first), &first));
        assert!(!belongs(Some("another-database"), &first), "a fresh database leaves another's backups alone");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_settings_copy_keeps_no_secret_and_everything_else() {
        let mut settings = serde_json::json!({
            "providers": { "antigravity": { "apiKey": "AQ.not-a-key", "gcpProject": "my-project", "binaryPath": "agy" } },
            "opencode": { "serverUrl": "http://127.0.0.1:4096", "serverPassword": "hunter2" },
            "providerInstances": { "work": { "environment": [
                { "name": "OPENAI_API_KEY", "value": "sk-not-a-key" },
                { "name": "GITHUB_PAT", "value": "not-a-token" },
                { "name": "HTTPS_PROXY", "value": "http://proxy:8080" },
                { "name": "PATH", "value": "C:\\tools" },
                { "name": "REGION", "value": "eu", "sensitive": true, "valueRedacted": false },
            ] } },
            "usageLimitSources": { "hub": { "url": "http://hub", "managementKey": "not-a-key" } },
            "bitbucket": { "email": "me@example.com", "accessToken": "not-a-token" },
            "worktreesDirectory": "D:\\worktrees",
        });
        scrub(&mut settings);
        assert_eq!(settings["providers"]["antigravity"]["apiKey"], "");
        assert_eq!(settings["providers"]["antigravity"]["gcpProject"], "my-project");
        assert_eq!(settings["providers"]["antigravity"]["binaryPath"], "agy");
        assert_eq!(settings["opencode"]["serverPassword"], "");
        assert_eq!(settings["opencode"]["serverUrl"], "http://127.0.0.1:4096");
        let environment = &settings["providerInstances"]["work"]["environment"];
        assert_eq!(environment[0]["value"], "");
        assert_eq!(environment[0]["name"], "OPENAI_API_KEY");
        assert_eq!(environment[1]["value"], "");
        assert_eq!(environment[2]["value"], "http://proxy:8080");
        assert_eq!(environment[3]["value"], "C:\\tools");
        assert_eq!(environment[4]["value"], "", "a variable marked sensitive is a secret whatever it is called");
        assert_eq!(settings["usageLimitSources"]["hub"]["managementKey"], "");
        assert_eq!(settings["usageLimitSources"]["hub"]["url"], "http://hub");
        assert_eq!(settings["bitbucket"]["accessToken"], "");
        assert_eq!(settings["bitbucket"]["email"], "me@example.com");
        assert_eq!(settings["worktreesDirectory"], "D:\\worktrees");
    }
}
