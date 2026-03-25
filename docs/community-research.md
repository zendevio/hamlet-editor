# Community Research: Complaints, Requests & Edge Cases

> Sources: GitHub Issues (robojumper, Tormak9970), Steam Community, Nexus Mods, FearLess CE, GameFAQs, GOG Forums

## Priority Matrix

| Priority | Feature/Fix |
|----------|-------------|
| Critical | Semantic hero editing (show heroes, not JSON objects) |
| Critical | In-editor search / Ctrl+F across all files |
| Critical | Prevent "encoded with name file" corruption (our decode/encode always uses the correct mode) |
| Critical | Warn before overwriting, with session-level undo (discard changes) |
| High | Quirk add/remove/lock as first-class UI operation |
| High | Hero revival wizard (multi-field operation as single action) |
| High | Trinket management with ID autocomplete from game + mod files |
| High | Gold/heirloom editing |
| High | Estate name rename that handles byte-length constraint automatically |
| High | Backup that captures ALL relevant files (including persist.raid.json if mid-dungeon) |
| High | Clear explanation of mid-dungeon vs hamlet save state |
| Medium | Skill level editing (persist.upgrades.json — underdocumented format) |
| Medium | Town building unlock/downgrade editing |
| Medium | Modded content warnings (missing class refs, missing dungeon mods) |
| Medium | DLC field injection guards (don't insert CC fields into non-CC save) |
| Medium | Cross-platform save location auto-detection |
| Low | Resolve level editing with XP threshold display |
| Low | Campaign log editing |
| Low | Version mismatch detection (EGS vs Steam build numbers) |

## Top Complaints About Existing Editors

### 1. Raw JSON Is Unusable for Non-Technical Users
Every editor presents raw decoded DSON. Users must know which field controls what and hunt for it manually. The robojumper maintainer acknowledged: "the editor should give you a raw view of the data, but doesn't actually understand it semantically."

### 2. No Search / Navigation
GitHub issue #59 (still open): absence of Ctrl+F described as "extremely painful, particularly when working with persist.roster.json." Large rosters = thousands of lines.

### 3. Java Dependency Headaches
JRE version mismatches prevent the editor from launching. Drove users to the web WASM version or Tormak's Tauri app.

### 4. Encoding Workflow Is Error-Prone
The #1 source of "I edited it and now it's broken": users decode with a name file (human-readable mode), edit, then re-encode. The game rejects these files silently. **Our editor eliminates this entirely by handling encode/decode internally.**

### 5. No Validation, No Warnings, No Undo
No editor warns before writing invalid state. No schema validation, no constraint checking, no undo. Only manual backups.

### 6. The .json Extension Is Misleading
Users open saves in Notepad, see binary garbage. Every guide starts with "these are not real JSON files." Our editor eliminates this confusion entirely.

## Critical Gotchas Discovered

### Estate Name Byte-Length Constraint
When editing the estate name in `persist.game.json`, the string length is stored separately in the binary. The DSON binary stores the string length separately. Renaming to a different character count IS possible if the length field is also updated — which our editor handles automatically during encode. Changing length causes the save to disappear. No editor warns about this.

### Skill Upgrades Live in persist.upgrades.json
Skill upgrade levels are NOT stored in the hero object in `persist.roster.json`. They are entries in `persist.upgrades.json`. The format is underdocumented. This affects our "set hero level" feature — we need to understand and update upgrade entries too.

### Mod Removal Permanently Breaks Saves
Once a modded hero class enters a save, removing the mod crashes the game. Modded dungeons are worse — "CANNOT be removed once loaded." Our editor should detect and warn about modded content dependencies.

### DLC Enable Is Irreversible
Enabling a DLC on a save (stored in `persist.game.json`) cannot be undone. Especially dangerous with Color of Madness. Our editor should warn clearly.

### Mid-Dungeon Editing Requires Both Files
Changing hero HP mid-dungeon requires editing BOTH `persist.raid.json` (in-dungeon state) AND `persist.roster.json` (hamlet state). No editor surfaces this.

## Save Corruption Patterns

### Steam Cloud Sync (Leading External Cause)
- Corrupted saves re-download from cloud after reinstall (loop)
- Sync conflicts produce partial states (heroes at 1 HP, equipment deleted)
- Multi-computer sync with wrong conflict resolution = progress rollback

### Game Rejects Silently
- Files encoded with name file/debug flag → game won't load, no error
- Extra commas in manually-edited JSON → dungeon loads but quest fails silently
- Adding effects that don't exist on a class → soft-lock crash

### Duplicate Fields in persist.progression.json
Known edge case across all implementations. DSON format allows duplicate field names. Re-encoding discards duplicates (size changes). Our parser must handle this.

## Power User Workflows

### Pre-Dungeon Backup Cycle (Save Scumming)
The highest-volume workflow:
1. Back up entire profile folder before embarking
2. Run dungeon
3. On bad outcome, restore backup
Critical: game must NOT be running during backup/restore. Users have written batch scripts to automate this.

### Hero Revival (3-file operation)
**Minimal (roster only — leaves stale death flags):**
1. `persist.roster.json` → find hero → set `current_hp` to 1, `roster.status` to 0, `roster.before_on_start_town_visit_status` to 0

**Full revival (3 files, 4 if mid-raid):**
1. `persist.roster.json` → set `current_hp`, `roster.status` to 0, `roster.before_on_start_town_visit_status` to 0
2. `persist.campaign_log.json` → clear `died` flag in MissionEvent entry for this hero
3. `persist.progression.json` → clear graveyard achievement flag
4. (If mid-raid) `persist.raid.json` → add hero GUID back to party array

Revived hero loses equipment (stripped on death), retains resolve level and quirks.

### Trinket Recovery After Hero Death
Find trinket ID from graveyard data, add to `persist.estate.json` trinket list. Challenge: users don't know trinket ID strings — no autocomplete.

### Quirk Removal
Find hero in roster, locate quirks object, delete unwanted entry. For locked quirks: set `is_locked` to false first.

## UX Signals for Our Design

1. **Group by entity, not by file** — users think "edit this hero" not "edit persist.roster.json"
2. **Autocomplete everything** — quirk IDs, trinket IDs, skill IDs from game data + mods
3. **Guided wizards for multi-file operations** — revival, mid-dungeon edits
4. **Validation before write** — schema checking, constraint validation, cross-file consistency
5. **Visual context** — hero portraits, class icons, trinket icons from game installation
6. **Backup is not optional** — auto-backup before every save, with easy restore
7. **The .json-is-binary confusion doesn't exist** — our editor handles format transparently
8. **Estate name rename** must handle the byte-length constraint automatically
9. **Search across all loaded data** — Ctrl+F equivalent
10. **Mod awareness** — scan mods dir, warn about dependencies, handle unknown IDs gracefully
