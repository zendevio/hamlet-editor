use std::path::Path;

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

/// Scan the local `<game_path>/mods/` directory for installed mods.
///
/// Each subdirectory that contains a `project.xml` manifest is treated as a
/// valid mod. Returns a list of [`ModInfo`] entries sorted alphabetically by
/// mod name.
///
/// Steam Workshop mods are typically installed to a separate path:
///   macOS:   `~/Library/Application Support/Steam/steamapps/workshop/content/262060/`
///   Windows: `C:\Program Files (x86)\Steam\steamapps\workshop\content\262060\`
///   Linux:   `~/.steam/steam/steamapps/workshop/content/262060/`
///
/// TODO: Extend this function to also scan the Workshop path once the game
/// installation detection layer exposes it (see `commands::detect`).
#[tauri::command]
pub fn scan_mod_directories(game_path: String) -> Result<Vec<ModInfo>, String> {
    let mods_dir = Path::new(&game_path).join("mods");

    if !mods_dir.exists() {
        // No mods directory — not an error, just no mods installed.
        return Ok(Vec::new());
    }

    if !mods_dir.is_dir() {
        return Err(format!(
            "Expected a directory at {}: found a file",
            mods_dir.display()
        ));
    }

    let entries = std::fs::read_dir(&mods_dir)
        .map_err(|e| format!("Failed to read mods directory {}: {e}", mods_dir.display()))?;

    let mut mods: Vec<ModInfo> = Vec::new();

    for entry in entries {
        let entry =
            entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;

        let mod_path = entry.path();

        // Only process directories.
        if !mod_path.is_dir() {
            continue;
        }

        // A valid mod must contain a `project.xml` manifest.
        if !mod_path.join("project.xml").exists() {
            continue;
        }

        let name = mod_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "(unknown)".to_string());

        let has_heroes = mod_path.join("heroes").is_dir()
            && has_darkest_files(&mod_path.join("heroes"));

        let has_trinkets = mod_path.join("trinkets").is_dir();

        mods.push(ModInfo {
            name,
            path: mod_path.to_string_lossy().into_owned(),
            has_heroes,
            has_trinkets,
        });
    }

    mods.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(mods)
}

/// Returns `true` if `dir` contains at least one `*.info.darkest` file.
fn has_darkest_files(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries
        .filter_map(|e| e.ok())
        .any(|e| {
            e.file_name()
                .to_string_lossy()
                .ends_with(".info.darkest")
        })
}
