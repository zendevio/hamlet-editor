use serde::Serialize;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use super::save::decode_save_file;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct SaveLocation {
    pub path: String,
    pub source: String, // "Steam", "Gog", "Epic", "Manual"
    pub steam_user_id: Option<String>,
    pub profile_id: String,
    pub has_active_raid: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct GameInstall {
    pub path: String,
    pub source: String, // "Steam", "Gog", "Manual"
    pub has_crimson_court: bool,
    pub has_shieldbreaker: bool,
    pub has_color_of_madness: bool,
    pub has_musketeer: bool,
    pub has_mods: bool,
}

/// Metadata about a single save profile directory.
#[derive(Serialize, Clone, Debug)]
pub struct ProfileMeta {
    pub profile_id: String,
    pub path: String,
    pub estate_name: Option<String>,
    pub game_mode: Option<String>,
    pub week_number: Option<u32>,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DD1_APP_ID: u32 = 262060;

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Detect all save file locations on this machine.
///
/// Checks Steam userdata directories and GOG/non-Steam platform paths.
/// Returns an empty `Vec` (not an error) when nothing is found.
#[tauri::command]
pub fn detect_save_locations() -> Result<Vec<SaveLocation>, String> {
    let mut locations: Vec<SaveLocation> = Vec::new();
    let mut seen = HashSet::<PathBuf>::new();

    // --- Steam saves ---
    // Collect candidate Steam roots: steamlocate auto-detection plus
    // Linux-specific fallback paths (Flatpak, Snap, symlink).
    let mut steam_roots: Vec<PathBuf> = Vec::new();
    if let Some(root) = try_locate_steam() {
        steam_roots.push(root);
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            steam_roots.push(home.join(".local/share/Steam"));
            steam_roots.push(home.join(".steam/steam"));
            steam_roots.push(home.join(".var/app/com.valvesoftware.Steam/data/Steam"));
            steam_roots.push(home.join("snap/steam/common/.local/share/Steam"));
        }
    }
    // Deduplicate Steam roots by canonical path
    let mut seen_roots = HashSet::<PathBuf>::new();
    steam_roots.retain(|r| {
        let canon = std::fs::canonicalize(r).unwrap_or(r.clone());
        r.is_dir() && seen_roots.insert(canon)
    });

    for steam_root in &steam_roots {
        let userdata = steam_root.join("userdata");
        if !userdata.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&userdata) {
            for entry in entries.flatten() {
                let user_dir = entry.path();
                if !user_dir.is_dir() {
                    continue;
                }
                // Steam3 user ID is the directory name
                let steam_user_id = user_dir
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string());

                // Only numeric directory names are real user IDs
                if let Some(ref id) = steam_user_id {
                    if !id.chars().all(|c| c.is_ascii_digit()) {
                        continue;
                    }
                }

                let remote = user_dir.join(DD1_APP_ID.to_string()).join("remote");
                collect_profiles(&remote, "Steam", &steam_user_id, &mut locations, &mut seen);
            }
        }
    }

    // --- GOG / Non-Steam / Epic saves ---
    for dir in gog_save_dirs() {
        collect_profiles(&dir, "Gog", &None, &mut locations, &mut seen);
    }

    Ok(locations)
}

/// Detect game installation directories.
///
/// Checks Steam libraries and GOG registry / well-known paths.
/// Returns an empty `Vec` (not an error) when nothing is found.
#[tauri::command]
pub fn detect_game_installations() -> Result<Vec<GameInstall>, String> {
    let mut installs: Vec<GameInstall> = Vec::new();
    let mut seen = HashSet::<PathBuf>::new();

    // --- Steam ---
    if let Some(install) = detect_steam_game_install() {
        if let Ok(canon) = std::fs::canonicalize(&install.path) {
            seen.insert(canon);
        }
        installs.push(install);
    }

    // --- GOG (Windows registry) ---
    #[cfg(target_os = "windows")]
    {
        for install in detect_gog_game_installs_windows() {
            let canon =
                std::fs::canonicalize(&install.path).unwrap_or(PathBuf::from(&install.path));
            if seen.insert(canon) {
                installs.push(install);
            }
        }
    }

    // --- GOG well-known paths ---
    for path in gog_game_dirs() {
        let resolved = resolve_data_root(&path);
        if is_valid_game_directory(&resolved) {
            let canon = std::fs::canonicalize(&resolved).unwrap_or(resolved.clone());
            if seen.insert(canon) {
                installs.push(build_game_install(
                    resolved.to_string_lossy().to_string(),
                    "Gog",
                ));
            }
        }
    }

    Ok(installs)
}

/// Check if Darkest Dungeon is currently running.
///
/// Uses `sysinfo` to scan for a process named `Darkest.exe` (Windows)
/// or `Darkest` (macOS/Linux).
#[tauri::command]
pub fn is_game_running() -> Result<bool, String> {
    let target: &OsStr = if cfg!(target_os = "windows") {
        OsStr::new("Darkest.exe")
    } else {
        OsStr::new("Darkest")
    };

    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let found = sys.processes().values().any(|p| p.name() == target);
    Ok(found)
}

/// Validate that a user-chosen directory looks like a valid DD1 save profile.
#[tauri::command]
pub fn validate_save_directory(path: String) -> Result<bool, String> {
    Ok(is_valid_save_directory(Path::new(&path)))
}

/// Validate that a user-chosen directory looks like a valid DD1 game installation.
#[tauri::command]
pub fn validate_game_directory(path: String) -> Result<bool, String> {
    let p = PathBuf::from(&path);
    let resolved = resolve_data_root(&p);
    Ok(is_valid_game_directory(&resolved))
}

/// List all save profiles found under `save_root`.
///
/// For each `profile_*` directory, attempts to decode `persist.game.json` to
/// extract `estatename` and `game_mode`, and `persist.campaign_log.json` to
/// extract `total_weeks`. Fields are `None` when decoding fails.
#[tauri::command]
pub fn list_profiles(save_root: String) -> Result<Vec<ProfileMeta>, String> {
    let root = Path::new(&save_root);
    if !root.is_dir() {
        return Err(format!("Not a directory: {save_root}"));
    }

    let entries = std::fs::read_dir(root)
        .map_err(|e| format!("Failed to read directory {save_root}: {e}"))?;

    let mut profiles: Vec<ProfileMeta> = Vec::new();

    for entry in entries.flatten() {
        let profile_dir = entry.path();
        if !profile_dir.is_dir() {
            continue;
        }

        let dir_name = match profile_dir.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if !dir_name.starts_with("profile_") {
            continue;
        }

        let path_str = profile_dir.to_string_lossy().to_string();

        // Try to decode persist.game.json for estatename and game_mode.
        let (estate_name, game_mode) = decode_game_json(&profile_dir);

        // Try to decode persist.campaign_log.json for total_weeks.
        let week_number = decode_campaign_log_json(&profile_dir);

        profiles.push(ProfileMeta {
            profile_id: dir_name,
            path: path_str,
            estate_name,
            game_mode,
            week_number,
        });
    }

    profiles.sort_by(|a, b| a.profile_id.cmp(&b.profile_id));
    Ok(profiles)
}

/// Attempt to decode `persist.game.json` from a profile directory and extract
/// `estatename` and `game_mode` fields.
fn decode_game_json(profile_dir: &Path) -> (Option<String>, Option<String>) {
    let path = profile_dir.join("persist.game.json");
    if !path.exists() {
        return (None, None);
    }

    let value = match decode_save_file(path.to_string_lossy().to_string()) {
        Ok(v) => v,
        Err(_) => return (None, None),
    };

    // The DSON root is typically an object with a `base_root` key wrapping
    // the actual data. Try both top-level and one level nested.
    let estate_name = find_str_field(&value, "estatename");
    let game_mode = find_str_field(&value, "game_mode");

    (estate_name, game_mode)
}

/// Attempt to decode `persist.campaign_log.json` and extract `total_weeks`.
fn decode_campaign_log_json(profile_dir: &Path) -> Option<u32> {
    let path = profile_dir.join("persist.campaign_log.json");
    if !path.exists() {
        return None;
    }

    let value = decode_save_file(path.to_string_lossy().to_string()).ok()?;
    find_u32_field(&value, "total_weeks")
}

/// Search for a string field by key, checking the root object and one level
/// of nesting (to handle DSON's `base_root` wrapper).
fn find_str_field(value: &serde_json::Value, key: &str) -> Option<String> {
    // Direct field.
    if let Some(s) = value.get(key).and_then(|v| v.as_str()) {
        return Some(s.to_string());
    }
    // One level nested.
    if let Some(obj) = value.as_object() {
        for child in obj.values() {
            if let Some(s) = child.get(key).and_then(|v| v.as_str()) {
                return Some(s.to_string());
            }
        }
    }
    None
}

/// Search for a u32 field by key, checking root and one level of nesting.
fn find_u32_field(value: &serde_json::Value, key: &str) -> Option<u32> {
    // Direct field.
    if let Some(n) = value.get(key).and_then(|v| v.as_u64()) {
        return Some(n as u32);
    }
    // One level nested.
    if let Some(obj) = value.as_object() {
        for child in obj.values() {
            if let Some(n) = child.get(key).and_then(|v| v.as_u64()) {
                return Some(n as u32);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Try to locate the Steam root directory.
///
/// Returns the path to the Steam root (e.g. `~/.local/share/Steam`),
/// or `None` if Steam is not installed.
fn try_locate_steam() -> Option<PathBuf> {
    steamlocate::SteamDir::locate()
        .ok()
        .map(|sd| sd.path().to_path_buf())
}

/// Enumerate profile subdirectories within a parent directory,
/// validate each one, and add valid profiles to `locations`.
fn collect_profiles(
    parent: &Path,
    source: &str,
    steam_user_id: &Option<String>,
    locations: &mut Vec<SaveLocation>,
    seen: &mut HashSet<PathBuf>,
) {
    if !parent.is_dir() {
        return;
    }

    let entries = match std::fs::read_dir(parent) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let profile_dir = entry.path();
        if !profile_dir.is_dir() {
            continue;
        }

        let dir_name = match profile_dir.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        // Only consider profile_# directories, skip backup/ and anything else
        if !dir_name.starts_with("profile_") {
            continue;
        }

        if !is_valid_save_directory(&profile_dir) {
            continue;
        }

        // Deduplicate by canonical path
        let canon = std::fs::canonicalize(&profile_dir).unwrap_or(profile_dir.clone());
        if !seen.insert(canon) {
            continue;
        }

        let has_active_raid = profile_dir.join("persist.raid.json").exists();

        locations.push(SaveLocation {
            path: profile_dir.to_string_lossy().to_string(),
            source: source.to_string(),
            steam_user_id: steam_user_id.clone(),
            profile_id: dir_name,
            has_active_raid,
        });
    }
}

/// Return platform-specific GOG/non-Steam save directories to probe.
fn gog_save_dirs() -> Vec<PathBuf> {
    let mut result = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // %USERPROFILE%\Documents\Darkest\ — also covers Epic
        // Use dirs::document_dir() to handle OneDrive redirect
        if let Some(docs) = dirs::document_dir() {
            result.push(docs.join("Darkest"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            result.push(home.join("Library/Application Support/Darkest"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            result.push(home.join(".local/share/Red Hook Studios/Darkest"));
        }
    }

    result
}

/// Return platform-specific well-known GOG game installation directories.
fn gog_game_dirs() -> Vec<PathBuf> {
    #[allow(unused_mut)]
    let mut dirs_list = Vec::new();

    #[cfg(target_os = "windows")]
    {
        dirs_list.push(PathBuf::from(r"C:\GOG Games\Darkest Dungeon"));
    }

    // GOG is not officially available on macOS or Linux for DD1,
    // but we include nothing here rather than wrong paths.

    dirs_list
}

/// A save directory is valid if it contains the two required files.
fn is_valid_save_directory(dir: &Path) -> bool {
    dir.join("persist.game.json").exists() && dir.join("persist.roster.json").exists()
}

/// A game installation directory is valid if it contains the three
/// required subdirectories.
fn is_valid_game_directory(dir: &Path) -> bool {
    dir.join("heroes").is_dir() && dir.join("campaign").is_dir() && dir.join("shared").is_dir()
}

/// On macOS the actual game data lives inside the app bundle.
/// If top-level validation fails, probe the `_osx/` path.
fn resolve_data_root(install_dir: &Path) -> PathBuf {
    if is_valid_game_directory(install_dir) {
        return install_dir.to_path_buf();
    }

    #[cfg(target_os = "macos")]
    {
        let osx_data = install_dir.join("_osx/Darkest.app/Contents/Resources/data");
        if is_valid_game_directory(&osx_data) {
            return osx_data;
        }
    }

    // Fallback: return as-is (caller will validate)
    install_dir.to_path_buf()
}

/// Detect the DD1 game installation via Steam.
fn detect_steam_game_install() -> Option<GameInstall> {
    let steam_dir = steamlocate::SteamDir::locate().ok()?;
    let (app, library) = steam_dir.find_app(DD1_APP_ID).ok()??;
    let install_dir = library.resolve_app_dir(&app);
    let resolved = resolve_data_root(&install_dir);

    if is_valid_game_directory(&resolved) {
        Some(build_game_install(
            resolved.to_string_lossy().to_string(),
            "Steam",
        ))
    } else {
        None
    }
}

/// Detect GOG game installs via Windows registry.
#[cfg(target_os = "windows")]
fn detect_gog_game_installs_windows() -> Vec<GameInstall> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut installs = Vec::new();

    // GOG registry keys to check
    let registry_paths = [
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\GOG.com\Games\1450711444",
        ),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\GOG.com\Games\1450711444"),
    ];

    for (hive, subkey) in &registry_paths {
        if let Ok(key) = RegKey::predef(*hive).open_subkey(subkey) {
            if let Ok(path_str) = key.get_value::<String, _>("path") {
                let path = PathBuf::from(&path_str);
                let resolved = resolve_data_root(&path);
                if is_valid_game_directory(&resolved) {
                    installs.push(build_game_install(
                        resolved.to_string_lossy().to_string(),
                        "Gog",
                    ));
                }
            }
        }
    }

    installs
}

/// Build a `GameInstall` struct by inspecting DLC and mod directories.
fn build_game_install(path: String, source: &str) -> GameInstall {
    let base = Path::new(&path);

    let has_crimson_court = base.join("dlc/580100_crimson_court").is_dir();
    let has_shieldbreaker = base.join("dlc/702540_shieldbreaker").is_dir();
    let has_color_of_madness = base.join("dlc/735730_color_of_madness").is_dir();
    let has_musketeer = base.join("dlc/445700_musketeer").is_dir();

    let has_mods = base.join("mods").is_dir()
        && std::fs::read_dir(base.join("mods"))
            .map(|mut rd| rd.next().is_some())
            .unwrap_or(false);

    GameInstall {
        path,
        source: source.to_string(),
        has_crimson_court,
        has_shieldbreaker,
        has_color_of_madness,
        has_musketeer,
        has_mods,
    }
}
