# Game Assets Reference

Assets are read from the user's Darkest Dungeon installation at runtime. **We do not bundle any game assets.**

## Game Installation Paths

| Platform | Steam Path | GOG Path |
|----------|-----------|----------|
| Windows  | `C:\Program Files (x86)\Steam\steamapps\common\DarkestDungeon\` | `C:\GOG Games\Darkest Dungeon\` |
| macOS    | `~/Library/Application Support/Steam/steamapps/common/DarkestDungeon/_osx/` | N/A |
| Linux    | `~/.local/share/Steam/steamapps/common/DarkestDungeon/` | N/A |

On macOS, game data is inside `Darkest.app/Contents/Resources/data/` (lowercase `data/` subdirectory). The `_osx` directory in the Steam path contains the app bundle. A `_osxnosteam` variant also exists for DRM-free distribution.

## Directory Structure

```
DarkestDungeon/
├── heroes/                     # Hero class data and assets
├── monsters/                   # Monster/enemy data and assets
├── shared/                     # Shared game data (quirks, buffs, trinkets)
├── campaign/                   # Campaign structure, quests, town, dungeons
│   └── provision/              # Provision shop data
├── panels/                     # UI panels, icons, interface assets
├── raid/                       # Raid/dungeon UI and mechanics
├── inventory/                  # Item stack limits, buy/sell costs
├── localization/               # Language files
├── colours.darkest             # Color definitions for text/rarities
├── trinkets/                   # Trinket definitions (NOT under shared/)
├── dlc/
│   ├── 445700_musketeer/       # Musketeer DLC (free, Arbalest reskin)
│   ├── 580100_crimson_court/   # Crimson Court DLC
│   ├── 702540_shieldbreaker/   # Shieldbreaker DLC
│   └── 735730_color_of_madness/ # Color of Madness DLC
├── mods/                       # User-installed mods
├── scripts/                    # Script data, starting saves
└── audio/                      # FMOD audio files
```

## Asset Types for the Editor

### Hero Portraits

- **Path**: `heroes/<classname>/<classname>_A/`
- **Format**: PNG
- **Variants**: 4 color palettes per class (`_A`, `_B`, `_C`, `_D`)
- **Contains**: Roster portrait images used in the game's hero roster view
- **Default display**: Use `_A` variant

### Base Game Hero Class Folders

`abomination`, `antiquarian`, `arbalest`, `bounty_hunter`, `crusader`, `grave_robber`, `hellion`, `highwayman`, `houndmaster`, `jester`, `leper`, `man_at_arms`, `occultist`, `plague_doctor`, `vestal`

### DLC Hero Paths

| Class | DLC | Path |
|-------|-----|------|
| Flagellant | Crimson Court | `dlc/580100_crimson_court/features/flagellant/heroes/flagellant/` (CC uses `features/` intermediate dir) |
| Shieldbreaker | Shieldbreaker | `dlc/702540_shieldbreaker/heroes/shieldbreaker/` |
| Musketeer | Free DLC (445700) | `dlc/445700_musketeer/heroes/musketeer/` (has its own DLC directory) |

### Hero Folder Structure

```
heroes/<classname>/
├── <classname>.info.darkest              # Stats, skills, resistances, weapon/armor data
├── <classname>.art.darkest               # Animation, FX references
├── <classname>.ability.one.png           # Combat skill icon 1
├── <classname>.ability.two.png           # Combat skill icon 2
├── <classname>.ability.three.png         # ... through .ability.seven.png
├── <classname>_guild_header.png          # Guild header image (NOT inside _A/_B)
├── <classname>_A/                        # Color palette variant A
│   └── <classname>_portrait_roster.png   # Roster portrait (exact filename)
├── <classname>_B/                        # Variant B (same portrait naming)
├── <classname>_C/                        # Variant C
├── <classname>_D/                        # Variant D (can go up to _W for mods)
├── anim/                                 # Spine2D animation files
│   ├── <classname>.skel                  # Skeleton (binary, Spine 2.1.27)
│   ├── <classname>.atlas                 # Atlas definition (text)
│   └── <classname>.png                   # Sprite sheet — do NOT rename
├── fx/                                   # Skill visual effects
└── icons_equip/                          # Weapon/armor icons for this class
    ├── eqp_weapon_0.png through eqp_weapon_4.png  # 5 weapon tiers
    └── eqp_armour_0.png through eqp_armour_4.png  # 5 armor tiers (British spelling!)
```

### Trinket Icons

- **Path**: `panels/icons_equip/trinket/`
- **Format**: PNG
- **DLC**: `dlc/580100_crimson_court/.../trinkets/` (Crimson Court set trinkets)

### Equipment Icons

- **Path**: `panels/icons_equip/`
- **Format**: PNG
- Weapon and armor icons for the Blacksmith and character sheets

### Camping Skill Icons

- **Path**: `raid/camping/skill_icons/`
- **Format**: PNG
- **Naming**: `camp_skill_<skillname>.png` (no class prefix — e.g., `camp_skill_bandage.png`, `camp_skill_pep_talk.png`)
- Not in the hero folder — centralized in the raid directory

### Map/Dungeon Icons

- **Path**: `panels/icons_map/`
- **Format**: PNG

### Currency/Heirloom Icons

Verified paths on actual game installation (naming convention: `inv_<type>+<id>.png` with `+` separator):
- **Gold**: `panels/icons_equip/gold/inv_gold+_0.png` through `inv_gold+_3.png`
- **Heirlooms**: `panels/icons_equip/heirloom/inv_heirloom+bust.png`, `inv_heirloom+crest.png`, `inv_heirloom+deed.png`, `inv_heirloom+portrait.png`, `inv_heirloom+urn.png`
- **Gems**: `panels/icons_equip/gem/inv_gem+citrine.png`, `inv_gem+emerald.png`, `inv_gem+jade.png`, `inv_gem+onyx.png`, `inv_gem+ruby.png`, `inv_gem+sapphire.png`, `inv_gem+trapezohedron.png`, etc.

### Trinket Icon Naming

Icons use the `inv_trinket+<id>.png` pattern (note the `+` separator, not `_`):
- `panels/icons_equip/trinket/inv_trinket+ancestors_candle.png`
- `panels/icons_equip/trinket/inv_trinket+focus_ring.png`

### Monster/Boss Assets

- **Path**: `monsters/<monster_name>/<monster_name>_<tier>/`
- Contains `.info.darkest` (stats), `.art.darkest` (animation refs), `anim/` and `fx/` subdirs
- Tiered by difficulty variant

## Asset Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| PNG | `.png` | All images: portraits, icons, sprite sheets, UI elements. Individual files, NOT packed in spritesheets (spritesheets only for Spine animations). |
| Spine Skeleton | `.skel` | Binary animation skeleton (Spine 2.1.27, encrypted) |
| Spine Atlas | `.atlas` | Text file defining sprite sheet regions |
| Darkest Script | `.darkest` | Custom text-based key-value format (see syntax below) |
| JSON | `.json` | Some config files (standard JSON, NOT binary DSON) |
| CSV | `.csv` | Curio data, some map data |
| XML | `.xml` | Localization string tables (see structure below) |
| LOC/LOC2 | `.loc`, `.loc2` | Compiled localization files (`.loc` = older, `.loc2` = post-Butcher's Circus patch) |

### `.darkest` File Syntax

Custom plain-text key-value format used for game data:
```
combat_skill: .id "noxious_blast" .level 0 .type "ranged" .atk +85% .dmg -50%
inventory_item: .type "heirloom" .id "portrait"
hall: .chance 1 .types spider_webber_A spider_webber_A
```

- Each line begins with a **directive token** (e.g., `combat_skill:`, `inventory_item:`)
- Parameters follow as `.key value` or `.key "value"` pairs
- Multi-value parameters take space-separated identifiers
- Files are UTF-8 with Windows line endings (`\r\n`)
- Fully parseable for extracting stat data, skill definitions, item IDs

### Localization XML Structure

```xml
<language id="english">
  <entry id="hero_class_name_bounty_hunter"><![CDATA[Bounty Hunter]]></entry>
  <entry id="str_quirk_name_tough"><![CDATA[Tough]]></entry>
</language>
```

- Root element: `<language id="english">` (or other language code)
- Each string: `<entry id="[key]"><![CDATA[text]]></entry>`
- Mod localization compiles to `<modID>_english.loc2`

## Mod Assets

Two mod locations:
- **Manual installs**: `DarkestDungeon/mods/<mod_name>/`
- **Steam Workshop**: `steamapps/workshop/content/262060/<workshop_id>/`

Each mod has a `project.xml` at its root with metadata (Title, ModDataPath, Tags, etc.).

Mods can add/override:
- New hero classes (same folder structure as base heroes)
- New trinkets, quirks, skills
- Modified game data files
- Load order is controlled in-game; higher priority mods win on file conflicts
- Mods that add new content (classes, trinkets) generally don't conflict

Our editor should scan both mod locations for additional class/trinket definitions and display modded content alongside base game content.

**Critical**: Once a modded hero class enters a save, removing the mod permanently breaks that save. Modded dungeons are even worse — cannot be removed once loaded.

## Legal Requirements

Per [Red Hook Studios' official modding statement](https://steamcommunity.com/app/262060/discussions/4/618453594745256209/):

1. **No bundling game assets** — read from user's installation at runtime only
2. **Required disclaimer**: "Hamlet Editor is not an official Red Hook Studios product or product modification, and Red Hook Studios Inc. is not responsible for changes or damages resulting from its use."
3. **Non-commercial** — the editor must be free
4. **No consumer confusion** — must not be presented as an official Red Hook product
5. **No Red Hook trademarks** in app branding (logo, studio name) — reference game by name only in descriptive text
