use super::error::AppError;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Metadata about a single mod directory discovered on disk.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ModInfo {
    /// Human-readable mod name derived from the directory name.
    pub name: String,
    /// Absolute path to the mod directory.
    pub path: String,
    /// `true` if the mod contains a `heroes/` subdirectory with `.info.darkest` files.
    pub has_heroes: bool,
    /// `true` if the mod contains a `trinkets/` subdirectory with trinket definitions.
    pub has_trinkets: bool,
}

const DD1_APP_ID: u32 = 262060;

/// Scan the local `<game_path>/mods/` directory and the Steam Workshop
/// content directory for installed mods.
///
/// Each subdirectory that contains a `project.xml` manifest is treated as a
/// valid mod. Workshop mods typically live at:
///
///   `<steam_library>/steamapps/workshop/content/262060/`
///
/// An optional `steam_library_path` can be provided to override auto-detection.
/// Returns a deduplicated list of [`ModInfo`] entries sorted alphabetically by
/// mod name.
#[tauri::command]
pub fn scan_mod_directories(
    game_path: String,
    steam_library_path: Option<String>,
) -> Result<Vec<ModInfo>, AppError> {
    let mut mods: Vec<ModInfo> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    // --- Local mods ---
    let mods_dir = Path::new(&game_path).join("mods");
    if mods_dir.is_dir() {
        scan_mods_in(&mods_dir, &mut mods, &mut seen)?;
    }

    // --- Steam Workshop mods ---
    let workshop_dirs = workshop_content_dirs(steam_library_path.as_deref());
    for workshop_dir in workshop_dirs {
        if workshop_dir.is_dir() {
            // Workshop mods don't always have project.xml — scan everything.
            scan_workshop_in(&workshop_dir, &mut mods, &mut seen)?;
        }
    }

    mods.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(mods)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Scan a `mods/`-style directory where each subdirectory must have `project.xml`.
fn scan_mods_in(
    dir: &Path,
    mods: &mut Vec<ModInfo>,
    seen: &mut HashSet<PathBuf>,
) -> Result<(), AppError> {
    let entries = std::fs::read_dir(dir).map_err(|e| {
        AppError::new("mods_read")
            .param("path", dir.display().to_string())
            .detail(e)
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| AppError::new("directory_entry").detail(e))?;
        let mod_path = entry.path();

        if !mod_path.is_dir() {
            continue;
        }

        // A valid local mod must contain a `project.xml` manifest.
        if !mod_path.join("project.xml").exists() {
            continue;
        }

        add_mod(mod_path, mods, seen);
    }

    Ok(())
}

/// Scan a Workshop content directory where each numeric subdirectory is a mod.
/// Workshop mods may not have `project.xml`.
fn scan_workshop_in(
    dir: &Path,
    mods: &mut Vec<ModInfo>,
    seen: &mut HashSet<PathBuf>,
) -> Result<(), AppError> {
    let entries = std::fs::read_dir(dir).map_err(|e| {
        AppError::new("workshop_read")
            .param("path", dir.display().to_string())
            .detail(e)
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| AppError::new("directory_entry").detail(e))?;
        let mod_path = entry.path();

        if !mod_path.is_dir() {
            continue;
        }

        // Workshop mod directories are numeric IDs; accept any directory.
        add_mod(mod_path, mods, seen);
    }

    Ok(())
}

/// Build a [`ModInfo`] from `mod_path` and push it onto `mods`, deduplicating
/// by canonical path.
fn add_mod(mod_path: PathBuf, mods: &mut Vec<ModInfo>, seen: &mut HashSet<PathBuf>) {
    let canon = std::fs::canonicalize(&mod_path).unwrap_or(mod_path.clone());
    if !seen.insert(canon) {
        return;
    }

    let name = mod_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "(unknown)".to_string());

    let has_heroes =
        mod_path.join("heroes").is_dir() && has_darkest_files(&mod_path.join("heroes"));

    let has_trinkets = mod_path.join("trinkets").is_dir();

    mods.push(ModInfo {
        name,
        path: mod_path.to_string_lossy().into_owned(),
        has_heroes,
        has_trinkets,
    });
}

/// Returns `true` if `dir` or any of its immediate subdirectories contains
/// at least one `*.info.darkest` file.
///
/// Mod hero files live at `heroes/<class>/<class>.info.darkest`, so we need
/// to scan one level deeper than the `heroes/` directory itself.
fn has_darkest_files(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let entry_path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        if name.ends_with(".info.darkest") {
            return true;
        }

        // Recurse one level into subdirectories (e.g. heroes/<class>/).
        if entry_path.is_dir() {
            let Ok(sub_entries) = std::fs::read_dir(&entry_path) else {
                continue;
            };
            for sub in sub_entries.flatten() {
                if sub.file_name().to_string_lossy().ends_with(".info.darkest") {
                    return true;
                }
            }
        }
    }
    false
}

/// Build the list of Workshop content directories to scan.
///
/// If `steam_library_path` is provided, use it directly. Otherwise derive
/// from the detected Steam library that contains DD1.
fn workshop_content_dirs(steam_library_path: Option<&str>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Some(lib_path) = steam_library_path {
        dirs.push(
            PathBuf::from(lib_path)
                .join("steamapps/workshop/content")
                .join(DD1_APP_ID.to_string()),
        );
        return dirs;
    }

    // Auto-detect: find the Steam library that contains DD1.
    if let Some(workshop_dir) = detect_workshop_dir() {
        dirs.push(workshop_dir);
    }

    dirs
}

/// Locate the Workshop content directory for DD1 via steamlocate.
fn detect_workshop_dir() -> Option<PathBuf> {
    let steam_dir = steamlocate::SteamDir::locate().ok()?;
    let (_app, library) = steam_dir.find_app(DD1_APP_ID).ok()??;

    let library_path = library.path();
    let workshop = library_path
        .join("steamapps/workshop/content")
        .join(DD1_APP_ID.to_string());

    if workshop.is_dir() {
        Some(workshop)
    } else {
        None
    }
}

#[cfg(test)]
mod error_tests {
    use super::*;

    #[test]
    fn unreadable_mod_roots_preserve_path_and_os_detail() {
        let root = std::env::temp_dir().join(super::super::transaction::unique_suffix());
        let mut mods = Vec::new();
        let mut seen = HashSet::new();
        for (code, result) in [
            ("mods_read", scan_mods_in(&root, &mut mods, &mut seen)),
            (
                "workshop_read",
                scan_workshop_in(&root, &mut mods, &mut seen),
            ),
        ] {
            let error = result.unwrap_err();
            assert_eq!(error.code, code);
            assert_eq!(
                error.params,
                serde_json::from_value(serde_json::json!({"path":root.display().to_string()}))
                    .unwrap()
            );
            assert!(error.detail.is_some());
        }
    }
}
