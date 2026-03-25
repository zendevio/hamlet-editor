use chrono::{DateTime, Local, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackupEntry {
    pub path: String,
    pub timestamp: String, // ISO 8601
    pub file_count: usize,
    pub profile_id: String,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Create a timestamped backup of all save files in the profile.
///
/// Copies `persist.*.json` and `novelty_tracker.json` to:
/// `<app_local_data_dir>/backups/<profile_id>__<YYYY-MM-DD>__<HH-MM-SS>/`
///
/// Returns the backup directory path on success.
#[tauri::command]
pub fn create_backup(
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let profile_dir = Path::new(&profile_path);
    if !profile_dir.is_dir() {
        return Err(format!("Not a directory: {profile_path}"));
    }

    let profile_id = profile_dir
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Cannot determine profile ID from: {profile_path}"))?;

    let now = Local::now();
    let folder_name = format!(
        "{}__{}__{}",
        profile_id,
        now.format("%Y-%m-%d"),
        now.format("%H-%M-%S")
    );

    let backups_root = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data dir: {e}"))?
        .join("backups");

    let backup_dir = backups_root.join(&folder_name);

    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Failed to create backup directory: {e}"))?;

    let copied = copy_save_files(profile_dir, &backup_dir)?;

    if copied == 0 {
        // Clean up empty backup directory
        let _ = std::fs::remove_dir(&backup_dir);
        return Err("No save files found to back up".to_string());
    }

    Ok(backup_dir.to_string_lossy().to_string())
}

/// List all backups for the given profile.
///
/// Scans `<app_local_data_dir>/backups/` for directories whose name starts
/// with the profile ID (e.g. `profile_0__*`). Returns timestamp, path, and
/// file count for each, sorted newest-first.
#[tauri::command]
pub fn list_backups(
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<Vec<BackupEntry>, String> {
    let profile_dir = Path::new(&profile_path);
    let profile_id = profile_dir
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Cannot determine profile ID from: {profile_path}"))?
        .to_string();

    let backups_root = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data dir: {e}"))?
        .join("backups");

    if !backups_root.is_dir() {
        return Ok(Vec::new());
    }

    let prefix = format!("{}__", profile_id);

    let entries = std::fs::read_dir(&backups_root)
        .map_err(|e| format!("Failed to read backups directory: {e}"))?;

    let mut backups: Vec<BackupEntry> = Vec::new();

    for entry in entries.flatten() {
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }

        let dir_name = match entry_path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if !dir_name.starts_with(&prefix) {
            continue;
        }

        let file_count = count_save_files(&entry_path);
        let timestamp = parse_timestamp_from_dirname(&dir_name)
            .unwrap_or_else(|| dir_name.clone());

        backups.push(BackupEntry {
            path: entry_path.to_string_lossy().to_string(),
            timestamp,
            file_count,
            profile_id: profile_id.clone(),
        });
    }

    // Sort newest-first by timestamp string (ISO 8601 sorts lexicographically)
    backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(backups)
}

/// Restore a backup to the profile directory.
///
/// Safety: creates a pre-restore backup first (so the user can always undo),
/// then copies all files from the backup directory into the profile directory,
/// overwriting existing files.
#[tauri::command]
pub fn restore_backup(
    backup_path: String,
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let backup_dir = Path::new(&backup_path);
    if !backup_dir.is_dir() {
        return Err(format!("Backup directory does not exist: {backup_path}"));
    }

    let profile_dir = Path::new(&profile_path);
    if !profile_dir.is_dir() {
        return Err(format!("Profile directory does not exist: {profile_path}"));
    }

    // Create a pre-restore safety backup
    create_backup(profile_path.clone(), app_handle)?;

    // Copy all files from backup to profile, overwriting
    copy_save_files(backup_dir, profile_dir)?;

    Ok(())
}

/// Restore from the game's own backup subdirectory.
///
/// The game creates its own backups in `<profile>/backup/`. This command
/// creates a pre-restore safety backup first, then copies files from the
/// game's backup directory to the profile root.
#[tauri::command]
pub fn restore_game_backup(
    profile_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let profile_dir = Path::new(&profile_path);
    if !profile_dir.is_dir() {
        return Err(format!("Profile directory does not exist: {profile_path}"));
    }

    let game_backup_dir = profile_dir.join("backup");
    if !game_backup_dir.is_dir() {
        return Err(format!(
            "Game backup directory does not exist: {}",
            game_backup_dir.display()
        ));
    }

    // Create a pre-restore safety backup
    create_backup(profile_path.clone(), app_handle)?;

    // Copy all files from game backup to profile root
    copy_save_files(&game_backup_dir, profile_dir)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Check whether a filename matches the save file pattern:
/// `persist.*.json` or `novelty_tracker.json`.
fn is_save_file(name: &str) -> bool {
    (name.starts_with("persist.") && name.ends_with(".json")) || name == "novelty_tracker.json"
}

/// Copy all save files from `src_dir` to `dst_dir`.
/// Returns the number of files copied.
fn copy_save_files(src_dir: &Path, dst_dir: &Path) -> Result<usize, String> {
    let entries = std::fs::read_dir(src_dir)
        .map_err(|e| format!("Failed to read directory {}: {e}", src_dir.display()))?;

    let mut count = 0;

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        if !is_save_file(&name) {
            continue;
        }

        let src_file = entry.path();
        if !src_file.is_file() {
            continue;
        }

        let dst_file = dst_dir.join(&*file_name);

        std::fs::copy(&src_file, &dst_file).map_err(|e| {
            format!(
                "Failed to copy {} -> {}: {e}",
                src_file.display(),
                dst_file.display()
            )
        })?;

        count += 1;
    }

    Ok(count)
}

/// Count the number of save files in a directory.
fn count_save_files(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name();
                    let n = name.to_string_lossy();
                    is_save_file(&n) && e.path().is_file()
                })
                .count()
        })
        .unwrap_or(0)
}

/// Parse an ISO 8601 timestamp from a backup directory name.
///
/// Expected format: `<profile_id>__<YYYY-MM-DD>__<HH-MM-SS>`
/// Returns: `Some("YYYY-MM-DDTHH:MM:SS")` or `None` if parsing fails.
fn parse_timestamp_from_dirname(dir_name: &str) -> Option<String> {
    // Split on double-underscore to get [profile_id, date, time]
    let parts: Vec<&str> = dir_name.splitn(3, "__").collect();
    if parts.len() != 3 {
        return None;
    }

    let date_str = parts[1]; // "YYYY-MM-DD"
    let time_str = parts[2]; // "HH-MM-SS"

    // Convert "HH-MM-SS" to "HH:MM:SS"
    let time_colon = time_str.replace('-', ":");

    let datetime_str = format!("{date_str}T{time_colon}");

    // Validate by parsing
    NaiveDateTime::parse_from_str(&datetime_str, "%Y-%m-%dT%H:%M:%S")
        .ok()
        .map(|ndt| {
            // Convert to UTC ISO 8601 for consistent API output
            let local_dt: DateTime<Local> = ndt.and_local_timezone(Local).single()?;
            Some(local_dt.with_timezone(&Utc).to_rfc3339())
        })?
}
