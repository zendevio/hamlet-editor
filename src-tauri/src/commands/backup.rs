use super::error::AppError;
use chrono::{DateTime, Local, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const MANIFEST: &str = ".hamlet-backup.json";
const INCOMPLETE_PREFIX: &str = ".hamlet-incomplete-backup-";

#[derive(Serialize, Clone, Debug)]
pub struct BackupEntry {
    pub path: String,
    pub timestamp: String,
    pub file_count: usize,
    pub profile_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupManifest {
    source_profile: PathBuf,
    timestamp: String,
    files: Vec<PathBuf>,
}

fn profile_id(source: &Path) -> Result<&str, AppError> {
    source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::new("profile_id_invalid"))
}

fn backups_root(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("backups"))
        .map_err(|e| AppError::new("app_data_path").detail(e))
}

#[tauri::command]
pub fn create_backup(
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<String, AppError> {
    create_backup_at(Path::new(&profile_path), &backups_root(&app_handle)?)
        .map(|path| path.to_string_lossy().into_owned())
}

/// Copy recursive save files as raw bytes, including unsupported codec files and
/// the game's own backup directory. Never follow symlinks out of the profile.
pub fn create_backup_at(profile: &Path, root: &Path) -> Result<PathBuf, AppError> {
    let source = profile.canonicalize().map_err(|e| {
        AppError::new("profile_invalid")
            .param("path", profile.display().to_string())
            .detail(e)
    })?;
    create_backup_from_tree(&source, root, read_save_tree(&source)?)
}

fn create_backup_from_tree(
    source: &Path,
    root: &Path,
    files: BTreeMap<PathBuf, Vec<u8>>,
) -> Result<PathBuf, AppError> {
    create_backup_from_tree_with_hook(source, root, files, &mut |_, _| Ok(()))
}

fn create_backup_from_tree_with_hook(
    source: &Path,
    root: &Path,
    files: BTreeMap<PathBuf, Vec<u8>>,
    after_change: &mut dyn FnMut(&Path, usize) -> Result<(), AppError>,
) -> Result<PathBuf, AppError> {
    create_backup_from_tree_with_hooks(source, root, files, after_change, &mut |from, to| {
        publish_backup_with(
            from,
            to,
            &mut |from, to| std::fs::rename(from, to),
            &mut std::thread::sleep,
        )
    })
}

fn create_backup_from_tree_with_hooks(
    source: &Path,
    root: &Path,
    mut files: BTreeMap<PathBuf, Vec<u8>>,
    after_change: &mut dyn FnMut(&Path, usize) -> Result<(), AppError>,
    publish: &mut dyn FnMut(&Path, &Path) -> Result<(), AppError>,
) -> Result<PathBuf, AppError> {
    if files.is_empty() {
        return Err(AppError::new("backup_empty"));
    }
    let now = Local::now();
    let manifest = BackupManifest {
        source_profile: source.to_path_buf(),
        timestamp: now.with_timezone(&Utc).to_rfc3339(),
        files: files.keys().cloned().collect(),
    };
    files.insert(
        PathBuf::from(MANIFEST),
        serde_json::to_vec_pretty(&manifest)
            .map_err(|e| AppError::new("backup_manifest_encode").detail(e))?,
    );
    std::fs::create_dir_all(root).map_err(|e| AppError::new("backups_create").detail(e))?;
    let id = profile_id(source)?;
    let directory = root.join(format!(
        "{}__{}__{}__{}",
        id,
        now.format("%Y-%m-%d"),
        now.format("%H-%M-%S%.3f"),
        super::transaction::unique_suffix()
    ));
    // Publish only complete snapshots. Even if rollback or cleanup fails, the
    // retained directory cannot be mistaken for a manifest or legacy backup.
    let staging = root.join(format!(
        "{INCOMPLETE_PREFIX}{}",
        super::transaction::unique_suffix()
    ));
    std::fs::create_dir(&staging).map_err(|e| {
        AppError::new("backup_create")
            .param("path", staging.display().to_string())
            .detail(e)
    })?;
    if let Err(error) = super::transaction::apply_changes_with_hook(
        &staging,
        &files,
        &BTreeSet::new(),
        &mut |count| after_change(&staging, count),
    ) {
        if error.code == "transaction_rollback" {
            let error = AppError::new("backup_rollback")
                .param("recoveryPath", staging.display().to_string())
                .detail(error);
            log::error!("{error}");
            return Err(error);
        }
        if let Err(cleanup) = std::fs::remove_dir_all(&staging) {
            let error = AppError::new("backup_rollback")
                .param("recoveryPath", staging.display().to_string())
                .detail(format!("{error}\n{}: {cleanup}", staging.display()));
            log::error!("{error}");
            return Err(error);
        }
        return Err(AppError::new("backup_create")
            .param("path", directory.display().to_string())
            .detail(error));
    }
    publish(&staging, &directory)?;
    Ok(directory)
}

fn publish_backup_with(
    staging: &Path,
    directory: &Path,
    rename: &mut dyn FnMut(&Path, &Path) -> std::io::Result<()>,
    pause: &mut dyn FnMut(std::time::Duration),
) -> Result<(), AppError> {
    let mut retries = 0;
    loop {
        match rename(staging, directory) {
            Ok(()) => return Ok(()),
            // Antivirus and indexer handles can briefly block directory renames.
            Err(error)
                if retries < 3
                    && (error.kind() == std::io::ErrorKind::PermissionDenied
                        || matches!(error.raw_os_error(), Some(5 | 32 | 33))) =>
            {
                retries += 1;
                pause(std::time::Duration::from_millis(25 * retries));
            }
            Err(error) => {
                let error = AppError::new("backup_create")
                    .param("path", directory.display().to_string())
                    .param("recoveryPath", staging.display().to_string())
                    .detail(error);
                log::error!("{error}");
                return Err(error);
            }
        }
    }
}

#[tauri::command]
pub fn list_backups(
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<Vec<BackupEntry>, AppError> {
    list_backups_at(Path::new(&profile_path), &backups_root(&app_handle)?)
}

/// New backups match the exact canonical source path. Legacy backups have no
/// manifest: keep showing them when their profile_N ID matches, since their
/// original account/location cannot be recovered from the old format.
pub fn list_backups_at(profile: &Path, root: &Path) -> Result<Vec<BackupEntry>, AppError> {
    let source = profile.canonicalize().map_err(|e| {
        AppError::new("profile_invalid")
            .param("path", profile.display().to_string())
            .detail(e)
    })?;
    let id = profile_id(&source)?;
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut backups = Vec::new();
    for entry in std::fs::read_dir(root).map_err(|e| AppError::new("backups_read").detail(e))? {
        let Ok(entry) = entry else {
            continue;
        };
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let directory = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(INCOMPLETE_PREFIX) {
            continue;
        }
        let manifest = match read_manifest(&directory) {
            Ok(manifest) => manifest,
            Err(e) => {
                log::warn!("Skipping invalid backup {}: {e}", directory.display());
                continue;
            }
        };
        let (timestamp, file_count) = if let Some(manifest) = manifest {
            if manifest.source_profile != source {
                continue;
            }
            (manifest.timestamp, manifest.files.len())
        } else {
            if !name.starts_with(&format!("{id}__")) {
                continue;
            }
            let count = match count_save_files(&directory) {
                Ok(count) => count,
                Err(e) => {
                    log::warn!("Skipping unreadable backup {}: {e}", directory.display());
                    continue;
                }
            };
            (parse_timestamp_from_dirname(&name).unwrap_or(name), count)
        };
        backups.push(BackupEntry {
            path: directory.to_string_lossy().into_owned(),
            timestamp,
            file_count,
            profile_id: id.to_owned(),
        });
    }
    backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(backups)
}

// Writers stay synchronous: an async task could be cut off mid-transaction
// when the window closes, leaving a half-restored profile.
#[tauri::command]
pub fn restore_backup(
    backup_path: String,
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    restore_backup_with_detectors(
        Path::new(&backup_path),
        Path::new(&profile_path),
        &backups_root(&app_handle)?,
        super::detect::is_game_running,
        super::detect::is_steam_running,
    )
}

#[derive(Serialize, Debug)]
pub struct RestoreCheck {
    pub adds: usize,
    pub removes: usize,
    pub blocked_reason: Option<AppError>,
}

struct RestorePlan {
    source: PathBuf,
    files: BTreeMap<PathBuf, Vec<u8>>,
    deletes: BTreeSet<PathBuf>,
    check: RestoreCheck,
    safety_files: BTreeMap<PathBuf, Vec<u8>>,
}

impl RestorePlan {
    fn apply(self, root: &Path) -> Result<(), AppError> {
        if let Some(reason) = self.check.blocked_reason {
            return Err(reason);
        }
        let safety = create_backup_from_tree(&self.source, root, self.safety_files)?;
        super::transaction::apply_changes(&self.source, &self.files, &self.deletes)
            .map_err(|error| error.param("backupPath", safety.display().to_string()))
    }
}

#[tauri::command(async)]
pub fn check_restore(
    backup_path: Option<String>,
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<RestoreCheck, AppError> {
    backups_root(&app_handle)?;
    check_restore_with_detectors(
        backup_path.as_deref().map(Path::new),
        Path::new(&profile_path),
        super::detect::is_game_running,
        super::detect::is_steam_running,
    )
}

/// None selects the game's partial backup. This shares every validation and
/// guard with restore, but creates neither a safety backup nor staged files.
pub fn check_restore_with_detectors(
    backup: Option<&Path>,
    profile: &Path,
    detector: impl FnOnce() -> Result<bool, AppError>,
    steam_detector: impl FnOnce() -> Result<bool, AppError>,
) -> Result<RestoreCheck, AppError> {
    Ok(prepare_restore(backup, profile, detector, steam_detector)?.check)
}

/// Guard and filesystem core shared by the command and integration tests.
pub fn restore_backup_with_detectors(
    backup: &Path,
    profile: &Path,
    root: &Path,
    detector: impl FnOnce() -> Result<bool, AppError>,
    steam_detector: impl FnOnce() -> Result<bool, AppError>,
) -> Result<(), AppError> {
    prepare_restore(Some(backup), profile, detector, steam_detector)?.apply(root)
}

fn prepare_restore(
    backup: Option<&Path>,
    profile: &Path,
    detector: impl FnOnce() -> Result<bool, AppError>,
    steam_detector: impl FnOnce() -> Result<bool, AppError>,
) -> Result<RestorePlan, AppError> {
    super::detect::ensure_game_stopped(detector)?;
    let source = profile.canonicalize().map_err(|e| {
        AppError::new("profile_invalid")
            .param("path", profile.display().to_string())
            .detail(e)
    })?;
    let Some(backup) = backup else {
        let mut files = read_save_tree(&source.join("backup"))?;
        // Transient snapshots are stale after returning to town. Never transplant
        // them into the root or the active raid_save directory.
        for name in [
            "persist.raid.json",
            "persist.map.json",
            "persist.loading_screen.json",
        ] {
            files.remove(Path::new(name));
        }
        if files.is_empty() {
            return Err(AppError::new("game_backup_empty"));
        }
        return restore_plan(profile, source, files, BTreeSet::new(), steam_detector);
    };
    let manifest = read_manifest(backup)?;
    if let Some(manifest) = &manifest {
        if manifest.source_profile != source {
            return Err(AppError::new("backup_wrong_profile"));
        }
    } else {
        let id = profile_id(&source)?;
        if !backup
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with(&format!("{id}__")))
        {
            return Err(AppError::new("legacy_backup_wrong_profile"));
        }
    }
    let files = read_save_tree(backup)?;
    let complete_snapshot = manifest.is_some();
    if let Some(manifest) = manifest {
        let expected: BTreeSet<_> = manifest.files.into_iter().collect();
        let actual: BTreeSet<_> = files.keys().cloned().collect();
        if expected != actual {
            return Err(AppError::new("backup_manifest_mismatch"));
        }
    }
    let deletes = if complete_snapshot {
        restore_deletions(&source, &files)?
    } else {
        // Old backups were top-level-only copies, not complete snapshots.
        BTreeSet::new()
    };
    if files.is_empty() {
        return Err(AppError::new("restore_backup_empty"));
    }
    restore_plan(profile, source, files, deletes, steam_detector)
}

#[tauri::command]
pub fn restore_game_backup(
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    restore_game_backup_with_detectors(
        Path::new(&profile_path),
        &backups_root(&app_handle)?,
        super::detect::is_game_running,
        super::detect::is_steam_running,
    )
}

pub fn restore_game_backup_with_detectors(
    profile: &Path,
    root: &Path,
    detector: impl FnOnce() -> Result<bool, AppError>,
    steam_detector: impl FnOnce() -> Result<bool, AppError>,
) -> Result<(), AppError> {
    prepare_restore(None, profile, detector, steam_detector)?.apply(root)
}

fn restore_plan(
    profile: &Path,
    source: PathBuf,
    files: BTreeMap<PathBuf, Vec<u8>>,
    deletes: BTreeSet<PathBuf>,
    steam_detector: impl FnOnce() -> Result<bool, AppError>,
) -> Result<RestorePlan, AppError> {
    super::transaction::validate_changes(&source, &files, &deletes)?;
    profile_id(&source)?;
    let adds = files
        .keys()
        .filter(|path| !source.join(path).exists())
        .count();
    let removes = deletes.len();
    let blocked_reason = if (adds > 0 || removes > 0)
        && (super::detect::is_steam_profile(profile) || super::detect::is_steam_profile(&source))
        && steam_detector()?
    {
        Some(AppError::new("steam_restore_blocked"))
    } else {
        None
    };
    // Read as late as possible and reuse these bytes for the safety backup.
    let safety_files = read_save_tree(&source)?;
    if safety_files.is_empty() {
        return Err(AppError::new("backup_empty"));
    }
    Ok(RestorePlan {
        safety_files,
        source,
        files,
        deletes,
        check: RestoreCheck {
            adds,
            removes,
            blocked_reason,
        },
    })
}

/// Open the editor's backups directory in the system file manager.
///
/// Creates `<app_local_data_dir>/backups/` first if no backup exists yet.
/// Returns the directory path so the UI can show it if opening fails.
#[tauri::command]
pub fn open_backup_folder(app_handle: tauri::AppHandle) -> Result<String, AppError> {
    let backups_root = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::new("app_data_path").detail(e))?
        .join("backups");

    std::fs::create_dir_all(&backups_root)
        .map_err(|e| AppError::new("backups_create").detail(e))?;

    let path = backups_root.to_string_lossy().to_string();
    app_handle
        .opener()
        .open_path(path.clone(), None::<&str>)
        .map_err(|e| {
            AppError::new("backups_open")
                .param("path", path.clone())
                .detail(e)
        })?;

    Ok(path)
}

fn read_manifest(directory: &Path) -> Result<Option<BackupManifest>, AppError> {
    let canonical = directory
        .canonicalize()
        .unwrap_or_else(|_| directory.to_path_buf());
    if canonical
        .file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with(INCOMPLETE_PREFIX))
    {
        return Err(
            AppError::new("backup_incomplete").param("path", canonical.display().to_string())
        );
    }
    match std::fs::read(directory.join(MANIFEST)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| AppError::new("backup_manifest_invalid").detail(e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::new("backup_manifest_read").detail(e)),
    }
}

pub(crate) fn read_save_tree(root: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>, AppError> {
    fn visit(
        root: &Path,
        relative: &Path,
        files: &mut BTreeMap<PathBuf, Vec<u8>>,
    ) -> Result<(), AppError> {
        let directory = root.join(relative);
        for entry in std::fs::read_dir(&directory).map_err(|e| {
            AppError::new("directory_read")
                .param("path", directory.display().to_string())
                .detail(e)
        })? {
            let entry = entry.map_err(|e| AppError::new("io_error").detail(e))?;
            let kind = entry
                .file_type()
                .map_err(|e| AppError::new("io_error").detail(e))?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let path = relative.join(name.as_ref());
            if kind.is_dir() && !name.starts_with(".hamlet-transaction-") {
                visit(root, &path, files)?;
            } else if kind.is_file() && super::is_save_file(&name) {
                files.insert(
                    path,
                    std::fs::read(entry.path()).map_err(|e| {
                        AppError::new("file_read")
                            .param("path", entry.path().display().to_string())
                            .detail(e)
                    })?,
                );
            } else if kind.is_symlink() && super::is_save_file(&name) {
                return Err(AppError::new("backup_symlink")
                    .param("path", entry.path().display().to_string()));
            }
        }
        Ok(())
    }
    let mut files = BTreeMap::new();
    visit(root, Path::new(""), &mut files)?;
    Ok(files)
}

/// Legacy listings inspect directory metadata only, never file contents.
fn count_save_files(directory: &Path) -> Result<usize, std::io::Error> {
    let mut count = 0;
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir()
            && !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".hamlet-transaction-")
        {
            count += count_save_files(&entry.path())?;
        } else if kind.is_file() && super::is_save_file(&entry.file_name().to_string_lossy()) {
            count += 1;
        }
    }
    Ok(count)
}

fn restore_deletions(
    profile: &Path,
    files: &BTreeMap<PathBuf, Vec<u8>>,
) -> Result<BTreeSet<PathBuf>, AppError> {
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

#[cfg(all(test, unix))]
mod tests {
    use super::profile_id;
    use std::os::unix::ffi::OsStringExt;
    use std::path::PathBuf;

    #[test]
    fn safety_backup_profile_id_rejects_non_utf8_names() {
        let path = PathBuf::from(std::ffi::OsString::from_vec(b"profile_\xff".to_vec()));
        assert_eq!(
            profile_id(&path).unwrap_err(),
            super::AppError::new("profile_id_invalid")
        );
        assert_eq!(
            profile_id(std::path::Path::new("/tmp/profile_0")).unwrap(),
            "profile_0"
        );
    }
}

#[cfg(test)]
mod error_tests {
    use super::*;

    #[test]
    fn publish_retries_transient_windows_errors_and_lists_only_the_complete_snapshot() {
        for os_code in [5, 32, 33] {
            let root = std::env::temp_dir().join(format!(
                "hamlet-publish-retry-{}",
                super::super::transaction::unique_suffix()
            ));
            let source = root.join("profile_0");
            let backups = root.join("backups");
            std::fs::create_dir_all(&source).unwrap();
            std::fs::write(source.join("persist.game.json"), b"original").unwrap();
            let mut attempts = 0;
            let mut delays = Vec::new();
            let complete = create_backup_from_tree_with_hooks(
                &source.canonicalize().unwrap(),
                &backups,
                read_save_tree(&source).unwrap(),
                &mut |_, _| Ok(()),
                &mut |from, to| {
                    publish_backup_with(
                        from,
                        to,
                        &mut |from, to| {
                            attempts += 1;
                            assert!(list_backups_at(&source, &backups).unwrap().is_empty());
                            if attempts < 4 {
                                Err(std::io::Error::from_raw_os_error(os_code))
                            } else {
                                std::fs::rename(from, to)
                            }
                        },
                        &mut |delay| delays.push(delay.as_millis()),
                    )
                },
            )
            .unwrap();
            assert_eq!(attempts, 4);
            assert_eq!(delays, [25, 50, 75]);
            assert_eq!(
                list_backups_at(&source, &backups).unwrap()[0].path,
                complete.display().to_string()
            );
            assert_eq!(
                std::fs::read(complete.join("persist.game.json")).unwrap(),
                b"original"
            );
            assert_eq!(
                std::fs::read(source.join("persist.game.json")).unwrap(),
                b"original"
            );
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn publish_failure_reports_a_complete_unlisted_snapshot_and_stops_retrying() {
        super::super::error::test_log::start();
        for kind in [
            std::io::ErrorKind::PermissionDenied,
            std::io::ErrorKind::NotFound,
        ] {
            let root = std::env::temp_dir().join(format!(
                "hamlet-publish-denied-{}",
                super::super::transaction::unique_suffix()
            ));
            let source = root.join("profile_0");
            let backups = root.join("backups");
            std::fs::create_dir_all(&source).unwrap();
            std::fs::write(source.join("persist.game.json"), b"original").unwrap();
            let mut attempts = 0;
            let mut delays = Vec::new();
            let error = create_backup_from_tree_with_hooks(
                &source.canonicalize().unwrap(),
                &backups,
                read_save_tree(&source).unwrap(),
                &mut |_, _| Ok(()),
                &mut |from, to| {
                    publish_backup_with(
                        from,
                        to,
                        &mut |_, _| {
                            attempts += 1;
                            Err(std::io::Error::new(kind, "injected publish failure"))
                        },
                        &mut |delay| delays.push(delay.as_millis()),
                    )
                },
            )
            .unwrap_err();
            assert_eq!(error.code, "backup_create");
            super::super::error::test_log::assert_logged(&error);
            assert_eq!(error.detail.as_deref(), Some("injected publish failure"));
            assert_eq!(
                attempts,
                if kind == std::io::ErrorKind::PermissionDenied {
                    4
                } else {
                    1
                }
            );
            assert_eq!(delays.len(), attempts - 1);
            let retained = PathBuf::from(error.params["recoveryPath"].as_str().unwrap());
            assert!(retained
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(INCOMPLETE_PREFIX));
            assert!(retained.join(MANIFEST).is_file());
            assert_eq!(
                std::fs::read(retained.join("persist.game.json")).unwrap(),
                b"original"
            );
            assert!(list_backups_at(&source, &backups).unwrap().is_empty());
            assert_eq!(
                read_manifest(&retained).unwrap_err().code,
                "backup_incomplete"
            );
            assert!(!Path::new(error.params["path"].as_str().unwrap()).exists());
            assert_eq!(
                std::fs::read(source.join("persist.game.json")).unwrap(),
                b"original"
            );
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn failed_backup_rollback_retains_recovery_but_cannot_be_listed_or_restored() {
        super::super::error::test_log::start();
        let root = std::env::temp_dir().join(format!(
            "hamlet-incomplete-{}",
            super::super::transaction::unique_suffix()
        ));
        let source = root.join("profile_0");
        let backups = root.join("backups");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("persist.game.json"), b"original game").unwrap();
        std::fs::write(source.join("persist.roster.json"), b"original roster").unwrap();
        let files = read_save_tree(&source).unwrap();
        let error = create_backup_from_tree_with_hook(
            &source.canonicalize().unwrap(),
            &backups,
            files,
            &mut |directory, count| {
                if count != 3 {
                    return Ok(());
                }
                // Leave one partial save file while forcing rollback of another to
                // fail. Rollback removes the manifest, reproducing the legacy hole.
                std::fs::remove_file(directory.join("persist.game.json")).unwrap();
                std::fs::create_dir(directory.join("persist.game.json")).unwrap();
                Err(AppError::new("transaction_io")
                    .param("path", "persist.roster.json")
                    .detail("injected backup failure"))
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "backup_rollback");
        super::super::error::test_log::assert_logged(&error);
        assert!(error
            .detail
            .as_deref()
            .unwrap()
            .contains("injected backup failure"));
        assert!(error
            .detail
            .as_deref()
            .unwrap()
            .contains("persist.game.json"));
        let retained = PathBuf::from(error.params["recoveryPath"].as_str().unwrap());
        assert!(retained.is_dir());
        assert!(!retained.join(MANIFEST).exists());
        // A partial file must not turn the excluded directory into a legacy backup.
        std::fs::write(retained.join("persist.roster.json"), b"partial").unwrap();
        for with_manifest in [false, true] {
            if with_manifest {
                std::fs::write(
                    retained.join(MANIFEST),
                    serde_json::to_vec(&BackupManifest {
                        source_profile: source.canonicalize().unwrap(),
                        timestamp: "fixture".into(),
                        files: vec![PathBuf::from("persist.roster.json")],
                    })
                    .unwrap(),
                )
                .unwrap();
            }
            assert!(list_backups_at(&source, &backups).unwrap().is_empty());
            let error =
                check_restore_with_detectors(Some(&retained), &source, || Ok(false), || Ok(false))
                    .unwrap_err();
            assert_eq!(error.code, "backup_incomplete");
            assert_eq!(
                error.params["path"],
                retained.canonicalize().unwrap().display().to_string()
            );
            let error = restore_backup_with_detectors(
                &retained,
                &source,
                &backups,
                || Ok(false),
                || Ok(false),
            )
            .unwrap_err();
            assert_eq!(error.code, "backup_incomplete");
        }
        #[cfg(unix)]
        {
            let alias = root.join("profile_0__alias");
            std::os::unix::fs::symlink(&retained, &alias).unwrap();
            assert_eq!(read_manifest(&alias).unwrap_err().code, "backup_incomplete");
        }
        assert_eq!(
            std::fs::read(source.join("persist.game.json")).unwrap(),
            b"original game"
        );
        assert_eq!(
            std::fs::read(source.join("persist.roster.json")).unwrap(),
            b"original roster"
        );
        assert_eq!(std::fs::read_dir(&backups).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn completed_backups_are_published_and_ordinary_failures_are_cleaned_up() {
        let root = std::env::temp_dir().join(format!(
            "hamlet-publish-{}",
            super::super::transaction::unique_suffix()
        ));
        let source = root.join("profile_0");
        let backups = root.join("backups");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("persist.game.json"), b"original").unwrap();
        let error = create_backup_from_tree_with_hook(
            &source,
            &backups,
            read_save_tree(&source).unwrap(),
            &mut |_, _| {
                Err(AppError::new("transaction_io")
                    .param("path", "fixture")
                    .detail("injected backup failure"))
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "backup_create");
        assert!(error
            .detail
            .as_deref()
            .unwrap()
            .contains("injected backup failure"));
        assert_eq!(std::fs::read_dir(&backups).unwrap().count(), 0);
        let complete = create_backup_at(&source, &backups).unwrap();
        assert!(complete
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("profile_0__"));
        assert_eq!(list_backups_at(&source, &backups).unwrap().len(), 1);
        assert_eq!(std::fs::read_dir(&backups).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn backup_and_manifest_failures_keep_codes_paths_and_raw_detail() {
        let root = std::env::temp_dir().join(format!(
            "hamlet-backup-errors-{}",
            super::super::transaction::unique_suffix()
        ));
        std::fs::create_dir(&root).unwrap();
        let missing = root.join("missing");
        let error = create_backup_at(&missing, &root).unwrap_err();
        assert_eq!(error.code, "profile_invalid");
        assert_eq!(error.params["path"], missing.display().to_string());
        assert!(error.detail.is_some());
        assert_eq!(
            create_backup_from_tree(&root, &root, BTreeMap::new()).unwrap_err(),
            AppError::new("backup_empty")
        );
        let manifest = root.join(MANIFEST);
        std::fs::write(&manifest, b"{").unwrap();
        let error = read_manifest(&root).unwrap_err();
        assert_eq!(error.code, "backup_manifest_invalid");
        assert!(error.params.is_empty());
        assert!(error.detail.is_some());
        std::fs::remove_file(&manifest).unwrap();
        std::fs::create_dir(&manifest).unwrap();
        let error = read_manifest(&root).unwrap_err();
        assert_eq!(error.code, "backup_manifest_read");
        assert!(error.params.is_empty());
        assert!(error.detail.is_some());
        let error = read_save_tree(&missing).unwrap_err();
        assert_eq!(error.code, "directory_read");
        assert_eq!(
            Path::new(error.params["path"].as_str().unwrap()),
            missing.as_path()
        );
        assert!(error.detail.is_some());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_restore_keeps_the_completed_safety_backup_path() {
        let root = std::env::temp_dir().join(format!(
            "hamlet-safety-errors-{}",
            super::super::transaction::unique_suffix()
        ));
        let source = root.join("profile_0");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("persist.game.json"), b"original").unwrap();
        let snapshot = create_backup_at(&source, &root.join("source")).unwrap();
        let plan = prepare_restore(Some(&snapshot), &source, || Ok(false), || Ok(false)).unwrap();
        // A target changes after read-only preflight but before transaction validation.
        std::fs::remove_file(source.join("persist.game.json")).unwrap();
        std::fs::create_dir(source.join("persist.game.json")).unwrap();
        let error = plan.apply(&root.join("backups")).unwrap_err();
        assert_eq!(error.code, "save_target_invalid");
        let backup = PathBuf::from(error.params["backupPath"].as_str().unwrap());
        assert!(backup.is_dir());
        assert_eq!(
            std::fs::read(backup.join("persist.game.json")).unwrap(),
            b"original"
        );
        assert_eq!(
            error.params["path"],
            source
                .canonicalize()
                .unwrap()
                .join("persist.game.json")
                .display()
                .to_string()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
