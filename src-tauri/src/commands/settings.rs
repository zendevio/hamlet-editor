use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

const MAX_BYTES: usize = 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_millis(1500);
const RECHECK_PAUSE: Duration = Duration::from_millis(150);

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Fingerprint {
    size: u64,
    hash: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ReadStatus {
    Ok,
    Missing,
    Corrupt,
    IoError,
}

#[derive(Debug, Serialize)]
pub struct SettingsRead {
    status: ReadStatus,
    values: serde_json::Map<String, serde_json::Value>,
    folder: String,
    fingerprint: Option<Fingerprint>,
    detail: String,
}

#[derive(Debug, Serialize)]
pub struct SettingsReadError {
    kind: &'static str,
    folder: String,
    detail: String,
}

fn failure(path: &Path, detail: impl ToString) -> SettingsReadError {
    SettingsReadError {
        kind: "io_error",
        folder: path.parent().unwrap_or(path).to_string_lossy().into_owned(),
        detail: detail.to_string(),
    }
}

// Hash the entire file while bounding the JSON buffer, including oversized files.
fn snapshot(path: &Path) -> std::io::Result<(Vec<u8>, Fingerprint)> {
    let mut file = std::fs::File::open(path)?;
    let mut bytes = Vec::new();
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut buffer = [0; 8192];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        hash.update(&buffer[..count]);
        let keep = count.min((MAX_BYTES + 1).saturating_sub(bytes.len()));
        bytes.extend_from_slice(&buffer[..keep]);
    }
    Ok((
        bytes,
        Fingerprint {
            size,
            hash: format!("{:x}", hash.finalize()),
        },
    ))
}

fn object(bytes: &[u8]) -> Option<serde_json::Map<String, serde_json::Value>> {
    (bytes.len() <= MAX_BYTES)
        .then(|| serde_json::from_slice(bytes).ok())
        .flatten()
}

fn read_settings_file(
    path: &Path,
    deadline: Instant,
    pause: impl FnOnce(),
) -> Result<SettingsRead, SettingsReadError> {
    let mut result = SettingsRead {
        status: ReadStatus::Missing,
        values: Default::default(),
        folder: path.parent().unwrap_or(path).to_string_lossy().into_owned(),
        fingerprint: None,
        detail: String::new(),
    };
    let (bytes, fingerprint) = match snapshot(path) {
        Ok(snapshot) => snapshot,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(result),
        Err(error) => return Err(failure(path, error)),
    };
    if Instant::now() >= deadline {
        return Err(failure(path, "Settings read deadline elapsed"));
    }
    if fingerprint.size > MAX_BYTES as u64 {
        return Err(failure(
            path,
            "Settings exceed the validation size limit; recovery refused",
        ));
    }
    if let Some(values) = object(&bytes) {
        result.status = ReadStatus::Ok;
        result.values = values;
        return Ok(result);
    }
    pause();
    let (again, current) = snapshot(path).map_err(|error| failure(path, error))?;
    if Instant::now() >= deadline {
        return Err(failure(path, "Settings read deadline elapsed"));
    }
    if bytes != again || fingerprint != current || object(&again).is_some() {
        return Err(failure(
            path,
            "Settings changed during the corruption check; recovery refused",
        ));
    }
    result.status = ReadStatus::Corrupt;
    result.fingerprint = Some(fingerprint);
    Ok(result)
}

fn recover_settings_file(path: &Path, expected: &Fingerprint) -> Result<String, SettingsReadError> {
    let (bytes, current) = snapshot(path).map_err(|error| failure(path, error))?;
    if &current != expected || current.size > MAX_BYTES as u64 || object(&bytes).is_some() {
        return Err(failure(
            path,
            "Settings fingerprint changed or file is valid; recovery refused",
        ));
    }
    // Reserve a fresh directory atomically. rename cannot overwrite an existing
    // kept copy if the generated suffix already exists.
    let directory = path.with_file_name(format!(
        "settings.json.corrupt-{}",
        super::transaction::unique_suffix()
    ));
    std::fs::create_dir(&directory).map_err(|error| failure(path, error))?;
    let kept = directory.join("settings.json");
    if let Err(error) = std::fs::rename(path, &kept) {
        // remove_dir only removes an empty directory, so this cannot touch user data.
        let _ = std::fs::remove_dir(&directory);
        return Err(failure(path, error));
    }
    Ok(format!(
        "{}/settings.json",
        directory.file_name().unwrap().to_string_lossy()
    ))
}

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, SettingsReadError> {
    app.path()
        .app_data_dir()
        .map(|folder| folder.join("settings.json"))
        .map_err(|error| failure(Path::new(""), error))
}

#[tauri::command]
pub async fn read_settings(app: tauri::AppHandle) -> SettingsRead {
    let result = async {
        let path = settings_path(&app)?;
        // A webview reload must use the live plugin store rather than inspect a
        // file that this process may currently be truncating and writing.
        if let Some(store) = app.get_store("settings.json") {
            return Ok(SettingsRead {
                status: ReadStatus::Ok,
                values: store.entries().into_iter().collect(),
                folder: path.parent().unwrap().to_string_lossy().into_owned(),
                fingerprint: None,
                detail: String::new(),
            });
        }
        let error_path = path.clone();
        let deadline = Instant::now() + READ_TIMEOUT;
        tauri::async_runtime::spawn_blocking(move || {
            read_settings_file(&path, deadline, || std::thread::sleep(RECHECK_PAUSE))
        })
        .await
        .map_err(|error| failure(&error_path, error))?
    }
    .await;
    result.unwrap_or_else(|error: SettingsReadError| SettingsRead {
        status: ReadStatus::IoError,
        values: Default::default(),
        folder: error.folder,
        fingerprint: None,
        detail: error.detail,
    })
}

#[tauri::command]
pub async fn recover_corrupt_settings(
    app: tauri::AppHandle,
    fingerprint: Fingerprint,
) -> Result<String, SettingsReadError> {
    let path = settings_path(&app)?;
    if app.get_store("settings.json").is_some() {
        return Err(failure(
            &path,
            "A live settings store exists; recovery refused",
        ));
    }
    let error_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || recover_settings_file(&path, &fingerprint))
        .await
        .map_err(|error| failure(&error_path, error))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hamlet-settings-{}",
            super::super::transaction::unique_suffix()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn read(path: &Path) -> Result<SettingsRead, SettingsReadError> {
        read_settings_file(path, Instant::now() + READ_TIMEOUT, || {
            std::thread::sleep(RECHECK_PAUSE)
        })
    }
    #[test]
    fn missing_and_valid_settings_are_never_renamed() {
        let dir = temp_dir();
        let file = dir.join("settings.json");
        assert_eq!(read(&file).unwrap().status, ReadStatus::Missing);
        std::fs::write(&file, r#"{"editorLanguage":"german"}"#).unwrap();
        let valid = read(&file).unwrap();
        assert_eq!(valid.status, ReadStatus::Ok);
        assert_eq!(valid.values["editorLanguage"], "german");
        let (_, fingerprint) = snapshot(&file).unwrap();
        assert!(recover_settings_file(&file, &fingerprint).is_err());
        assert!(file.exists());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn oversized_valid_file_is_unreadable_and_never_renamed() {
        let dir = temp_dir();
        let file = dir.join("settings.json");
        let bytes = format!("{{\"large\":\"{}\"}}", "x".repeat(MAX_BYTES));
        std::fs::write(&file, &bytes).unwrap();
        assert!(read(&file).is_err());
        let (_, fingerprint) = snapshot(&file).unwrap();
        assert!(recover_settings_file(&file, &fingerprint).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), bytes);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn identical_corrupt_bytes_are_only_renamed_by_explicit_recovery() {
        let dir = temp_dir();
        let file = dir.join("settings.json");
        let mut copies = std::collections::HashSet::new();
        for bytes in [b"".as_slice(), b"{", b"[]", b"null", b"3", b"\xff"] {
            std::fs::write(&file, bytes).unwrap();
            let corrupt = read(&file).unwrap();
            assert_eq!(corrupt.status, ReadStatus::Corrupt);
            assert_eq!(std::fs::read(&file).unwrap(), bytes);
            let fingerprint = corrupt.fingerprint.unwrap();
            assert_eq!(fingerprint.size, bytes.len() as u64);
            let name = recover_settings_file(&file, &fingerprint).unwrap();
            assert!(copies.insert(name.clone()));
            assert!(!file.exists());
            assert_eq!(std::fs::read(dir.join(name)).unwrap(), bytes);
        }
        assert_eq!(copies.len(), 6);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn changing_file_between_reads_is_transient_and_never_renamed() {
        let dir = temp_dir();
        let file = dir.join("settings.json");
        for replacement in [b"{}".as_slice(), b"[", b""] {
            std::fs::write(&file, b"{").unwrap();
            let error = read_settings_file(&file, Instant::now() + READ_TIMEOUT, || {
                std::fs::write(&file, replacement).unwrap()
            })
            .unwrap_err();
            assert!(error.detail.contains("changed during"));
            assert_eq!(std::fs::read(&file).unwrap(), replacement);
            assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn fingerprint_mismatch_refuses_recovery_even_for_same_size_corruption() {
        let dir = temp_dir();
        let file = dir.join("settings.json");
        std::fs::write(&file, b"{").unwrap();
        let corrupt = read(&file).unwrap();
        std::fs::write(&file, b"[").unwrap();
        assert!(recover_settings_file(&file, &corrupt.fingerprint.unwrap()).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"[");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn io_errors_and_expired_reads_leave_settings_intact() {
        let dir = temp_dir();
        let file = dir.join("settings.json");
        std::fs::create_dir(&file).unwrap();
        assert!(read(&file).is_err());
        std::fs::remove_dir(&file).unwrap();
        std::fs::write(&file, b"{").unwrap();
        assert!(read_settings_file(&file, Instant::now(), || {}).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"{");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
