# Save File & Game Installation Auto-Detection

## Overview

Auto-detect save file locations and game installation paths on all platforms. Manual fallback when auto-detect fails. All detection logic runs in the Rust backend.

## Save File Locations

### Steam Saves

Path pattern: `<STEAM_ROOT>/userdata/<STEAM3_ID>/262060/remote/profile_#/`

#### Steam Root Per Platform

| Platform | Path | Discovery |
|----------|------|-----------|
| Windows | `C:\Program Files (x86)\Steam\` | Registry: `HKCU\Software\Valve\Steam\SteamPath` or `HKLM\SOFTWARE\Valve\Steam\InstallPath` |
| macOS | `~/Library/Application Support/Steam/` | Fixed path |
| Linux (native) | `~/.local/share/Steam/` | Fixed path; also check `~/.steam/steam` symlink |
| Linux (Flatpak) | `~/.var/app/com.valvesoftware.Steam/data/Steam/` | Fixed path |
| Linux (Snap) | `~/snap/steam/common/.local/share/Steam/` | Fixed path |

### GOG / Non-Steam Saves

| Platform | Path |
|----------|------|
| Windows | `%USERPROFILE%\Documents\Darkest\profile_#\` (also used by Epic Games Store) |
| macOS | `~/Library/Application Support/Darkest/profile_#/` |
| Linux | `~/.local/share/Red Hook Studios/Darkest/profile_#/` |

**Windows Documents redirect**: OneDrive can redirect Documents to `%USERPROFILE%\OneDrive\Documents\`. Use `dirs::document_dir()` in Rust instead of hardcoding the Documents path.

## Game Installation Locations

### Steam

Discovered via `libraryfolders.vdf` parsing (handled by `steamlocate` crate).

Path: `<STEAM_LIBRARY>/steamapps/common/DarkestDungeon/`

macOS quirk: actual data is in `_osx/Darkest.app/Contents/Resources/data/`

### GOG

| Platform | Path | Discovery |
|----------|------|-----------|
| Windows | `C:\GOG Games\Darkest Dungeon\` | Registry: `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\1450711444\path` |
| macOS | N/A | |
| Linux | N/A | |

## Steam Discovery: `libraryfolders.vdf`

Location: `<STEAM_ROOT>/config/libraryfolders.vdf` (modern) or `<STEAM_ROOT>/steamapps/libraryfolders.vdf` (legacy)

Format: Valve KeyValues (VDF) text format. Each numbered entry has a `"path"` and `"apps"` listing installed app IDs. DD1's app ID is `262060`.

**Recommended crate**: `steamlocate` v2.0 (MIT) — handles both VDF format versions, cross-platform Steam root discovery, library enumeration.

```rust
use steamlocate::SteamDir;

let steam_dir = SteamDir::locate()?;
if let Some((app, library)) = steam_dir.find_app(262060)? {
    let install_path = library.resolve_app_dir(&app);
    // ...
}
```

Note: `find_app()` returns `Result<Option<(App, Library)>>` — the `Option` is `None` when the app isn't installed.

## Validation

### Save Directory Validation

A directory is valid if it contains:
- **Required**: `persist.game.json` + `persist.roster.json`
- **Expected** (non-empty save): `persist.estate.json`, `persist.town.json`, `persist.campaign_log.json`
- **Optional** (active raid): `persist.raid.json`, `persist.map.json`

### Game Installation Validation

A directory is valid if it contains:
- **Required**: `heroes/` + `campaign/` + `shared/` directories
- **Strong signals**: `heroes/crusader/`, `colours.darkest`, `scripts/`
- **macOS fallback**: If validation fails, probe `_osx/Darkest.app/Contents/Resources/data/`

## Detection Algorithms

### Save File Detection

```
1. Find Steam root (platform-specific)
2. Enumerate <steam_root>/userdata/<numeric_dirs>/262060/remote/
3. For each, enumerate profile_# subdirectories (exclude `backup/` — game creates it inside each profile with valid save files but it's not a profile)
4. Validate each profile directory
5. Check GOG/non-Steam paths
6. Enumerate and validate profile_# subdirectories
7. Return all valid locations (deduplicated by canonical path)
```

### Game Installation Detection

```
1. Use steamlocate to find app 262060
2. Resolve data root (handle macOS _osx path)
3. Validate
4. Check GOG registry (Windows only)
5. Check well-known GOG paths
6. Return all valid installations
```

## Data Structures

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct SaveLocation {
    pub path: PathBuf,
    pub source: SaveSource,
    pub steam_user_id: Option<String>,
    pub profile_id: String,          // "profile_0", "profile_1", etc.
    pub has_active_raid: bool,       // persist.raid.json exists
    pub week_number: Option<u32>,    // from persist.game.json if readable
}

#[derive(Serialize, Deserialize, Clone)]
pub enum SaveSource {
    Steam,
    Gog,
    Epic,  // EGS saves use same GOG/non-Steam paths
    Manual,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GameInstall {
    pub path: PathBuf,
    pub source: InstallSource,
    pub has_crimson_court: bool,     // dlc/580100_crimson_court/ exists
    pub has_shieldbreaker: bool,     // dlc/702540_shieldbreaker/ exists
    pub has_color_of_madness: bool,  // dlc/735730_color_of_madness/ exists
    pub has_musketeer: bool,         // dlc/445700_musketeer/ exists
    pub has_mods: bool,              // mods/ directory non-empty
}

#[derive(Serialize, Deserialize, Clone)]
pub enum InstallSource {
    Steam,
    Gog,
    Manual,
}

#[derive(Serialize, Deserialize)]
pub struct DetectionReport {
    pub saves: Vec<SaveLocation>,
    pub installations: Vec<GameInstall>,
    pub errors: Vec<String>,         // non-fatal errors during detection
}
```

## Tauri Commands

```rust
#[tauri::command]
fn detect_save_locations() -> Result<Vec<SaveLocation>, String>

#[tauri::command]
fn detect_game_installations() -> Result<Vec<GameInstall>, String>

#[tauri::command]
fn validate_save_directory(path: String) -> Result<SaveValidation, String>

#[tauri::command]
fn validate_game_directory(path: String) -> Result<GameValidation, String>
```

## Required Dependencies

| Crate / Plugin | Purpose | Platform | Conditional |
|---------------|---------|----------|-------------|
| `steamlocate` v2.0+ | Steam root, libraryfolders.vdf, app lookup | All | No |
| `winreg` | Windows registry for GOG path lookup | Windows | `#[cfg(target_os = "windows")]` |
| `sysinfo` | Process detection (game-running check) | All | No |
| `dirs` | OS-standard directory paths (Documents, etc.) | All | No |
| `tauri-plugin-fs` | Frontend file reads after path established | All | No |
| `tauri-plugin-dialog` | Native folder picker for manual fallback | All | No |
| `tauri-plugin-store` | Config persistence (chosen paths, settings) | All | No |
| `tauri-plugin-os` | Platform detection in frontend | All | No |

## UX Flow

### First Launch

1. Show Setup screen with two sections: "Save Files" and "Game Installation"
2. Each has "Auto-detect" and "Browse manually..." buttons

### Auto-Detect

1. Call backend `detect_save_locations()` / `detect_game_installations()`
2. 0 results → "Not found. Please select manually."
3. 1 result → auto-select, show confirmation
4. Multiple → show picker with source labels (Steam user ID, GOG, profile name)

### Manual Browse

1. Open native folder picker via `tauri-plugin-dialog`
2. Call `validate_save_directory()` / `validate_game_directory()`
3. Valid → accept. Invalid → show error with details.

### Subsequent Launches

1. Load persisted config from Tauri app data directory
2. Re-validate stored paths still exist
3. If invalid → re-trigger setup

## Edge Cases

| Case | Handling |
|------|----------|
| Steam on non-default drive | `steamlocate` parses all library folders |
| Multiple Steam accounts | Enumerate all `userdata/` subdirectories |
| Flatpak/Snap Steam (Linux) | Check additional fixed paths |
| Symlinks | `Path::exists()` follows symlinks; `canonicalize()` for dedup |
| GOG 64-bit registry | Also check `HKLM\SOFTWARE\GOG.com\Games\1450711444\path` (non-WOW6432Node) for standalone 64-bit installers |
| Steam Deck | Handled by existing Linux paths (`~` = `/home/deck`); native Linux build, no Proton involved |
| Proton/Wine (edge case) | If user forces Windows build via Proton, saves land at `~/.steam/steam/steamapps/compatdata/262060/pfx/drive_c/users/steamuser/Documents/Darkest/` — out of scope but documented |
| Cloud disabled | Saves go to GOG/non-Steam paths; both checked |
| macOS app bundle | `resolve_data_root()` probes `_osx/` path |
| No saves yet (game not played) | Return empty; explain in UI |
| Permission denied | Log error, skip, continue detection |
| Path with spaces/special chars | `PathBuf` handles natively |
