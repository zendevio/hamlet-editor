# Hamlet Editor — UI/UX Architecture

> Definitive specification for a Tauri 2 + SvelteKit desktop save game editor for Darkest Dungeon 1.
> Every section references the authoritative source document where applicable.

---

## 1. Design Principles

These principles govern every design decision in the document. When in doubt, resolve conflicts by consulting this list in order.

1. **Entity-first, not file-first.** Users think "edit this hero," not "edit persist.roster.json." The editor abstracts away multi-file operations and handles cross-file consistency internally.
2. **Error prevention over error correction.** Constrain inputs to valid values (dropdowns, sliders, autocomplete). Validate inline. Never let the user type a string where a known enum exists.
3. **Progressive disclosure.** Show primary data upfront; reveal secondary data on demand. Collapse sections the user did not ask for.
4. **Recognition over recall.** Display game icons, portraits, class names, and localized strings alongside internal IDs. Raw IDs appear only as tooltips or in advanced views.
5. **Keyboard-first for power users.** Every action reachable via keyboard. Shortcuts documented in-app.
6. **Confirmation gates only for destructive/multi-file operations.** Do not over-confirm trivial changes. Inline editing is immediate; batch and cross-file operations show a confirmation dialog.
7. **Accessibility always.** Color is never the sole indicator. All badges have text labels. Contrast meets WCAG AA. Focus indicators are visible.
8. **DLC-conditional UI.** Never show controls for DLC content on saves where that DLC is not enabled. Never inject DLC fields into non-DLC saves. Source: `design-decisions.md` DLC Safety.

---

## 2. Navigation & Layout

### 2.1 Shell Structure

Sidebar + header bar + main content area. The sidebar is the persistent navigation spine.

```
+--------+---------------------------------------------------+
| SIDE   |  HEADER BAR (profile, status badges, actions)     |
| BAR    +---------------------------------------------------+
|        |                                                   |
| Nav    |  MAIN CONTENT                                     |
| Items  |  (scrollable, varies by active view)              |
|        |                                                   |
|        |                                                   |
+--------+---------------------------------------------------+
```

### 2.2 Sidebar

Fixed-width left sidebar (~240 px, collapsible to icon-only ~48 px). Uses the shadcn-svelte `Sidebar` component (sidebar variant, Phosphor icons).

Contents top-to-bottom:

1. **App wordmark** — "Hamlet Editor" at top; collapses to an icon.
2. **Profile selector** — `Select` dropdown showing the current profile with metadata: save name (`estatename` from `persist.game.json`), game mode (`game_mode` from `persist.game.json`), week number (`total_weeks` from `persist.campaign_log.json`). Switching profiles triggers a full data reload with a full-screen loading overlay (see LoadingScreen, section 5.6).
3. **Navigation items** (Phosphor icons + labels):
   - **Heroes** (ph:users-four) — Default landing page.
   - **Estate** (ph:bank) — Wallet, trinket storage, estate currencies.
   - **Town** (ph:buildings) — Building upgrades, treatment slots.
   - **Raid** (ph:compass) — Visible only when BOTH `persist.raid.json` exists AND `inraid: true` in `persist.game.json`. If only one condition is true (inconsistent state), the nav item is visible with an amber warning icon and tooltip: "Raid state is inconsistent between persist.raid.json and persist.game.json. Backup recommended before editing."
   - **Settings** (ph:gear) — Paths, backups, preferences.
4. **Sidebar footer**:
   - Backup status indicator (last backup timestamp or "No backup").
   - Dark/light mode toggle (`ModeWatcher` + `Button`).
   - About link (opens modal with version and the required Red Hook legal disclaimer: "Hamlet Editor is not an official Red Hook Studios product or product modification, and Red Hook Studios Inc. is not responsible for changes or damages resulting from its use.").

### 2.3 Header Bar

Horizontal bar across the top of the main content area.

**Left:**
- View title (e.g., "Heroes", "Estate").
- Global search trigger: magnifying glass icon + `Ctrl/Cmd+K` shortcut. Opens the Command Palette (section 6.7).

**Right — Status badges:**
| Badge | Condition | Color | Text |
|-------|-----------|-------|------|
| Game running | `is_game_running()` returns true | Red | "DD Running — Save Blocked" |
| Raid active | `persist.raid.json` exists AND `inraid: true` in game.json. If only one condition is true, show amber "Raid State Inconsistent" warning instead. | Amber | "Raid Active" |
| Mod content | Modded class/trinket/quirk IDs detected | Amber | "Modded Content" |
| Unsaved changes | Any in-memory edit differs from on-disk state | Orange dot on Save button + ARIA label "Unsaved changes" | Tooltip: "Unsaved changes" (accessible to screen readers) |

Every badge uses both color and a text label or ARIA label (accessibility principle). **Note**: amber badges must be validated for WCAG AA contrast in both light and dark modes during implementation. Use a darker amber shade or add a contrasting outline if needed.

**Right — Action buttons:**
- **Save** (ph:floppy-disk) — Writes all pending changes. Disabled when no changes exist or when the game is running. Triggers an auto-backup first if auto-backup is enabled.
- **Discard** (ph:arrow-counter-clockwise) — Reverts all in-memory changes to the last saved state. Confirmation dialog: "Discard all unsaved changes?"
- **Backup** (ph:archive) — Manual backup, always available.

### 2.4 Why Sidebar Over Tabs

- The data domains (Heroes, Estate, Town, Raid) are distinct but cross-referenced (checking estate trinkets while editing a hero). Sidebar navigation is instant without implying a sequential workflow.
- Scales if we add views later (Quest editor, Campaign Log).
- Provides persistent room for the profile selector and footer indicators.

---

## 3. Views

### 3.1 Setup Wizard (First Launch / Invalid Paths)

A non-dismissable modal dialog sequence. Reappears whenever persisted paths become invalid.

**Step 1 — Game Installation Path**
- Calls `detect_game_installations()` (source: `path-detection.md`).
- If found: pre-fills path with a green checkmark. Displays detected DLCs (Crimson Court, Shieldbreaker, Color of Madness, Musketeer) as tags.
- If not found: empty field + "Browse..." button (native folder picker via `tauri-plugin-dialog`). On selection, calls `validate_game_directory(path)`.
- Validation: checks for `heroes/`, `campaign/`, `shared/` directories.

**Step 2 — Save File Location**
- Calls `detect_save_locations()` (source: `path-detection.md`).
- Lists discovered profiles with metadata: profile ID, save name, week number, game mode, source (Steam/GOG/Epic/Manual).
- A static amber note warns that Steam Cloud sync can overwrite or conflict with edited saves, and to disable it for the game or close Steam before saving. There is no automatic cloud detection.
- "Browse manually..." as fallback. On selection, calls `validate_save_directory(path)`.

**Step 3 — Confirmation**
- Summary of both paths with DLC tags and profile count.
- "Open Profile" button loads the selected profile and closes the wizard.

Paths are persisted via `tauri-plugin-store` in `app_local_data_dir`. Re-validated on every launch.

### 3.2 Heroes View (Default Landing)

Layout: **master-detail** split using the `Resizable` component (PaneGroup with horizontal Panes and a drag Handle).

```
+--- SIDEBAR ---+----- HERO LIST (left ~40%) ----+---- HERO DETAIL (right ~60%) ----+
|               | [Batch Toolbar]                |                                  |
|               | [Search / Filter / Sort]       | [Portrait]   Name / Class        |
| > Heroes      | +----------------------------+ | Resolve Level / XP               |
|   Estate      | | Portrait | Name   Lv HP St | | HP Bar                           |
|   Town        | | Class    | Status badge     | | Stress Bar                       |
|   Raid        | +----------------------------+ | Quirks (collapsible)             |
|   Settings    | | ...                        | | Skills (collapsible)             |
|               |                                | Equipment (collapsible)          |
|               |                                | Blood Curse (conditional)        |
|               |                                | Actions                          |
+---------------+--------------------------------+----------------------------------+
```

#### 3.2.1 Hero List Panel

A scrollable, virtualized list of all heroes in `persist.roster.json`. Each row is a compact card:

- **Portrait thumbnail** (48x48) — loaded from game assets via `load_game_asset()`. Path: `heroes/<heroClass>/<heroClass>_<variant>/<heroClass>_portrait_roster.png` (variant letter derived from `colour_variation` field: 0=A, 1=B, 2=C, 3=D — assumed mapping, verify during implementation). Falls back to a generic silhouette for unknown/modded classes. Editable fields show a pencil icon on hover to indicate editability.
- **Name** — editable inline on click (pencil icon visible on hover as affordance).
- **Class** — human-readable from localization XML (`hero_class_name_<heroClass>`). Raw ID as tooltip for modded classes. Amber "Mod" micro-badge on unrecognized classes.
- **Resolve level** — numeric + title (e.g., "4 — Champion"). See resolve level table in `save-files.md`.
- **HP** — current/max. Red text if below 50%. Skull icon if status = 3 (DEAD).
- **Stress** — numeric (0-200). Red text if >= 100 (affliction threshold).
- **Status badge** — colored dot + short text label:

| Status Code | Name | Dot Color | Label |
|-------------|------|-----------|-------|
| 0 | AVAILABLE | Green | "Available" |
| 1 | SQUAD | Teal | "In Squad" |
| 2 | STAFFED | Blue | "In Treatment" |
| 3 | DEAD | Red | "Dead" |
| 4 | GONE | Orange | "In Raid" |

All five status codes are mapped (source: `save-files.md` Roster Status Codes).

**List controls:**
- **Sort** — by name, class, level, HP, stress, status. Default: status (DEAD last), then level descending.
- **Filter** — class multi-select dropdown (with class portrait icons), status multi-select.
- **Search** — text field filters by hero name (substring, case-insensitive).
- **Multi-select** — checkboxes on each row. "Select All Visible" toggle in the batch toolbar.
- **Empty state** (when filters match no heroes): "No heroes match your filters." with a "Clear Filters" button.

**Keyboard multi-select:** Space to toggle selection on the focused row. `Ctrl/Cmd+A` to select all visible. `Shift+Up/Down` to extend selection range.

#### 3.2.2 Batch Toolbar

Always visible above the hero list. Buttons become active when one or more heroes are selected.

| Button | Action | Notes |
|--------|--------|-------|
| Heal All | Set `current_hp` to class max for each selected hero's current `armour_rank` | HP-only. Uses the HP table from `game-data.md`. Does NOT touch stress. No confirmation dialog (non-destructive, reversible via Discard). |
| Clear Stress | Set `m_Stress` to 0 for each selected hero | Stress only. Does NOT clear affliction or virtue (these are independent fields). |
| Set Level | Dropdown (0-6). Adjusts `resolveXp` to the threshold value. Offers to match `weapon_rank`/`armour_rank` to the level's max gear rank (`maxGearRank = Math.min(level, 4)` for levels 4-6). Also creates/updates entries in `persist.upgrades.json`. | Sub-confirmation with gear rank details. |
| Revive | Enabled only when ALL selected heroes have status = 3 (DEAD). Runs the full revival procedure (section 4.5). | Multi-hero revival is a batch of individual revival operations. |
| Selection count | "3 of 12 selected" | Informational. |

#### 3.2.3 Hero Detail Panel

Shown when exactly one hero is selected. Empty state: "Select a hero to edit." Multi-selection: batch summary panel replaces detail.

Each section is a collapsible `Card` (shadcn `Collapsible`). Default expansion: Identity and Vitals expanded; others collapsed on first load, remembering user preference via `$effect`.

**Identity Section**
- Large portrait (~128 px, from game assets).
- Hero name — editable `Input` field. Pencil icon visible on hover.
- Class — read-only display with class icon. Raw ID as tooltip for modded.
- Resolve level — `Select` dropdown (0-6) showing level title. Changing level auto-updates `resolveXp` and prompts to match gear ranks (`maxGearRank = Math.min(level, 4)` for levels 4-6). Creates/updates `persist.upgrades.json` entries for skill and gear unlocks.
- **"Reset this hero"** button — reverts all in-memory changes for this specific hero to the on-disk snapshot. Confirmation: "Revert all unsaved changes to [HeroName]?"

**Vitals Section**
- **HP** — `Slider` (0 to class max for current armour_rank) + numeric `Input`. "Heal to Max" quick button. Max HP is derived from the HP table in `game-data.md` and displayed inline (e.g., "26 / 38").
- **Stress** — `Slider` (0-200) + numeric `Input`. "Clear" quick button (sets `m_Stress` to 0). Stress and affliction are independent fields; clearing stress does NOT auto-clear an active affliction or virtue.
- **Affliction / Virtue** — `Select` dropdown: None, or known affliction/virtue IDs from game data. "Clear" button. Clearing zeroes `affliction_type_id`, `affliction_severity`, and `virtue_type_id`. This is a separate control from stress editing.
- **Deaths Door** — `Switch` for `visited_deaths_door`. Shown in an "Advanced" sub-section with tooltip: "Historical flag indicating this hero has previously reached Death's Door. Does not directly affect current gameplay state."

**Quirks Section**
- Two columns: Positive (left) and Negative/Disease (right).
- Each quirk rendered as a `Badge` chip: localized name from `quirks.string_table.xml`, remove button (X), lock toggle icon.
- Locked quirks show a lock icon; clicking toggles `is_locked`.
- Disease quirks shown with a distinct amber background and a small medical cross icon. Diseases and regular negative quirks share the right column but diseases are visually grouped at the top with a "Diseases" sub-header.
- "Add Quirk" button opens a `Combobox` (shadcn `Command` + `Popover`) autocompleted from `quirk_library.json` + DLC quirk libraries + mod quirk files. Grouped by category: Positive, Negative (stat/phobia/dungeon/hatred/compulsion/town), Disease. Unknown/modded IDs can be typed manually.
- Game limit enforced: max 5 positive + 5 negative quirks. **Diseases count toward the 5-negative cap** (they are mechanically quirks in the save file, stored in the same `quirks` object). The "Add" button disables when the column is full. A note below the negative column reads: "Diseases count toward the 5-quirk limit."
- Quirk tooltip shows the quirk's category and stat effects (parsed from quirk_library buff references).

**Skills Section** (collapsed by default)
- **Combat Skills** — grid of toggleable skill slots. Each shows the skill icon (`heroes/<class>/<class>.ability.<slot_word>.png` where slot_word is `one`, `two`, `three`, `four`, `five`, `six`, `seven`) + localized name. Max 4 selected for standard classes, 7 for Abomination (fixed set). Available skills populated from `<class>.info.darkest`.
- **Camping Skills** — same pattern. Icons from `raid/camping/skill_icons/camp_skill_<skillname>.png`.

**Equipment Section** (collapsed by default)
- **Weapon Rank** — `Select` dropdown (0-4), constrained by resolve level max gear rank (`maxGearRank = Math.min(level, 4)`).
- **Armour Rank** — `Select` dropdown (0-4), constrained by resolve level. Changing armour rank updates the displayed max HP.
- Gear icons: `heroes/<class>/icons_equip/eqp_weapon_<rank>.png` and `eqp_armour_<rank>.png` (note: British spelling `armour`).
- **Trinkets** — two trinket slots. Each shows trinket icon (`panels/icons_equip/trinket/inv_trinket+<id>.png`) + localized name. Click to open `TrinketPicker` popover.
  - TrinketPicker shows all trinkets in estate storage (not equipped on other heroes). Search by name. Class-restricted trinkets marked with a class icon. Rarity color border (from `trinkets/*.rarities.trinkets.json`).
  - Equipping a trinket removes it from estate storage; unequipping returns it. Cross-file consistency (roster <-> estate) is maintained automatically.

**Blood Curse Section** (conditional: visible only if the hero has any `disease_vampire_*` quirk AND Crimson Court DLC is installed (`dlc.crimsonCourt` from game installation detection))
- Current state displayed with localized description:
  | Quirk ID | State Name |
  |----------|------------|
  | `disease_vampire_passive` | Sated |
  | `disease_vampire_crave` | Craving |
  | `disease_vampire_wasting` | Wasting |
  | `disease_vampire_blood_lust` | Blood Lust |
- `Select` dropdown to change state (replaces one `disease_vampire_*` quirk with another).
- Info text: "Only one Blood Curse state can be active at a time."

**Actions Section**
- **Revive Hero** — shown only for DEAD heroes (status = 3). Opens the Revival Wizard (section 4.5).
- **Dismiss Hero** — destructive action. Uses the full destructive `AlertDialog` pattern with required checkbox ("I understand this hero will be permanently removed from the roster"). On confirm: deletes the hero entry from `persist.roster.json` (removes the entire hero object from the `heroes` map), increments `dismissed_hero_count` in the roster root, and removes the hero from active party/treatment references if applicable. See cross-file operations table (section 13).

### 3.3 Estate View

Single-pane layout with stacked sections.

```
+--- SIDEBAR ---+------------ MAIN CONTENT ---------------------+
|               |  ESTATE NAME                                   |
|               |  [editable text field]                         |
|               |                                                |
|   Heroes      |  WALLET                                        |
| > Estate      |  [Gold] [Busts] [Portraits] [Deeds] [Crests]  |
|   Town        |  [Shards]*                                     |
|   Raid        |                                                |
|   Settings    |  ESTATE CURRENCIES (CC only)*                  |
|               |  [Invitations A/B/C] [Blood] [Blueprints]      |
|               |                                                |
|               |  TRINKET STORAGE                               |
|               |  [grid of trinket cards] [Add Trinket]         |
+---------------+------------------------------------------------+
* = conditional on DLC
```

**Estate Name**
- Editable `Input` field. The byte-length constraint (source: `save-files.md` Estate Name Constraint) is handled transparently: the DSON encoder updates the binary length field on save. A character counter is displayed ("24 / ~64 bytes") with a soft warning above ~64 bytes (reasonable max for the game's UI display, though the binary format allows more).

**Wallet Section**
- Grid of `CurrencyCard` components, one per type.
- Base currencies (always shown): `gold`, `bust`, `portrait`, `deed`, `crest`.
- **Shard** (`shard`): shown only if Color of Madness DLC is enabled. Source: `design-decisions.md` DLC Safety.
- **Endless Wave Highscore**: read-only display, shown only if Color of Madness DLC is enabled. From `persist.estate.json` `endless_wave_highscore`.
- Each card: currency icon (from game assets, path per `game-assets.md` Currency/Heirloom Icons), name, editable non-negative integer.
- Icons: `panels/icons_equip/gold/inv_gold+_0.png`, `panels/icons_equip/heirloom/inv_heirloom+<type>.png`.
- **Note**: An `inv_heirloom+urn.png` icon exists in the game files. Whether "urn" is an active heirloom currency in gameplay needs verification during implementation. Do not display unless confirmed as a usable currency.

**Estate Currencies Section** (visible only if Crimson Court DLC is enabled)
- Invitation counts: A (Baron), B (Viscount), C (Countess) — labeled numeric fields.
- Blood vials — numeric field. **Important**: Blood uses `type: "estate"`, NOT `"estate_currency"` (source: `game-data.md`). Use explicit ID lookup (`id: "the_blood"`), not type-based filtering.
- Blueprints — numeric field (type `"blueprint"`).

**Trinket Storage Section**
- CSS grid of `TrinketCard` components. Each card:
  - Trinket icon (`panels/icons_equip/trinket/inv_trinket+<id>.png`).
  - Localized trinket name from string tables.
  - Rarity color border.
  - Class restriction icon overlay (if class-restricted).
  - Remove button (X). No confirmation for individual trinket removal.
  - Modded/unknown trinkets: raw ID as name, placeholder icon, no border.
- "Add Trinket" button at bottom — opens `TrinketPicker` combobox.
- "X trinkets equipped on heroes" note with link to Heroes view.
- **Empty state**: when no trinkets are in storage, display: "No trinkets in storage. Trinkets unequipped from heroes or added via the button below will appear here." with the "Add Trinket" button.

### 3.4 Town View

Provides editing for `persist.town.json` and the building-related entries in `persist.upgrades.json`.

```
+--- SIDEBAR ---+------------ MAIN CONTENT -------------------------+
|               |  BUILDINGS                                         |
|   Heroes      |  +------------------+ +------------------+        |
|   Estate      |  | Blacksmith       | | Guild            |        |
| > Town        |  | Upgrades: 3/5    | | Upgrades: 4/5    |        |
|   Raid        |  +------------------+ +------------------+        |
|   Settings    |  +------------------+ +------------------+        |
|               |  | Sanitarium       | | Stage Coach      |        |
|               |  | Slots: [hero A]  | | Upgrades: 2/5    |        |
|               |  |        [hero B]  | |                  |        |
|               |  +------------------+ +------------------+        |
|               |  ... (Abbey, Tavern, Survivalist, Nomad Wagon,    |
|               |       Barracks, Districts*)                        |
+---------------+----------------------------------------------------+
* Districts: only if Color of Madness DLC enabled
```

**Building Cards**
- Each building shown as a card with its name, upgrade progress bar, and details expandable on click.
- Treatment buildings (Sanitarium, Tavern, Abbey) show currently assigned heroes in slots:
  - Hero portrait + name.
  - Activity type (e.g., "Prayer", "Gambling", "Disease Treatment").
  - Visits remaining — editable numeric, shows how many weeks of treatment remain. **Note**: the exact field name for visits remaining is assumed; verify against actual save data during implementation.
  - "Release" button to remove hero from treatment: sets `roster.status` to 0, clears `roster.building_name` to `""`, clears `roster.before_on_start_town_visit_status` to 0, and removes the hero from the town building slot.
- Building names in `persist.upgrades.json` use the `tree_id` pattern `###<building_name>.<upgrade_key>`. Known prefixes: `sanitarium`, `tavern`, `abbey`, `blacksmith`, `guild`, `stage_coach`, `survivalist`, `barracks`, `nomad_wagon`.

**Building Upgrade Editing**
- Each building's upgrade tree shown as a checklist. Each upgrade has:
  - `is_purchased` toggle.
  - `requirement_code` display (ASCII character: `"a"` for building unlock costs, `"0"`-`"2"` for skill/gear upgrade tiers).
- Warning: reverting a lower-tier upgrade while higher ones remain purchased causes visual inconsistency. The editor automatically cascades: toggling off a tier also toggles off all higher tiers in the same tree.

**Activity IDs** (source: `save-files.md`):

| Building | Activities |
|----------|-----------|
| Abbey | `meditation`, `prayer`, `flagellation` |
| Tavern | `bar`, `gambling`, `brothel` |
| Sanitarium | `disease_treatment`, `quirk_treatment` |

### 3.5 Raid View

Only accessible when `persist.raid.json` exists AND `inraid: true` in `persist.game.json`. If conditions are inconsistent (one true, one false), show a warning state instead of the normal raid view: "Raid state is inconsistent. persist.raid.json exists but inraid flag disagrees. Backup recommended before editing." with a "Create Backup Now" button. If neither condition is true: empty state "No active raid. Start a dungeon in-game to see raid data here."

```
+--- SIDEBAR ---+------------ MAIN CONTENT ----------------------------+
|               |  [WARNING BANNER]                                     |
|   Heroes      |                                                       |
|   Estate      |  RAID INFO                                            |
|   Town        |  Dungeon: Weald  Difficulty: Veteran (3)  Length: Med  |
| > Raid        |  Quest Type: Explore  Goal: Kill all enemies           |
|   Settings    |  Torchlight: [========--------] 75.0                   |
|               |  Location: rooA  In Battle: No                         |
|               |                                                       |
|               |  PARTY (left-to-right = slots 1-4)                     |
|               |  [Hero 1] [Hero 2] [Hero 3] [Hero 4]                  |
|               |  (drag to reorder)                                     |
|               |                                                       |
|               |  INVENTORY                                             |
|               |  [Torch x4] [Food x8] [Shovel x2] ...                 |
|               |                                                       |
|               |  RAID PARAMETERS                                       |
|               |  Hunger countdown: 2 rooms  Scout chance: 33%          |
+---------------+-------------------------------------------------------+
```

**Warning Banner** (always visible, not dismissable):
"Editing during a raid is high-risk. Changes must remain consistent across persist.raid.json and persist.roster.json. A backup is strongly recommended." **Inline action button**: "Create Backup Now" (triggers manual backup immediately).

**Raid Info Section** (mostly read-only display):
- Dungeon type: `ruins`, `weald`, `cove`, `warrens`, `darkestdungeon`, `farmstead` (CoM only), `courtyard` (CC only).
- Difficulty (1/3/5 mapped to Apprentice/Veteran/Champion).
- Quest type and goals.
- **Torchlight** — editable `Slider` (0.0-100.0, float). **Important**: torchlight is a Float field in DSON. Always write as a float value (e.g., 75.0), never as an integer (75). The DSON encoder must produce a 4-byte IEEE 754 float.
- Current location (`in_area`), in-battle status.

**Party Section**:
- Four horizontal slots. Each slot: hero portrait, name, class. Clicking a hero navigates to the Heroes view with that hero selected.
- Drag-to-reorder changes the `party.heroes` GUID array order (left-to-right = index 0-3).
- Party GUIDs link to roster heroes.
- **Keyboard reorder**: Space to pick up the focused slot, arrow keys to move position, Space/Enter to confirm placement, Escape to cancel.

**Raid Inventory Section**:
- Grid of item cards with icons, names, editable stack counts (inline numeric input).
- Items sourced from `party.inventory.items`.

**Raid Parameters Section**:
- `hunger_room_buffer` — editable numeric. Rooms until next hunger check.
- `scoutChance_all` — editable float. Base scouting chance. **Note**: both `scoutChance_all` and `scoutModifier_all` exist in the raid file (source: `save-files.md`). Their exact relationship is undefined. Only `scoutChance_all` is exposed for editing; `scoutModifier_all` is preserved as-is on save.

**Abandon Raid** (action button at bottom):
- Deletes `persist.raid.json`, sets `inraid: false` in `persist.game.json`.
- Confirmation dialog: "Abandon the current raid? Heroes will return to the Hamlet with their pre-dungeon state. All in-dungeon loot, XP, and quirks earned this run will be lost."
- Source: `save-files.md` "Abandoning a Raid via File Deletion."

### 3.6 Settings View

Sectioned form layout.

**Paths Section**
- Game installation path — `Input` + "Browse..." + "Re-detect". Validation indicator (green check / red X with message).
- Save file location — `Input` + "Browse..." + "Re-detect". Validation indicator.
- Current profile — `Select` dropdown of discovered profiles.

**Backup Section**
- Auto-backup toggle (`Switch`). Off by default. When enabled, creates a backup before every save operation.
- Backup location display (read-only, OS-conventional path from `app_local_data_dir()`):
  - Windows: `%LOCALAPPDATA%\hamlet-editor\backups\`
  - macOS: `~/Library/Application Support/hamlet-editor/backups/`
  - Linux: `~/.local/share/hamlet-editor/backups/`
- "Open Backup Folder" button (system file manager).
- "Restore from Game Backup" button — reads from the game's own `profile_#/backup/` directory.
- Recent backup list with timestamps, profile identifiers, and "Restore" buttons.

**Display Section**
- Dark/light mode toggle.
- Sidebar default state (expanded/collapsed).

**About Section**
- App version.
- Red Hook legal disclaimer (required).
- Links: GitHub repo, issue tracker.

---

## 4. User Flows

### 4.1 First Launch

1. App opens. No saved config found.
2. Setup Wizard modal appears (non-dismissable).
3. Step 1: `detect_game_installations()` runs. If found, path is pre-filled with DLC tags. User accepts or overrides.
4. Step 2: `detect_save_locations()` runs. Profiles listed with metadata. User selects one. The static Steam Cloud note is always shown.
5. Step 3: Summary. "Open Profile" loads data and closes wizard.
6. LoadingScreen is shown during profile load with status text ("Decoding save files...", "Loading game data...", "Scanning mods...").
7. Heroes view renders with the roster populated.

### 4.2 Returning User — Profile Open

1. App opens. Persisted paths re-validated.
2. Last-used profile loaded automatically with LoadingScreen overlay.
3. If `is_game_running()` returns true: red "DD Running — Save Blocked" badge. Save button disabled. All fields remain viewable. Toast: "Save is disabled while Darkest Dungeon is running."
4. If `persist.raid.json` exists AND `inraid: true`: Raid nav item appears, amber "Raid Active" badge shown.
5. If modded content detected in the roster: amber "Modded Content" badge shown.
6. Heroes view loads as default.

### 4.3 Editing a Hero

1. User clicks a hero in the list. Detail panel populates.
2. **Editing HP**: Click the HP number or use the slider. "Heal to Max" snaps to class max for current armour_rank (from HP table in `game-data.md`). Unsaved changes dot appears.
3. **Editing stress**: Adjust the slider or click "Clear." Stress is set to 0. Affliction/virtue state is NOT affected (they are independent fields).
4. **Editing level**: Open the resolve level dropdown, select "4 — Champion." Sub-dialog: "Set weapon rank to 4 and armour rank to 4 to match? (Current: 2/2). Note: gear rank caps at 4 for levels 4-6." Accepting also creates the appropriate entries in `persist.upgrades.json` for skill and gear unlocks at that level.
5. **Adding a quirk**: Click "Add Quirk" under the positive column. Combobox opens. Type "quick" — autocomplete shows "Quick Reflexes (quick_reflexes)." Select it. Chip appears. If the column already has 5 quirks, the button is disabled.
6. **Locking a quirk**: Click the lock/unlock icon on a quirk chip. Toggles `is_locked`.
7. **Equipping a trinket**: Click an empty trinket slot. TrinketPicker opens showing estate storage trinkets. Search, select. Trinket moves from estate to hero (both roster and estate updated in memory).
8. **Save**: Click Save (or `Ctrl/Cmd+S`). Pre-save validation runs. If auto-backup is on, backup is created. Files written. Round-trip validation runs. Toast: "Saved successfully."

### 4.4 Batch Operations

1. User checks checkboxes on multiple heroes.
2. Batch toolbar updates: "5 of 12 selected."
3. Detail panel replaced with batch summary (selected hero names/portraits, available actions).
4. User clicks "Heal All." All selected heroes have HP set to their respective class maximums. No confirmation dialog (non-destructive; reversible via Discard).
5. Changes applied in memory. List reflects changes. Unsaved changes dot activates.
6. User clicks Save.

### 4.5 Reviving a Dead Hero

The full revival is a multi-file operation (source: `community-research.md` and `save-files.md`):

1. User selects a DEAD hero. Clicks "Revive Hero" in the Actions section.
2. **Revival Wizard Dialog** appears:
   - Title: "Revive [HeroName] the [ClassName]?"
   - Explanation of what will be modified:
     - `persist.roster.json`: Set `roster.status` to 0, `roster.before_on_start_town_visit_status` to 0, `current_hp` to 1, `m_Stress` to 0.
     - `persist.campaign_log.json`: Clear `died` flag in the MissionEvent entry for this hero's GUID.
     - `persist.progression.json`: Clear graveyard achievement flag if present.
   - If raid is active: additional line: "Raid is active. The hero can optionally be added back to the raid party if party size is below 4 and the hero was previously a member." Offer a checkbox: "Add hero back to raid party" (disabled if party already has 4 members).
   - Warning: "The revived hero will retain their resolve level and quirks but will have lost their equipped trinkets (stripped on death). You can re-equip trinkets afterward."
   - Required checkbox: "I understand this is a multi-file operation."
   - "Revive" (primary) and "Cancel" buttons.
3. On confirm: all files updated in memory. Hero reappears with status 0, HP 1, stress 0.
4. User can then heal/equip/save.

### 4.6 Estate Editing

1. User clicks "Estate" in sidebar.
2. **Editing gold**: Click the gold number. Type new value. Enter to confirm. Non-negative integer enforced.
3. **Renaming estate**: Edit the estate name field. The byte-length constraint is handled automatically on encode. A character counter provides soft guidance.
4. **Adding a trinket**: Click "Add Trinket." TrinketPicker opens. Search and select.
5. **Removing a trinket**: Click X on a trinket card. Immediate removal, no confirmation (non-destructive; the trinket simply leaves storage).
6. Save.

### 4.7 Mid-Raid Editing

1. User navigates to Raid view. Warning banner is prominent with "Create Backup Now" inline button.
2. User adjusts torchlight slider to 100.0 (float value).
3. User clicks a party hero, navigates to Heroes view. Edits HP.
4. The editor tracks that both `persist.raid.json` and `persist.roster.json` need updating. For mid-raid HP edits, both files are written on Save (source: `save-files.md` Mid-Dungeon Edit Requirement).
5. User clicks Save. Pre-save validation checks cross-file consistency (hero GUIDs in raid match roster, etc.).

### 4.8 Mod Content Handling

1. On profile load, the editor scans mod directories (`mods/` and Steam Workshop `steamapps/workshop/content/262060/`) for `project.xml` files and additional class/trinket/quirk definitions (source: `game-assets.md` Mod Assets).
2. Unknown hero class IDs: generic silhouette portrait, raw ID displayed with amber "Mod" badge. All editing operations work normally.
3. Unknown trinket IDs: placeholder icon, raw ID displayed. Equip/unequip works.
4. Unknown quirk IDs: raw ID in the chip. Manual entry in the combobox works for any string.
5. If a modded class is detected in the roster, a tooltip on the "Modded Content" header badge warns: "Heroes from mods detected. Removing the mod while these heroes exist in the save will permanently break the save."

---

## 5. Component Architecture

### 5.1 Shell Components

```
App
├── SetupWizard (Dialog, non-dismissable)
│   ├── GamePathStep
│   ├── SavePathStep
│   └── ConfirmationStep
├── LoadingScreen (full-screen overlay with status text, shown during profile load/switch)
├── AppSidebar (Sidebar)
│   ├── AppLogo
│   ├── ProfileSelector (Select)
│   ├── NavItems (SidebarMenu)
│   │   ├── NavItem: Heroes
│   │   ├── NavItem: Estate
│   │   ├── NavItem: Town
│   │   ├── NavItem: Raid (conditional: raid active)
│   │   └── NavItem: Settings
│   └── SidebarFooter
│       ├── BackupStatusIndicator
│       ├── ModeToggle (dark/light)
│       └── AboutLink
├── HeaderBar
│   ├── ViewTitle
│   ├── GlobalSearchTrigger
│   ├── StatusBadges
│   │   ├── GameRunningBadge (Badge variant=destructive)
│   │   ├── RaidActiveBadge (Badge variant=outline, custom amber styling)
│   │   ├── ModContentBadge (Badge variant=outline, custom amber styling)
│   │   └── UnsavedChangesDot
│   └── ActionButtons
│       ├── SaveButton (Button)
│       ├── DiscardButton (Button variant=outline)
│       └── BackupButton (Button variant=outline)
├── CommandPalette (Command, global overlay)
└── MainContent (SvelteKit router outlet)
```

### 5.2 Heroes View Components

```
HeroesView
├── HeroBatchToolbar
│   ├── SelectAllCheckbox (Checkbox)
│   ├── SelectionCount
│   ├── HealAllButton (Button)
│   ├── ClearStressButton (Button)
│   ├── SetLevelSelect (Select)
│   └── ReviveButton (Button, conditional)
├── HeroListHeader
│   ├── SortSelect (Select)
│   ├── ClassFilter (multi-select Popover + Checkbox group)
│   ├── StatusFilter (multi-select)
│   └── SearchInput (Input)
├── HeroList (virtualized scroll)
│   ├── HeroListItem[] (Card compact)
│   │   ├── SelectCheckbox (Checkbox)
│   │   ├── GameAssetImage (portrait thumbnail)
│   │   ├── HeroName (with pencil icon on hover)
│   │   ├── HeroClassLabel
│   │   ├── ResolveLevelBadge
│   │   ├── HPIndicator (HPBar mini)
│   │   ├── StressIndicator
│   │   └── StatusBadge
│   └── HeroListEmptyState (EmptyState: "No heroes match your filters" + ClearFiltersButton)
├── HeroDetail (shown on single selection)
│   ├── ResetHeroButton (Button variant=outline, reverts hero to on-disk snapshot)
│   ├── HeroIdentity (Card)
│   │   ├── GameAssetImage (large portrait)
│   │   ├── EditableName (Input, pencil icon on hover)
│   │   ├── ClassDisplay
│   │   └── ResolveLevelEditor (Select)
│   ├── HeroVitals (Collapsible Card)
│   │   ├── HPEditor (Slider + Input + HealToMaxButton)
│   │   ├── StressEditor (Slider + Input + ClearButton)
│   │   ├── AfflictionEditor (Select + ClearButton)
│   │   └── DeathsDoorSwitch (Switch, in Advanced sub-section with Tooltip)
│   ├── HeroQuirks (Collapsible Card)
│   │   ├── QuirkColumn (positive)
│   │   │   └── QuirkChip[] (Badge + lock toggle + remove)
│   │   ├── QuirkColumn (negative + disease)
│   │   │   ├── DiseaseSubgroup
│   │   │   │   └── QuirkChip[] (amber variant)
│   │   │   └── NegativeSubgroup
│   │   │       └── QuirkChip[]
│   │   ├── QuirkLimitNote ("Diseases count toward the 5-quirk limit")
│   │   └── AddQuirkButton -> QuirkPicker (Combobox)
│   ├── HeroSkills (Collapsible Card, collapsed default)
│   │   ├── CombatSkillGrid
│   │   │   └── SkillSlot[] (toggle + GameAssetImage + label)
│   │   └── CampingSkillGrid
│   │       └── SkillSlot[]
│   ├── HeroEquipment (Collapsible Card, collapsed default)
│   │   ├── WeaponRankSelect (Select, constrained)
│   │   ├── ArmourRankSelect (Select, constrained)
│   │   └── TrinketSlots
│   │       ├── TrinketSlot -> TrinketPicker (Combobox popover)
│   │       └── TrinketSlot
│   ├── BloodCurseSection (Collapsible Card, conditional)
│   │   ├── CurseStateDisplay
│   │   └── CurseStateSelect (Select)
│   └── HeroActions
│       ├── ReviveButton (conditional: status=3)
│       └── DismissButton (Button variant=destructive)
└── BatchSummaryPanel (replaces HeroDetail on multi-select)
    ├── SelectedHeroList (portraits + names)
    └── BatchActionButtons
```

### 5.3 Estate View Components

```
EstateView
├── EstateNameEditor (Input + byte counter)
├── WalletSection (Card)
│   └── CurrencyCard[] (repeated)
│       ├── GameAssetImage (currency icon)
│       ├── CurrencyLabel
│       └── InlineEditNumber
├── EstateCurrenciesSection (Card, conditional: CC DLC)
│   ├── InvitationField (A/B/C) — InlineEditNumber
│   ├── BloodField — InlineEditNumber
│   └── BlueprintField — InlineEditNumber
├── ShardWalletCard (conditional: CoM DLC, part of WalletSection)
└── TrinketStorageSection (Card)
    ├── TrinketGrid (CSS grid)
    │   └── TrinketCard[]
    │       ├── GameAssetImage (trinket icon)
    │       ├── TrinketName
    │       ├── RarityBorder
    │       ├── ClassRestrictionIcon
    │       └── RemoveButton
    ├── TrinketStorageEmptyState (EmptyState: "No trinkets in storage")
    ├── AddTrinketButton -> TrinketPicker (Combobox)
    └── EquippedTrinketsNote
```

### 5.4 Town View Components

```
TownView
├── BuildingGrid (CSS grid)
│   └── BuildingCard[] (Collapsible Card)
│       ├── BuildingName
│       ├── UpgradeProgressBar (Progress component)
│       ├── UpgradeTree (expanded)
│       │   └── UpgradeItem[] (Switch + label + requirement_code)
│       └── TreatmentSlots (conditional: Sanitarium/Tavern/Abbey)
│           └── TreatmentSlotCard[]
│               ├── HeroPortrait (GameAssetImage)
│               ├── HeroName
│               ├── ActivityType
│               ├── VisitsRemaining (InlineEditNumber)
│               └── ReleaseButton
└── DistrictsSection (conditional: CoM DLC — `dlc.colorOfMadness`)
    └── DistrictCard[]
```

### 5.5 Raid View Components

```
RaidView
├── RaidWarningBanner (Alert variant=destructive, non-dismissable, custom amber styling)
│   └── CreateBackupButton (inline Button)
├── RaidInfoSection (Card)
│   ├── DungeonTypeDisplay
│   ├── DifficultyDisplay
│   ├── QuestTypeDisplay
│   ├── QuestGoalDisplay
│   ├── TorchlightSlider (Slider, 0.0-100.0, float)
│   ├── LocationDisplay
│   └── InBattleDisplay
├── PartySection (Card)
│   └── PartySlot[] (drag-sortable via svelte-dnd-action, x4)
│       ├── GameAssetImage (portrait)
│       ├── HeroName (clickable -> navigates to Heroes)
│       └── HeroClass
├── RaidInventorySection (Card)
│   └── InventoryItemCard[]
│       ├── GameAssetImage (item icon)
│       ├── ItemName
│       └── StackCountEditor (InlineEditNumber)
├── RaidParametersSection (Card)
│   ├── HungerCountdown (InlineEditNumber)
│   └── ScoutChance (InlineEditNumber, float)
└── AbandonRaidButton (Button variant=destructive)
```

### 5.6 Shared / Reusable Components

| Component | shadcn Base | Purpose |
|-----------|------------|---------|
| `TrinketPicker` | `Combobox` (Command + Popover) | Search trinkets by name/ID, shows icon + rarity + class restriction |
| `QuirkPicker` | `Combobox` (Command + Popover) | Search quirks, grouped by category (positive/negative/disease) |
| `GameAssetImage` | Custom | Loads PNG from game installation via `load_game_asset()`. Shows placeholder silhouette on failure. Caches loaded assets in memory (LRU). |
| `ConfirmDialog` | `AlertDialog` | Standardized confirmation modal. Cancel always left/default. Destructive operations require checkbox. |
| `InlineEditNumber` | `Input` (type=number) | Click-to-edit numeric field. Range validation. Min/max display. |
| `InlineEditText` | `Input` | Click-to-edit text field. Pencil icon on hover as editability affordance. |
| `StatusBadge` | `Badge` | Colored dot + text label for hero status (all 5 codes). |
| `HPBar` | Custom | Visual HP bar. Green > 50%, yellow 25-50%, red < 25%. Shows current/max as text. |
| `StressBar` | Custom | Visual stress bar (0-200). Normal < 100, red >= 100 (affliction zone). |
| `EmptyState` | Custom | Friendly placeholder for empty views/sections. |
| `CommandPalette` | `Command` (dialog variant) | Global search. See section 6.7. |
| `LoadingScreen` | Custom (overlay + Skeleton) | Full-screen loading overlay with status text. Used during profile load and profile switch. |
| `KeyboardShortcutHint` | Custom (styled `<kbd>`) | Keyboard shortcut display for Command Palette and tooltips. Custom component since `Kbd` is not a standard shadcn-svelte component. |

### 5.7 shadcn-svelte Component Mapping Summary

| UI Pattern | shadcn Component |
|-----------|-----------------|
| Sidebar navigation | `Sidebar`, `SidebarMenu`, `SidebarMenuItem`, `SidebarFooter` |
| Profile selector | `Select` |
| Hero list items | `Card` (compact) |
| Collapsible detail sections | `Collapsible` wrapping `Card` |
| Batch toolbar | Custom bar with `Button Group` / `Button` |
| Inline numeric edit | `Input` (type=number) |
| Dropdowns (level, rank, affliction) | `Select` |
| Quirk/trinket autocomplete | `Combobox` (`Command` + `Popover`) |
| Quirk chips | `Badge` with close button |
| Trinket cards | `Card` |
| Confirmation dialogs | `AlertDialog` |
| Toast notifications | `Sonner` |
| Sliders (HP, stress, torchlight) | `Slider` |
| Status badges | `Badge` (variant: destructive/secondary/outline/default + custom amber class for warnings) |
| Setup wizard | `Dialog` (modal) |
| Settings form | Form layout with `Input`, `Switch`, `Button`, `Field`, `Label` |
| Tooltips | `Tooltip` |
| Party reorder | `svelte-dnd-action` (third-party library). **Note**: `svelte-dnd-action` has known compatibility issues with Svelte 5; evaluate alternatives (e.g., native HTML drag-and-drop, or `@dnd-kit` if a Svelte wrapper becomes available) during implementation. |
| Dark/light toggle | `ModeWatcher` + `Button` (sun/moon Phosphor icon) |
| Global search | `Command` (dialog mode via `Command.Dialog`) |
| Switches (boolean toggles) | `Switch` |
| Master-detail split (Heroes) | `Resizable` (PaneGroup + Pane + Handle) for adjustable hero list / detail split |
| Scrollable hero list | `Scroll Area` wrapping virtualized list |
| Building upgrade progress | `Progress` bar |
| Loading states | `Skeleton` placeholders for async content; custom `LoadingScreen` overlay for profile load |
| Section dividers | `Separator` |
| Keyboard shortcut display | Custom `KeyboardShortcutHint` component (styled `<kbd>` element) |

---

## 6. Interaction Patterns

### 6.1 Inline Editing

The primary edit pattern. Click to enter edit mode, type, press Enter to confirm or Escape to cancel. Editable fields show a pencil icon on hover as a discoverability affordance.

- **Numeric fields** (HP, stress, gold, etc.): Click the displayed number. It becomes a focused `Input`. Validation on blur/Enter: range constraints, integer or float as appropriate. Invalid input reverts.
- **Text fields** (hero name, estate name): Click to enter edit mode (pencil icon visible on hover). Enter confirms, Escape cancels.
- **Dropdowns** (level, weapon rank, affliction): Click to open, select, auto-closes.

Rationale: Power users make many small edits. Modal dialogs per field would be exhaustingly slow.

### 6.2 Explicit Save

Changes accumulate in memory. The user explicitly triggers a save.

- **Why not auto-save**: Save file editing is inherently risky. The user may want to experiment, make several related changes (heal + equip + level), and save atomically. Auto-save removes the ability to discard.
- Unsaved changes are indicated by an orange dot on the Save button and an orange dot in the sidebar next to the app icon. (Orange is used consistently as the unsaved-changes indicator color.)
- Closing the app with unsaved changes triggers: "You have unsaved changes. Save before closing?" with "Save and Close", "Discard and Close", "Cancel."

### 6.3 Batch Operations

1. Select multiple heroes via checkboxes.
2. Detail panel becomes a batch summary.
3. Click a batch action.
4. For destructive operations (Revive, Dismiss): confirmation dialog. For non-destructive operations (Heal All, Clear Stress): immediate application, no confirmation.
5. Changes applied in memory. Save button activates.

### 6.4 Undo / Discard

No granular per-field undo. Instead:

- **Reset this hero** — per-entity revert on the detail panel. Reverts a single hero to its on-disk snapshot.
- **Discard All Changes** — `Ctrl/Cmd+Shift+Z` or the Discard button. Reloads all data from disk. Confirmation dialog first. Note: `Ctrl/Cmd+Z` is deliberately not used for discard because it conflicts with standard undo conventions in text inputs.
- **Backups** — coarser recovery. Restoring a backup replaces all save files.

### 6.5 Confirmation Dialog Pattern

All confirmations use `AlertDialog`:

```
+-------------------------------------------+
|  [Icon]  Title                            |
|                                           |
|  Description of what will happen and      |
|  any associated risks.                    |
|                                           |
|  [ ] Required checkbox (destructive only) |
|                                           |
|              [Cancel]  [Confirm]          |
+-------------------------------------------+
```

- Cancel is leftmost (safe default).
- Confirm styled `destructive` (red) for dangerous operations, `default` for normal.
- Destructive confirmations require the checkbox to enable Confirm.

### 6.6 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save all changes |
| `Ctrl/Cmd + Shift + Z` | Discard all unsaved changes (with confirmation) |
| `Ctrl/Cmd + B` | Create manual backup |
| `Ctrl/Cmd + K` | Open Command Palette / global search |
| `Ctrl/Cmd + F` | Also opens Command Palette (alias for users who expect "Find"). **Note**: Tauri 2 WebView may intercept `Ctrl+F` for native find before the app receives it. The Tauri window config should disable or override the native find behavior (e.g., via `webview.devtools(false)` or custom key event interception on the Rust side) to ensure this shortcut works. |
| `Escape` | Cancel inline edit / close popover / deselect / close dialog |
| `Up/Down` | Navigate hero list |
| `Enter` | Open selected hero detail / confirm inline edit |
| `Tab` | Move to next editable field |
| `Ctrl/Cmd + H` | Heroes view |
| `Ctrl/Cmd + E` | Estate view |
| `Ctrl/Cmd + T` | Town view |
| `Ctrl/Cmd + D` | Raid (Dungeon) view (if visible). Note: `Ctrl+R` avoided — conflicts with WebView page reload. |
| `Ctrl/Cmd + ,` | Settings |
| `Space` | Toggle checkbox / pick up drag item |
| `Ctrl/Cmd + A` | Select all visible heroes (when hero list focused) |
| `Shift + Up/Down` | Extend hero selection range |

### 6.7 Command Palette (Global Search)

Triggered by `Ctrl/Cmd+K` or the search icon in the header. Uses shadcn `Command` in dialog mode (`Command.Dialog`).

Search targets:
- Hero names (navigates to hero in Heroes view).
- Trinket names/IDs (navigates to Estate trinket storage or hero equipment).
- Quirk names/IDs (navigates to hero with that quirk).
- Building names (navigates to Town view).
- Action names: "Heal All", "Create Backup", "Save", "Discard Changes."

Results are grouped by category. Selecting a result navigates to the relevant view and highlights/selects the target entity.

This addresses the "Critical" priority item from `community-research.md`: in-editor search / Ctrl+F across all files.

---

## 7. State Management

### 7.1 Architecture Overview

Central store using Svelte 5 runes. The store holds all parsed save data and derived state.

```
saveStore ($state)
├── profile: ProfileMeta
├── game: GameData                    // persist.game.json parsed
├── roster: Map<number, Hero>         // persist.roster.json, keyed by GUID
├── estate: EstateData                // persist.estate.json parsed
├── town: TownData                    // persist.town.json parsed
├── upgrades: UpgradeData             // persist.upgrades.json parsed
├── campaignLog: CampaignLogData      // persist.campaign_log.json parsed
├── progression: ProgressionData      // persist.progression.json parsed
├── raid: RaidData | null             // persist.raid.json (null if no raid)
├── noveltyTracker: unknown | null    // novelty_tracker.json (opaque read-passthrough blob; preserved on save, not edited)
├── dirty: boolean ($derived)         // true if any file has in-memory changes
├── dirtyFiles: Set<string> ($derived)// which files have changes
├── diskSnapshot: ProfileSnapshot     // deep clone of all data at last save/load, used for per-entity revert
└── dlc: DLCFlags ($derived)          // derived from GameInstall directory detection (primary) + game.presented_dlc (secondary)

gameDataStore ($state)
├── classes: Map<string, ClassDef>    // from .info.darkest files
├── quirks: Map<string, QuirkDef>     // from quirk_library.json + DLC
├── trinkets: Map<string, TrinketDef> // from *.entries.trinkets.json + DLC
├── localization: Map<string, string> // from *.string_table.xml
├── nameHashTable: Map<number, string>// hash-to-name for display
├── hpTable: Map<string, number[]>    // class -> [rank0..rank4] max HP
└── mods: ModInfo[]                   // detected mod metadata

uiStore ($state)
├── selectedHeroIds: Set<number>
├── activeView: string
├── sidebarExpanded: boolean
├── sectionCollapseState: Map<string, boolean>
└── searchQuery: string
```

### 7.2 Svelte 5 Runes Usage

- **`$state`** — all store properties. Provides fine-grained reactivity.
- **`$derived`** — computed values: `dirty` flag (compares in-memory state to last-saved snapshot), DLC flags (derived from `GameInstall` directory detection as primary source), max HP for a hero (derived from class + armour_rank), hero resolve level name (derived from `resolveXp` vs thresholds).
- **`$effect`** — side effects: persist UI preferences (sidebar state, section collapse) to `tauri-plugin-store`; poll `is_game_running()` on a timer; update `dirtyFiles` when store changes.

### 7.3 Game Asset Loading and Caching

- All game assets loaded via `load_game_asset(relative_path)` Tauri command.
- The Rust backend resolves the path relative to the validated game installation root.
- Frontend caches loaded assets in a Map keyed by relative path (LRU eviction at ~200 entries to bound memory).
- `GameAssetImage` component handles loading states: `Skeleton` shimmer placeholder while loading, silhouette fallback on error.

### 7.4 Name Hash Table

The Rust backend scans 15 file patterns from the game installation (and mod directories) to build a hash-to-name lookup table (~3,273 names for base game). This table is:
- Built once on profile load via `load_game_data("name_hash_table")`.
- Cached to a flat text file in `app_local_data_dir` so re-scanning is not needed every launch (invalidated when game installation path changes).
- Used by the frontend to display human-readable field names in any raw/advanced views.

Source: `ddsavelib-refactor.md` Name Hash Generation.

### 7.5 DLC Flag Derivation

DLC detection uses a two-layer approach:

**Primary: Game installation directory detection** (from `GameInstall` struct in `path-detection.md`):
```typescript
// GameInstall already has these booleans from directory probing:
// has_crimson_court:     dlc/580100_crimson_court/ exists
// has_color_of_madness:  dlc/735730_color_of_madness/ exists
// has_shieldbreaker:     dlc/702540_shieldbreaker/ exists
// has_musketeer:         dlc/445700_musketeer/ exists
```

**Secondary/informational: Save file flags** from `persist.game.json` (`presented_dlc`, `dlc_init`). The exact structure of `presented_dlc` is not fully confirmed; it may be an object with DLC app ID keys. These are used as secondary confirmation only — the installation directory check is authoritative for whether DLC content is available to display.

```typescript
const dlc = $derived({
  crimsonCourt: gameInstall.has_crimson_court,
  colorOfMadness: gameInstall.has_color_of_madness,
  shieldbreaker: gameInstall.has_shieldbreaker,
  musketeer: gameInstall.has_musketeer,
});
```

These flags gate all DLC-conditional UI:
- Shard wallet card: `dlc.colorOfMadness`
- Estate currencies section: `dlc.crimsonCourt`
- Blood Curse hero section: `dlc.crimsonCourt` AND hero has `disease_vampire_*` quirk
- Farmstead dungeon type in raid: `dlc.colorOfMadness`
- Courtyard dungeon type in raid: `dlc.crimsonCourt`
- Districts in Town view: `dlc.colorOfMadness` (Districts are a Color of Madness feature, NOT Crimson Court)
- Flagellant class recognition: `dlc.crimsonCourt`
- Shieldbreaker class recognition: `dlc.shieldbreaker`

---

## 8. Responsive Layout

Desktop-only (Tauri) but window sizes vary significantly.

### 8.1 Minimum Window Size

Enforced via Tauri window config: **800 x 600**. The app does not resize below this.

### 8.2 Breakpoints

| Window Width | Sidebar | Hero List | Hero Detail | Behavior |
|-------------|---------|-----------|-------------|----------|
| 800-959 px | Collapsed (icon-only, 48 px) | Full width | Overlays as slide-over panel | Detail slides over list. Back button returns to list. |
| 960-1279 px | Collapsed (icon-only, 48 px) | ~40% | ~60% | Side-by-side, compact. |
| 1280-2559 px | Expanded (240 px) | ~35% | ~65% | Full layout. |
| 2560 px+ | Expanded (240 px) | ~30% | ~70% | Extra-spacious. Content max-width capped at 1800 px to prevent excessive line lengths. |

### 8.3 Adaptation Behaviors

- **Sidebar**: auto-collapses below 1280 px. Manual toggle (hamburger icon) available at any width.
- **Hero list density**: at narrow widths, items become compact (portrait + name + level only; HP/stress as tiny bars).
- **Detail panel**: always scrollable. At narrow widths, Skills and Equipment sections start collapsed.
- **Estate wallet**: currency cards reflow from 3x2 grid to 2x3 to single column.
- **Trinket grid**: reflows naturally via CSS grid `auto-fill`.
- **Town building grid**: reflows similarly.

---

## 9. Error States & Safety

### 9.1 Severity Tiers

**Blocking (Red) — prevent proceeding:**

| Condition | Location | Message | Actions |
|-----------|----------|---------|---------|
| Game is running | Header badge + overlay on Save button | "Darkest Dungeon is running. Close the game before saving." | Save disabled. View/edit still allowed. |
| Save file corrupt | Full-view error replacing content | "Failed to load [filename]: [error]. Try restoring from a backup." | "Restore from Backup", "Restore from Game Backup", "Retry" |
| Round-trip validation failure | Modal after Save attempt | "Validation failed. Changes NOT written. [details]" | "Copy Error Details", "Restore from Backup", "OK" |
| Invalid paths | Settings path fields | "Not a valid DD installation" or "Required files missing" | Re-detect / Browse |
| `is_game_running` polling failure | Header badge area | "Unable to detect game status. Save is blocked as a precaution." | Save disabled (fail-safe: treat as "game may be running"). "Retry Detection" button. |

**Warning (Amber) — inform of risk:**

| Condition | Location | Message |
|-----------|----------|---------|
| Mid-raid editing | Raid view banner (non-dismissable) | "Raid editing is high-risk. Backup recommended." + "Create Backup Now" button |
| Unsaved changes on exit | Modal | "Save before closing?" with Save/Discard/Cancel |
| Level/gear mismatch | Hero detail inline | "Weapon rank (2) below max for this level (4). Update?" |
| Modded content | Header badge + per-item amber outline | "Unknown ID: [raw_id]. May be from a mod." |
| DLC irreversibility | Any DLC-related edit if DLC was recently enabled | "DLC enable is irreversible in the save." |
| Raid state inconsistency | Raid nav item + Raid view | "persist.raid.json and inraid flag are inconsistent." |

**Informational (Muted):**

| Condition | Location | Style |
|-----------|----------|-------|
| Empty states | Any empty view/section | Friendly placeholder text |
| Derived value explanations | Tooltips on computed fields | E.g., "Base HP (22) + Armour Rank 3 bonus = 34" |
| Success feedback | Toast (Sonner) | "Saved successfully", "Backup created", "Hero revived" |

### 9.2 Save File Corruption Recovery

When the editor encounters a corrupt file (source: `save-files.md` Save Corruption Recovery):

1. Display the corruption error with the file name and error type.
2. Offer recovery options in priority order:
   a. **"Restore from Editor Backup"** — if the editor has a previous backup.
   b. **"Restore from Game Backup"** — reads from `profile_#/backup/` (the game's own session backup).
   c. **"Delete Raid File"** — if the corrupt file is `persist.raid.json`, offer to delete it and set `inraid: false` (escape crash loop).
   d. **"Re-encode File"** — attempt decode-then-re-encode to fix binary structural corruption.
   e. **"Open Backup Folder"** — system file manager.

### 9.3 Validation Strategy

**On-input:**
- Numeric fields reject non-numeric input. Range constraints shown as min/max hints.
- Dropdowns constrained to valid values (e.g., gear rank cannot exceed level's max: `maxGearRank = Math.min(level, 4)`).
- Quirk count enforced (max 5 per column; diseases count toward the negative cap).

**Pre-save (when Save is clicked):**
1. **Cross-file consistency checks:**
   - Trinkets equipped on heroes do not also appear in estate storage.
   - Hero GUIDs in raid party exist in roster.
   - Heroes with status STAFFED (2) have matching `roster.building_name` and are present in `persist.town.json` building slots.
   - Gear ranks do not exceed resolve level's max (`maxGearRank = Math.min(level, 4)` for levels 4-6).
   - `weapon_rank`/`armour_rank` match corresponding entries in `persist.upgrades.json`.
2. **DLC field guards:** Verify no DLC-specific fields (Crimson Curse quirks, shard wallet entry, districts) exist in saves where the corresponding DLC is not enabled.
3. If inconsistencies found: warning dialog listing them, with "Fix Automatically" and "Save Anyway" options.

**Post-save (round-trip validation):**
- After writing binary DSON, immediately re-decode and compare at the JSON/semantic level (not byte-for-byte; bits 1 and 31 in fieldInfo are intentionally stripped).
- Mismatch = abort and show error with a "Restore from Backup" button. Files are not left in a partial write state (write to temp file, then atomic rename).

### 9.4 Graceful Degradation for Mod Content

The app never crashes on unknown IDs. It degrades gracefully:

| Unknown Type | Display | Edit Capability |
|-------------|---------|----------------|
| Hero class | Generic silhouette, raw ID, amber "Mod" badge | Full editing |
| Trinket | Placeholder icon, raw ID | Equip/unequip works |
| Quirk | Raw ID in chip, no tooltip stats | Add/remove works, manual ID entry |
| Dungeon (in raid) | Raw ID | Display only |
| Skill | Raw ID, no icon | Toggle works |

---

## 10. Information Architecture

### 10.1 Primary Data (Always Visible)

| Data | Location | Rationale |
|------|----------|-----------|
| Hero roster | Heroes list | #1 edit target |
| Hero name, class, level, HP, stress, status | Hero list row | At-a-glance triage |
| Hero vitals + quirks + skills + trinkets | Hero detail | The actual edit targets |
| Wallet amounts | Estate view top | Common edit target |
| Trinket storage | Estate view | Common edit target |
| Active raid party | Raid view | Critical mid-raid |

### 10.2 Secondary Data (One Interaction Away)

| Data | Location | Rationale |
|------|----------|-----------|
| Affliction/virtue type | Hero detail, vitals | Only relevant when afflicted |
| Blood curse state | Hero detail, conditional section | Only for cursed heroes |
| Deaths door flag | Hero detail, vitals advanced sub-section | Historical flag, minor |
| Weapon/armour rank | Hero detail, equipment (collapsed) | Usually auto-set with level |
| Camping skills | Hero detail, skills (collapsed) | Less commonly edited |
| Estate currencies | Estate view, currencies section | Niche edits |
| Raid inventory | Raid view | Only mid-raid |
| Town buildings | Town view | Medium priority |

### 10.3 Advanced / Hidden Data

| Data | Access | Rationale |
|------|--------|-----------|
| Raw hero GUID | Tooltip on hero name | Power user only |
| `persist.game.json` fields | Settings (read-only display for game_mode, DLC flags) | Rarely edited |
| Campaign log events | Not in v1 scope (low demand per priority matrix) | Complex, low demand |
| Quest data | Not in v1 scope | Complex, low demand |
| `persist.upgrades.json` internals | Auto-managed; no direct UI | Should not be manually edited |
| Dungeon history per hero | Not shown | Rarely edited |
| `novelty_tracker.json` | Opaque passthrough (preserved on save, not displayed or edited) | Low risk, no editing demand |

### 10.4 Grouping Principles

1. **Group by entity, not by file.** The multi-file reality is hidden.
2. **Show derived values.** Max HP next to current HP. Level title next to numeric XP.
3. **Separate browsing from editing.** Hero list = compact scanning. Hero detail = spacious editing.
4. **Conditional visibility.** Never show what cannot be used. DLC sections, raid view, blood curse: all gated.

---

## 11. SvelteKit Routing

SPA mode (no server routes). All navigation is client-side.

```
src/routes/
├── +layout.svelte          — Shell (sidebar + header bar + main content)
├── +layout.ts              — export const ssr = false; (prerender omitted — SPA fallback handles all routes)
├── +page.svelte            — Redirect to /heroes (or show setup wizard if no config)
├── heroes/
│   └── +page.svelte        — Heroes view (list + detail)
├── estate/
│   └── +page.svelte        — Estate view
├── town/
│   └── +page.svelte        — Town view
├── raid/
│   └── +page.svelte        — Raid view (guard: redirect to /heroes if no raid)
└── settings/
    └── +page.svelte        — Settings view
```

Route guards:
- `/raid` — if no raid data in store, redirect to `/heroes`.
- `/` — if setup not complete, show wizard modal. Otherwise redirect to `/heroes`.

---

## 12. Tauri Command Surface

The frontend never touches the filesystem directly. All I/O goes through Tauri commands.

Command names are authoritative from `path-detection.md` and this document.

### 12.1 Detection & Validation

| Command | Signature | Purpose |
|---------|-----------|---------|
| `detect_save_locations` | `() -> Result<Vec<SaveLocation>, String>` | Auto-detect all save profiles |
| `detect_game_installations` | `() -> Result<Vec<GameInstall>, String>` | Auto-detect game installation paths |
| `validate_save_directory` | `(path: String) -> Result<SaveValidation, String>` | Validate a manually selected save directory |
| `validate_game_directory` | `(path: String) -> Result<GameValidation, String>` | Validate a manually selected game directory |

### 12.2 Profile I/O

| Command | Signature | Purpose |
|---------|-----------|---------|
| `list_profiles` | `(save_root: String) -> Result<Vec<ProfileMeta>, String>` | List profiles with metadata (name, week, game mode, DLCs) |
| `load_profile` | `(profile_path: String) -> Result<ProfileData, String>` | Decode all DSON save files (including `novelty_tracker.json` as opaque blob), return as JSON |
| `save_profile` | `(profile_path: String, data: ProfileData) -> Result<SaveResult, String>` | Encode and write modified files (including `novelty_tracker.json` passthrough) with round-trip validation |

**`ProfileMeta` struct** (returned by `list_profiles`):
```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct ProfileMeta {
    pub profile_id: String,            // "profile_0", "profile_1", etc.
    pub estate_name: Option<String>,   // from persist.game.json `estatename`
    pub game_mode: Option<String>,     // from persist.game.json `game_mode` ("standard", "radiant", "new_game_plus", "bloodmoon")
    pub week_number: Option<u32>,      // from persist.campaign_log.json `total_weeks`
    pub has_active_raid: bool,         // persist.raid.json exists
    pub source: SaveSource,            // Steam, Gog, Epic, Manual
    pub steam_user_id: Option<String>, // if Steam source
}
```

### 12.3 Backups

| Command | Signature | Purpose |
|---------|-----------|---------|
| `create_backup` | `(profile_path: String) -> Result<BackupInfo, String>` | Copy current save to backup directory |
| `restore_backup` | `(backup_path: String, profile_path: String) -> Result<(), String>` | Restore a backup to profile |
| `list_backups` | `(profile_path: String) -> Result<Vec<BackupInfo>, String>` | List editor-created backups |
| `restore_game_backup` | `(profile_path: String) -> Result<(), String>` | Restore from game's own `backup/` subdirectory |

### 12.4 Safety

| Command | Signature | Purpose |
|---------|-----------|---------|
| `is_game_running` | `() -> Result<bool, String>` | Check for DD process (sysinfo crate). If this command fails (returns `Err`), the UI treats it as "game may be running" and blocks save as a fail-safe. |

### 12.5 Game Data

| Command | Signature | Purpose |
|---------|-----------|---------|
| `load_game_asset` | `(relative_path: String) -> Result<Vec<u8>, String>` | Read a PNG from game installation, return as bytes |
| `load_game_data` | `(data_type: String) -> Result<GameRefData, String>` | Parse game reference data (quirks, trinkets, skills, classes, localization, name_hash_table) |
| `scan_mods` | `() -> Result<Vec<ModInfo>, String>` | Scan mods/ and Workshop dirs for mod metadata |

---

## 13. Cross-File Operations Reference

These operations modify multiple save files and require careful coordination. The editor handles all cross-file writes internally.

| Operation | Files Modified | Notes |
|-----------|---------------|-------|
| Equip trinket on hero | roster + estate | Remove from estate storage, add to hero trinket slot |
| Unequip trinket | roster + estate | Reverse of equip |
| Revive hero | roster + campaign_log + progression (+ raid if mid-dungeon) | Full revival procedure; see section 4.5. Sets `m_Stress` to 0 in addition to `roster.status`, `current_hp`, etc. |
| Set hero level | roster + upgrades | Update resolveXp, optionally gear ranks (`maxGearRank = Math.min(level, 4)`), create upgrade entries |
| Release from treatment | roster + town | Clear `roster.building_name`, set `roster.status` to 0, clear `roster.before_on_start_town_visit_status` to 0, remove from town slot |
| Assign to treatment | roster + town | Set status=2, building_name, add to town slot |
| Abandon raid | raid (delete) + game | Delete persist.raid.json, set inraid=false |
| Mid-raid HP edit | roster + raid | Both files store hero HP during raids |
| Dismiss hero | roster (delete hero entry + increment `dismissed_hero_count`) + town (if in treatment) + raid (if in party) | Permanently removes hero from roster. Uses destructive AlertDialog with required checkbox. |
| Rename estate | game | Single file but byte-length constraint: DSON encoder auto-updates string length field |

---

## 14. DLC-Conditional UI Summary

| UI Element | Required DLC | Gate |
|-----------|-------------|------|
| Shard wallet card | Color of Madness | `dlc.colorOfMadness` |
| Estate currencies section (invitations, blood, blueprints) | Crimson Court | `dlc.crimsonCourt` |
| Blood Curse section on hero detail | Crimson Court | `dlc.crimsonCourt` AND hero has `disease_vampire_*` |
| Flagellant class portrait/data | Crimson Court | Detected from game installation `dlc/580100_crimson_court/` |
| Shieldbreaker class portrait/data | Shieldbreaker | Detected from game installation `dlc/702540_shieldbreaker/` |
| Musketeer class portrait/data | Musketeer (free) | Detected from game installation `dlc/445700_musketeer/` |
| Farmstead dungeon type in raid | Color of Madness | `dlc.colorOfMadness` |
| Courtyard dungeon type in raid | Crimson Court | `dlc.crimsonCourt` |
| Districts in Town view | Color of Madness | `dlc.colorOfMadness` |
| Crimson Court quirks in QuirkPicker | Crimson Court | `dlc.crimsonCourt` |
| Color of Madness quirks in QuirkPicker | Color of Madness | `dlc.colorOfMadness` |
| Shard Mercenary quirk display | Color of Madness | `dlc.colorOfMadness` |
| Endless Wave Highscore in Estate view | Color of Madness | `dlc.colorOfMadness` |
| Crimson Court trinkets in TrinketPicker | Crimson Court | `dlc.crimsonCourt` |

**Safety rule**: the editor never injects DLC-specific fields into a save where that DLC is not enabled. Doing so crashes the game. Source: `design-decisions.md`.

---

## 15. Accessibility

- **Color is never the sole indicator.** Every status badge includes a text label. HP/stress bars have numeric values alongside the visual.
- **Contrast.** All text and UI elements meet WCAG AA contrast ratios in both light and dark modes. Amber warning badges in particular must be tested for contrast compliance; use a darker amber shade or outlined variant if needed.
- **Focus management.** Visible focus indicators on all interactive elements. Tab order follows visual layout.
- **Keyboard navigation.** All actions reachable via keyboard (section 6.6). Hero list supports multi-select via Space, Ctrl+A, Shift+arrows. Party reorder supports Space to grab, arrows to move, Space/Enter to drop, Escape to cancel.
- **Screen reader support.** ARIA labels on icon-only buttons (Save, Backup, etc.). Status badges announce their text. Hero list rows have descriptive aria-labels.
- **Reduced motion.** Animations respect `prefers-reduced-motion`.
- **Editable field affordance.** Pencil icon on hover for all editable text/numeric fields so editability is discoverable without relying on double-click conventions.

---

## 16. Legal

Per Red Hook Studios' official modding statement (source: `game-assets.md`):

1. No bundling game assets. All icons, portraits, and data read from user's installation at runtime.
2. Required disclaimer displayed in the About dialog and README.
3. Non-commercial. The editor is free and open source.
4. No consumer confusion. Not presented as an official Red Hook product.
5. No Red Hook trademarks in app branding.
