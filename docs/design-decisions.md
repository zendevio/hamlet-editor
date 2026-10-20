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
The editor does not detect Steam Cloud sync (decided 2026-10-19, to avoid
maintaining path heuristics). The README and a static note in the setup
wizard's save-folder step tell users to:
- Disable Steam Cloud sync for DD, OR
- Close Steam entirely before editing

### Mid-Raid Editing
Allowed, but with prominent warnings:
- Revival is town-only and changes the roster alone: alive status, full class HP, cleared combat state. Death history is retained and lost skill purchases are not recreated. Installed mode-specific Stage Coach capacity, current upgrades and the Shieldbreaker DLC slot bonus determine the living roster limit. Unknown capacity blocks revival.
- Incorrect edits during a raid are more likely to corrupt the save
- Editor should validate cross-file consistency for raid edits

### Expedition Return and Hero Status

Editor abandon is a minimal town return for every active raid, including plot and Courtyard raids. It preserves the raid path and file, clears survivor combat state, retains dead heroes, and returns party inventory trinkets. Supplies and loot are lost. It does not advance the week or reproduce quest, campaign log or quirk processing; the dialog recommends the game's "Regroup in the Hamlet!". Revival and editor abandon await in-game verification in checklist scenarios 11 and 12.

Status 1 means "In party" and is valid in town after the game returns. Status 4 is labeled "Missing". Inactive raid files are ignored for dismissal. Dead heroes retain their graves and cannot be dismissed or have trinkets equipped/unequipped; the final living hero cannot be dismissed.

### Save Validation
Round-trip integrity check after editing: encode → decode → compare at the **semantic/JSON level** (not byte-for-byte binary, because bits 1 and 31 of fieldInfo are intentionally stripped during re-encoding). Catches encoding errors before the user loads the save in-game.

## Backups

### Manual Backup
Always available — user-triggered backup of current save state.

### Automatic Backup
Configurable (boolean setting, off by default):
- When enabled, creates a backup before every edit operation
- Backup location follows Tauri `app_local_data_dir` conventions (backups are machine-specific, not meant to roam):
  - **Windows**: `%LOCALAPPDATA%\io.github.zendevio.hamlet-editor\backups\` (AppData\Local via `app_local_data_dir()`)
  - **macOS**: `~/Library/Application Support/io.github.zendevio.hamlet-editor/backups/`
  - **Linux**: `~/.local/share/io.github.zendevio.hamlet-editor/backups/`
- Note: `app_data_dir()` maps to `%APPDATA%` (Roaming) on Windows. We use `app_local_data_dir()` instead since backups are machine-local.
- Timestamped copies with profile identifier

### Backup Restore and Steam
Both restore commands compute writes and deletions before changing files or
creating a safety backup. Settings runs the same read-only preflight before
confirmation, before the unsaved-edits prompt, and after the user chooses Save
or Discard (after a successful Save, before discarding edits). It shows the actual
additions and deletions, and disables Restore with the reason when Steam blocks it. Restore
commands repeat all checks to guard against changes after preflight.
If the restore adds or removes files in a Steam-managed profile, Steam must be
fully stopped: its running remote-storage cache retains stale file sizes and
can stop the game from loading the campaign. Overwrite-only restores remain
allowed. All restores still require the game to be stopped first. Main client
process names are matched exactly, ignoring case: `steam_osx` on macOS,
`steam.exe` on Windows, and `steam` on Linux; helper processes are excluded.
Steam ownership matches either the supplied or canonical path against the
`userdata/<numeric account>/262060/remote/<profile>` layout used by discovery.
This guards both an outside alias pointing into Steam and a Steam-side symlink
or junction pointing to an outside folder. This is storage ownership, not Cloud
status.
GOG, Epic and manual profiles outside that layout do not need Steam to stop.
Game backup restores exclude stale `persist.raid.json`, `persist.map.json` and
`persist.loading_screen.json` snapshots; the game removes the loading screen
file on returning to town. Blocked confirmations offer Check again after Steam
stops. Restore errors remain visible in persistent toasts with close buttons.
Normal profile saves only overwrite files decoded at load and never delete files.
Legacy and game backups remain partial snapshots and do not authorize deletions.

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
