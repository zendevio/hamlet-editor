use chrono::{DateTime, Local, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const MANIFEST: &str = ".hamlet-backup.json";

#[derive(Serialize, Clone, Debug)]
pub struct BackupEntry {
    pub path: String,
    pub timestamp: String,
    pub file_count: usize,
    pub profile_id: String,
}

#[derive(Serialize, Deserialize)]
struct BackupManifest {
    source_profile: PathBuf,
    timestamp: String,
    files: Vec<PathBuf>,
}

fn backups_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("backups"))
        .map_err(|e| format!("Failed to resolve app local data dir: {e}"))
}

#[tauri::command]
pub fn create_backup(profile_path: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    create_backup_at(Path::new(&profile_path), &backups_root(&app_handle)?)
        .map(|path| path.to_string_lossy().into_owned())
}

/// Copy recursive save files as raw bytes, including unsupported codec files and
/// the game's own backup directory. Never follow symlinks out of the profile.
pub fn create_backup_at(profile: &Path, root: &Path) -> Result<PathBuf, String> {
    let source = profile
        .canonicalize()
        .map_err(|e| format!("Invalid profile {}: {e}", profile.display()))?;
    let mut files = read_save_tree(&source)?;
    if files.is_empty() {
        return Err("No save files found to back up".into());
    }
    let now = Local::now();
    let manifest = BackupManifest {
        source_profile: source.clone(),
        timestamp: now.with_timezone(&Utc).to_rfc3339(),
        files: files.keys().cloned().collect(),
    };
    files.insert(
        PathBuf::from(MANIFEST),
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    );
    std::fs::create_dir_all(root)
        .map_err(|e| format!("Failed to create backups directory: {e}"))?;
    let id = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid profile ID")?;
    let directory = root.join(format!(
        "{}__{}__{}__{}",
        id,
        now.format("%Y-%m-%d"),
        now.format("%H-%M-%S%.3f"),
        super::transaction::unique_suffix()
    ));
    std::fs::create_dir(&directory)
        .map_err(|e| format!("Failed to create backup {}: {e}", directory.display()))?;
    if let Err(e) = super::transaction::apply_changes(&directory, &files, &BTreeSet::new()) {
        let _ = std::fs::remove_dir_all(&directory);
        return Err(e);
    }
    Ok(directory)
}

#[tauri::command]
pub fn list_backups(
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<Vec<BackupEntry>, String> {
    list_backups_at(Path::new(&profile_path), &backups_root(&app_handle)?)
}

/// New backups match the exact canonical source path. Legacy backups have no
/// manifest: keep showing them when their profile_N ID matches, since their
/// original account/location cannot be recovered from the old format.
pub fn list_backups_at(profile: &Path, root: &Path) -> Result<Vec<BackupEntry>, String> {
    let source = profile
        .canonicalize()
        .map_err(|e| format!("Invalid profile: {e}"))?;
    let id = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid profile ID")?;
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut backups = Vec::new();
    for entry in std::fs::read_dir(root).map_err(|e| format!("Failed to read backups: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let directory = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let manifest = match read_manifest(&directory) {
            Ok(manifest) => manifest,
            Err(e) => {
                log::warn!("Skipping invalid backup {}: {e}", directory.display());
                continue;
            }
        };
        let timestamp = if let Some(manifest) = manifest {
            if manifest.source_profile != source {
                continue;
            }
            manifest.timestamp
        } else {
            if !name.starts_with(&format!("{id}__")) {
                continue;
            }
            parse_timestamp_from_dirname(&name).unwrap_or(name)
        };
        backups.push(BackupEntry {
            path: directory.to_string_lossy().into_owned(),
            timestamp,
            file_count: read_save_tree(&directory)?.len(),
            profile_id: id.to_owned(),
        });
    }
    backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(backups)
}

#[tauri::command]
pub fn restore_backup(
    backup_path: String,
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    restore_backup_with_detector(
        Path::new(&backup_path),
        Path::new(&profile_path),
        &backups_root(&app_handle)?,
        super::detect::is_game_running,
    )
}

/// Guard and filesystem core shared by the command and integration tests.
pub fn restore_backup_with_detector(
    backup: &Path,
    profile: &Path,
    root: &Path,
    detector: impl FnOnce() -> Result<bool, String>,
) -> Result<(), String> {
    super::detect::ensure_game_stopped(detector)?;
    let source = profile
        .canonicalize()
        .map_err(|e| format!("Invalid profile: {e}"))?;
    let manifest = read_manifest(backup)?;
    if let Some(manifest) = &manifest {
        if manifest.source_profile != source {
            return Err("Backup belongs to a different source profile".into());
        }
    } else {
        let id = source
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Invalid profile ID")?;
        if !backup
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with(&format!("{id}__")))
        {
            return Err("Legacy backup profile ID does not match the destination".into());
        }
    }
    let files = read_save_tree(backup)?;
    let complete_snapshot = manifest.is_some();
    if let Some(manifest) = manifest {
        let expected: BTreeSet<_> = manifest.files.into_iter().collect();
        let actual: BTreeSet<_> = files.keys().cloned().collect();
        if expected != actual {
            return Err("Backup files do not match the manifest. Restore was not started.".into());
        }
    }
    let deletes = if complete_snapshot {
        restore_deletions(&source, &files)?
    } else {
        // Old backups were top-level-only copies, not complete snapshots.
        BTreeSet::new()
    };
    if files.is_empty() {
        return Err("No save files found in backup".into());
    }
    create_backup_at(&source, root)?;
    super::transaction::apply_changes(&source, &files, &deletes)
}

#[tauri::command]
pub fn restore_game_backup(
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    restore_game_backup_with_detector(
        Path::new(&profile_path),
        &backups_root(&app_handle)?,
        super::detect::is_game_running,
    )
}

pub fn restore_game_backup_with_detector(
    profile: &Path,
    root: &Path,
    detector: impl FnOnce() -> Result<bool, String>,
) -> Result<(), String> {
    super::detect::ensure_game_stopped(detector)?;
    let mut files = read_save_tree(&profile.join("backup"))?;
    // These top-level files in the game's backup are stale snapshots, not the
    // active raid_save directory. Never transplant them into the profile root.
    files.remove(Path::new("persist.raid.json"));
    files.remove(Path::new("persist.map.json"));
    if files.is_empty() {
        return Err("No save files found in game backup".into());
    }
    create_backup_at(profile, root)?;
    // The game's partial backup is not a complete profile snapshot, so it does
    // not authorize deleting files from the active profile.
    super::transaction::apply_changes(profile, &files, &BTreeSet::new())
}

/// Open the editor's backups directory in the system file manager.
///
/// Creates `<app_local_data_dir>/backups/` first if no backup exists yet.
/// Returns the directory path so the UI can show it if opening fails.
#[tauri::command]
pub fn open_backup_folder(app_handle: tauri::AppHandle) -> Result<String, String> {
    let backups_root = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data dir: {e}"))?
        .join("backups");

    std::fs::create_dir_all(&backups_root)
        .map_err(|e| format!("Failed to create backups directory: {e}"))?;

    let path = backups_root.to_string_lossy().to_string();
    app_handle
        .opener()
        .open_path(path.clone(), None::<&str>)
        .map_err(|e| format!("Failed to open backups directory {path}: {e}"))?;

    Ok(path)
}

fn read_manifest(directory: &Path) -> Result<Option<BackupManifest>, String> {
    match std::fs::read(directory.join(MANIFEST)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| format!("Invalid backup manifest: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read backup manifest: {e}")),
    }
}

pub(crate) fn read_save_tree(root: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>, String> {
    fn visit(
        root: &Path,
        relative: &Path,
        files: &mut BTreeMap<PathBuf, Vec<u8>>,
    ) -> Result<(), String> {
        let directory = root.join(relative);
        for entry in std::fs::read_dir(&directory)
            .map_err(|e| format!("Failed to read {}: {e}", directory.display()))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let path = relative.join(name.as_ref());
            if kind.is_dir() && !name.starts_with(".hamlet-transaction-") {
                visit(root, &path, files)?;
            } else if kind.is_file() && super::is_save_file(&name) {
                files.insert(
                    path,
                    std::fs::read(entry.path())
                        .map_err(|e| format!("Failed to read {}: {e}", entry.path().display()))?,
                );
            } else if kind.is_symlink() && super::is_save_file(&name) {
                return Err(format!(
                    "Cannot back up symlink save {}",
                    entry.path().display()
                ));
            }
        }
        Ok(())
    }
    let mut files = BTreeMap::new();
    visit(root, Path::new(""), &mut files)?;
    Ok(files)
}

fn restore_deletions(
    profile: &Path,
    files: &BTreeMap<PathBuf, Vec<u8>>,
) -> Result<BTreeSet<PathBuf>, String> {
    let filenames: BTreeSet<_> = files.keys().filter_map(|p| p.file_name()).collect();
    Ok(read_save_tree(profile)?
        .into_keys()
        .filter(|path| {
            !files.contains_key(path)
                && path
                    .file_name()
                    .is_some_and(|name| filenames.contains(name))
        })
        .collect())
}

fn parse_timestamp_from_dirname(name: &str) -> Option<String> {
    let parts: Vec<_> = name.split("__").collect();
    if parts.len() < 3 {
        return None;
    }
    let datetime = format!("{}T{}", parts[1], parts[2].replace('-', ":"));
    NaiveDateTime::parse_from_str(&datetime, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .and_then(|value| value.and_local_timezone(Local).single())
        .map(|value: DateTime<Local>| value.with_timezone(&Utc).to_rfc3339())
}
