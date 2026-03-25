# Game Data Reference

Read-only reference files from the game installation. Used for validation, autocomplete, and display in the editor.

## Data File Locations

All paths relative to the game installation root.

### Hero Class Definitions

- **Path**: `heroes/<classname>/<classname>.info.darkest`
- **Format**: `.darkest` (custom text key-value)
- **Contains**: Base stats (HP, dodge, speed, accuracy, crit, damage), resistances, weapon/armor upgrade paths, combat skills, camping skills, stat progression per resolve level

### Quirk Definitions

- **Path**: `shared/quirk/quirk_library.json`
- **DLC**: `dlc/580100_crimson_court/features/.../shared/crimson_court.quirk_library.json`
- **Contains**: Quirk IDs, positive/negative flag, disease flag, random chance, incompatible quirks, curio interaction tags, buff references

### Buff/Debuff Definitions

- **Path**: `shared/buffs/base.buffs.json`
- **DLC**: `dlc/580100_crimson_court/.../shared/buffs/crimson_court.buffs.json`
- **Contains**: All buff/debuff definitions with stat modifiers

### Trinket Definitions

- **Path**: `trinkets/base.entries.trinkets.json` (top-level `trinkets/` directory, NOT under `shared/`)
- **Also**: `trinkets/base.rarities.trinkets.json`, `trinkets/base.starting.trinkets.json`
- **DLC**: `dlc/580100_crimson_court/.../trinkets/crimson_court.entries.trinkets.json`
- **Contains**: Trinket IDs, stats, buffs, class restrictions, rarity, price, limit, origin dungeon

### Building/Upgrade Definitions

- **Path**: `campaign/town/buildings/<building>/` and `upgrades/building/`
- **Contains**: Building costs, unlock requirements, upgrade tiers

### Quest Definitions

- **Path**: `campaign/quest/`
- **Files**: `quest.types.json`, `quest.generation.json`, `quest.restriction.json`, `quest.fail_penalty.json`, `plot_quests.json`
- **Contains**: Quest types, goals, rewards, generation rules, level restrictions

### Rules/Game Config

- **Path**: `shared/rules.json`
- **Contains**: Affliction chances, light level buffs, retreat mechanics, provision effects, camping costs, ambush rates, difficulty settings

### Curio Data

- **Path**: Not found at `shared/curio_type_library.csv` as previously documented. Curio icons are at `panels/icons_curio_tracker/*.curio_tracker.png`. The CSV may be embedded in dungeon data or distributed across campaign files.

### Loot Tables

- **Path**: Not found as a standalone `shared/loot/loot.darkest` file. Loot data appears to be distributed across dungeon/quest files.

### Inventory/Provision

- **Path**: `inventory/` (stack limits, costs)
- **Path**: `campaign/provision/provision.json` (starting items, shop inventory per quest length — under `campaign/`, not top-level)

### Backer Heroes

- **Path**: `shared/hero/backer_heroes.json`
- **Contains**: Pre-defined hero names from Kickstarter backers

### Localization

- **Path**: `localization/*.string_table.xml`
- **Format**: XML with CDATA entries (see game-assets.md for structure)
- **Contains**: Display-name strings for items, heroes, quirks, abilities, everything
- Named as `<classname>.string_table.xml` or descriptively (`trinkets.string_table.xml`)

### Dungeon Encounters

- **Path**: `campaign/dungeons/<dungeon_type>/` and `dungeons/<name>/<name>.<difficulty>.mash.darkest`
- **Contains**: Encounter composition tables by dungeon and difficulty (1=Apprentice, 3=Veteran, 5=Champion)

### Effects Definitions

- **Path**: `effects/base.effects.darkest`
- **Format**: `.darkest`
- **Contains**: Centralized effect definitions used by combat skills, items, etc.

### Curio Props

- **Path**: `campaign/curio_props.csv`
- **Contains**: Curio prop names and their properties

### Obstacle Definitions

- **Path**: `campaign/obstacle_definitions.json`
- **Contains**: Obstacle names and properties

### Color of Madness DLC Data

- **Quirks**: `dlc/735730_color_of_madness/shared/quirk/com.quirk_library.json`
- **Districts**: `dlc/735730_color_of_madness/campaign/town/districts/color_of_madness.districts.json`
- **Currency**: Shards (crystalline fragments, Farmstead-only)
- **Trinkets**: Crystalline trinkets (purchased with shards)
- **Bosses**: The Miller, The Thing From the Stars, The Comet
- **Building**: Farmstead (endless dungeon mode)

### Resolve Level Thresholds

- **Path**: `campaign/roster/roster.variables.json` → `resolve_level_thresholds`
- **WARNING**: Do NOT confuse with `progression.json` (that's dungeon difficulty scaling)

## HP Per Class By Armour Rank

Derived from hero `.info.darkest` files. Useful for "heal to max" operations.

| Class | Rank 0 | Rank 1 | Rank 2 | Rank 3 | Rank 4 |
|-------|--------|--------|--------|--------|--------|
| plague_doctor | 22 | 26 | 30 | 34 | 38 |
| occultist | 20 | 23 | 27 | 30 | 34 |
| vestal | 25 | 29 | 33 | 38 | 42 |
| hellion | 27 | 31 | 36 | 40 | 45 |
| houndmaster | 22 | 25 | 29 | 32 | 36 |
| bounty_hunter | 26 | 30 | 34 | 38 | 43 |
| man_at_arms | 33 | 37 | 42 | 47 | 52 |
| highwayman | 24 | 28 | 31 | 35 | 39 |
| jester | 20 | 23 | 26 | 29 | 33 |
| crusader | 36 | 40 | 47 | 54 | 61 |
| arbalest | 28 | 32 | 36 | 40 | 45 |
| musketeer | 28 | 32 | 36 | 40 | 45 |
| grave_robber | 20 | 24 | 28 | 32 | 36 |
| leper | 35 | 42 | 49 | 56 | 63 |
| abomination | 27 | 31 | 36 | 41 | 46 |
| antiquarian | 17 | 20 | 23 | 26 | 29 |
| shieldbreaker | 21 | 24 | 28 | 31 | 35 |
| flagellant | 22 | 26 | 30 | 33 | 37 |

## Default Combat Skills Per Class

**Note**: These represent common starting configurations. Recruits can vary — the game randomizes skill loadouts from the class's available pool. These are not fixed defaults.

| Class | Skills |
|-------|--------|
| plague_doctor | blinding_gas, plague_grenade, noxious_blast, battlefield_medicine |
| occultist | abyssal_artillery, weakening_curse, wyrd_reconstruction, daemons_pull |
| vestal | mace_bash, gods_hand, gods_illumination, gods_comfort |
| hellion | wicked_hack, iron_swan, breakthru, adrenaline_rush |
| houndmaster | whistle, hounds_rush, guard_dog, howl |
| bounty_hunter | target_tag, collect_bounty, finish_him, flashbang |
| man_at_arms | crush, retribution, command, bolster |
| highwayman | grape_shot_blast, pistol_shot, opened_vein, take_aim |
| jester | harvest, heroic_end, solo, inspiring_tune |
| crusader | smite, zealous_accusation, stunning_blow, bulwark_of_faith |
| arbalest | sniper_shot, battlefield_bandage, flare, suppressing_fire |
| musketeer | aimed_shot, smokescreen, patch_up, skeet_shot |
| grave_robber | shadow_fade, thrown_dagger, lunge, toxin_trickery |
| leper | chop, hew, revenge, intimidate |
| abomination | transform, manacles, vomit, absolution, rake, rage, slam (7 skills, fixed) |
| antiquarian | cower, festering_vapours, flashpowder, fortifying_vapours |
| shieldbreaker | pierce, serpents_sway, spearing, break_guard |
| flagellant | punish, rain_of_sorrows, redeem, reclaim |

## Known IDs

### Quirk IDs (Positive — Base Game)

tough, hard_skinned, quick_reflexes, natural_swing, natural_eye, evasive, slugger, unerring, accurate, precision_striker, eagle_eye, steady, resilient, thick_blooded, clotter, fated, hard_noggin, shocker, mercurial, irrepressible, unyielding, early_riser, warrior_of_light, lurker, on_guard, fast_healer, second_wind, photomania, clutch_hitter, last_gasp, hagiomania

### Negative Quirks (notable)

nocturnal (and many others — full list from `shared/quirk/quirk_library.json`)

### Color of Madness Quirks

luminous, hippocratic, hot_to_trot, musical, spiritual, gifted, daredevil, natural

### Prismatic Quirks (unique per roster)

alien_speed, alien_eye, alien_force, alien_precision, alien_calm, alien_purity, alien_healing, alien_solidity

### Disease IDs

rabies, spotted_fever, bulimic, anorexic, scurvy, the_black_plague, the_ague, syphilis, tapeworm, tetanus, hemophilia, the_runs, creeping_cough, vampiric_spirits, cyst, rumination

### Blood Curse States (Crimson Court DLC)

| ID | State | Description |
|----|-------|-------------|
| `disease_vampire_passive` | Sated | No negative effects |
| `disease_vampire_crave` | Craving | Mild debuffs |
| `disease_vampire_wasting` | Wasting | Severe debuffs |
| `disease_vampire_blood_lust` | Blood Lust | Extreme state |

Only one state at a time. **Only modify if hero already has a vampire state.**

### Estate Currency Types

| Item ID | Type Field | Description |
|---------|-----------|-------------|
| `crimson_court_invitation_A` | `estate_currency` | Baron invitation |
| `crimson_court_invitation_B` | `estate_currency` | Viscount invitation |
| `crimson_court_invitation_C` | `estate_currency` | Countess invitation |
| `the_blood` | `estate` | Blood vial (NOT `estate_currency`) |
| (various) | `blueprint` | Crimson Court crafting currency |

### Selected Trinket IDs

**Ancestor Trinkets**: ancestors_candle, ancestors_pen, ancestors_pistol, ancestors_scroll, ancestors_map, ancestors_coat, ancestors_signet_ring, ancestors_lantern, ancestors_tentacle_idol

**Boss Drop Trinkets**: collector_1, collector_2, collector_3, boss_flesh, boss_prophet, boss_cannon, boss_hag, boss_tassle, boss_wilbur, boss_necromancer, boss_siren, boss_crew

**Core Stackable**: focus_ring, feather_crystal, legendary_bracer, sun_ring, dazzling_charm, berserk_charm
