# Design Decisions

## Architecture

- **Tauri 2** — Rust backend + SvelteKit SPA frontend
- **ddsavelib** — Vendored and modernized Rust crate for DSON binary format handling
- **Game assets at runtime** — All icons, portraits, and reference data read from user's game installation (never bundled)

## Safety

### Game Must Not Be Running
The editor should detect if Darkest Dungeon is running and prevent edits. Detection via `sysinfo` Rust crate, checking for process name `Darkest.exe` (Windows) or `Darkest` (macOS/Linux). Reasons:
- The game may overwrite save files during gameplay
- Steam Cloud sync can conflict with edited saves
- Editing files the game has open can corrupt data

### Steam Cloud Warning
If saves are in a Steam userdata path, warn users to:
- Disable Steam Cloud sync for DD, OR
- Close Steam entirely before editing

### Mid-Raid Editing
Allowed, but with prominent warnings:
- Mid-raid edits: hero revival normally requires 3 files (roster + campaign_log + progression), plus persist.raid.json if mid-dungeon (4 files total)
- Incorrect edits during a raid are more likely to corrupt the save
- Editor should validate cross-file consistency for raid edits

### Save Validation
Round-trip integrity check after editing: encode → decode → compare at the **semantic/JSON level** (not byte-for-byte binary, because bits 1 and 31 of fieldInfo are intentionally stripped during re-encoding). Catches encoding errors before the user loads the save in-game.

## Backups

### Manual Backup
Always available — user-triggered backup of current save state.

### Automatic Backup
Configurable (boolean setting, off by default):
- When enabled, creates a backup before every edit operation
- Backup location follows Tauri `app_local_data_dir` conventions (backups are machine-specific, not meant to roam):
  - **Windows**: `%LOCALAPPDATA%\hamlet-editor\backups\` (AppData\Local via `app_local_data_dir()`)
  - **macOS**: `~/Library/Application Support/hamlet-editor/backups/`
  - **Linux**: `~/.local/share/hamlet-editor/backups/`
- Note: `app_data_dir()` maps to `%APPDATA%` (Roaming) on Windows. We use `app_local_data_dir()` instead since backups are machine-local.
- Timestamped copies with profile identifier

## Path Detection

### Auto-Detection
On launch, auto-detect both save file location and game installation:
- Steam paths via `steamlocate` crate (parses `libraryfolders.vdf`, handles multi-drive)
- GOG/non-Steam via known OS-specific paths
- Windows registry for Steam/GOG as fallback
- All detection runs in Rust backend (not frontend)
- See `docs/path-detection.md` for full algorithm

### Manual Fallback
When auto-detect fails, user picks folders manually via native file picker. Both auto-detect and manual browse buttons visible in Settings and Setup Wizard.

### Persistence
Chosen paths stored in Tauri app data. Re-validated on each launch. If invalid, re-trigger setup.

## Multi-Profile Support
Support all DD1 save profiles (`profile_0`, `profile_1`, `profile_2`, etc.). Auto-detect available profiles and let users switch between them.

## Mod Compatibility
At minimum:
- Handle unknown hero class IDs gracefully (don't crash)
- Handle unknown trinket, quirk, and skill IDs gracefully
- Scan both `mods/` (manual installs) and Steam Workshop `steamapps/workshop/content/262060/` for mod definitions
- Display modded content alongside base game content
- Unknown IDs shown as raw identifiers with amber "modded" indicator (not hidden)
- **Warn about mod dependencies**: once a modded hero class enters a save, removing the mod permanently breaks that save. The editor should detect modded class IDs and warn users.
- Each mod has a `project.xml` at its root with metadata

## DLC Safety
- DLC enable is stored in `persist.game.json` and is **irreversible** — warn clearly before any DLC-related edits
- Do NOT inject DLC-specific fields (Crimson Curse, shards, districts) into saves where that DLC is not enabled — game will crash
- Detect enabled DLCs from `persist.game.json` and conditionally show/hide DLC-specific UI sections

## Name Hash Generation

Scan the game installation (and mod directories) to build a hash-to-name table for human-readable field display. Cache the result to a flat text file so re-scanning isn't needed every launch. 15 file patterns scanned, producing ~3,273 names from the base game. Details in `docs/ddsavelib-refactor.md`.

## Config Persistence

Use `tauri-plugin-store` for settings (chosen paths, auto-backup toggle, display prefs). **Caveat**: configure `auto_save` explicitly — data only auto-persists on graceful app close by default, not on crash.

## Live Reload (Future)

The Java editor implements file watching via `WatchService` on the save directory. We could use the `notify` Rust crate for the same — re-read and re-parse only changed files. Low priority but architecturally viable.

## Legal

Per Red Hook Studios' official modding statement:
- Include required disclaimer in About page and README
- Non-commercial, free and open source
- Do not bundle game assets
- Do not use Red Hook trademarks in branding
- Reference game by name only in descriptive text
