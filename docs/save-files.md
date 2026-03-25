# Save File Reference

## Save File Locations

### Steam (Cloud Sync Enabled — Default)

Steam App ID for Darkest Dungeon 1: **262060**

| Platform | Path |
|----------|------|
| Windows  | `C:\Program Files (x86)\Steam\userdata\<STEAM3_ID>\262060\remote\profile_#\` |
| macOS    | `~/Library/Application Support/Steam/userdata/<STEAM3_ID>/262060/remote/profile_#/` |
| Linux    | `~/.local/share/Steam/userdata/<STEAM3_ID>/262060/remote/profile_#/` |

The Steam user ID is the numeric "Steam3 ID", not the display name.

### GOG / Non-Steam / Cloud Disabled

| Platform | Path |
|----------|------|
| Windows  | `%USERPROFILE%\Documents\Darkest\profile_#\` |
| macOS    | `~/Library/Application Support/Darkest/profile_#/` |
| Linux    | `~/.local/share/Red Hook Studios/Darkest/profile_#/` |

### Notes

- **Multiple profiles**: The game supports multiple save slots as `profile_0`, `profile_1`, `profile_2`, etc.
- **Epic/Humble Bundle**: Humble keys typically redeem on Steam (use Steam paths). DRM-free copies use GOG/non-Steam paths.
- **Build 25807 (April 2025)**: Unified binary across Steam, Epic, and GOG. Added 64-bit version. Save format unchanged but the `revision` field in DSON header may have new build numbers. Process detection must handle both 32-bit and 64-bit executables.
- **Steam Cloud gotcha**: Steam Cloud sync can overwrite edited saves. Users should disable cloud sync or close Steam before editing. Cloud conflicts have been reported to cause save corruption (heroes at 1 HP, deleted equipment, assertion errors).
- **Console save compatibility**: PC and Nintendo Switch saves use the same DSON format. Cross-platform save editing is theoretically possible if users can extract their console saves.

## Complete File List

### Core Save Files

| File | Purpose | Edit Risk |
|------|---------|-----------|
| `persist.roster.json` | All heroes: stats, skills, quirks, trinkets, stress, resolve level | Medium — interdependent with estate, town, upgrades |
| `persist.estate.json` | Wallet (gold, heirlooms), trinket storage, estate currency (invitations, blood) | Medium — trinkets must not duplicate with roster |
| `persist.campaign_log.json` | Quest/expedition history, hero death flags per chapter | Low |
| `persist.progression.json` | Achievement/progression tracking (Caretaker goals, visit_graveyard). **Known to contain duplicate DSON keys** — parsers must handle this. | Low |
| `persist.town.json` | Building states, heroes in treatment (Sanitarium, Tavern, Abbey) | Medium — hero references must match roster |
| `persist.game.json` | Save name, difficulty, week number, enabled DLCs, game mode | Low — but DLC flags affect all other files |
| `persist.quest.json` | Current/available quests, Darkest Dungeon quest progression | Medium |
| `persist.upgrades.json` | Building upgrade states, hero equipment upgrade levels | Medium — must match roster gear ranks |

### Secondary Save Files

| File | Purpose | Edit Risk |
|------|---------|-----------|
| `persist.curio_tracker.json` | Heirloom counts tracking | Low |
| `persist.game_knowledge.json` | Unlocked dungeons, discovered monster skills | Low — editing may cause UI display issues |
| `persist.journal.json` | Collected journal entries/pages | Low |
| `persist.narration.json` | Which narrator lines have played | Low — resetting replays narrator |
| `persist.options.json` | Per-profile game settings | Low |
| `persist.town_event.json` | Town events and their cooldowns | Low |
| `persist.tutorial.json` | Tutorial popup tracking | Low — resetting replays tutorials |
| `persist.campaign_mash.json` | Dungeon encounter composition data | High — poorly documented, editing may crash |
| `persist.loading_screen.json` | Loading screen narration queue tags | Low |
| `novelty_tracker.json` | Tracks seen items/buildings (controls "!" indicators). **Note**: this file intentionally lacks the `persist.` prefix — it's the only save file without it. | Low |

### Active Raid Files (only exist during a dungeon run)

| File | Purpose | Edit Risk |
|------|---------|-----------|
| `persist.raid.json` | Active raid state: party composition, torchlight, inventory, dungeon type, difficulty, quest goals | High — must be consistent with roster |
| `persist.map.json` | Dungeon map layout, explored/unexplored rooms, corridors | High |

## File Interdependencies

These relationships **must** be maintained for save consistency:

| Relationship | Why |
|-------------|-----|
| **roster ↔ estate** | Trinkets equipped on heroes (roster) must not also appear in estate storage. Moving trinkets requires editing both. |
| **roster ↔ town** | Heroes "in treatment" are referenced in both. Status must match. |
| **roster ↔ upgrades** | Hero weapon_rank/armour_rank must match upgrade data. Skill upgrades also in upgrades file. |
| **roster ↔ raid** | During active raids, hero state is split between these files. Dead heroes are removed from raid party array. |
| **roster ↔ campaign_log** | Hero death flags (`died` in MissionEvent). Revival requires clearing in both. |
| **roster ↔ campaign_log ↔ progression** | Full revival requires all three (+ raid if mid-dungeon). The community-documented "3-field" shortcut (roster only) leaves stale death flags. |
| **game ↔ all** | DLC flags in game.json determine which fields are expected in other files. |

## Game's Own Backup Folder

The game automatically creates a `backup/` subfolder inside each `profile_#/` directory, populated at the start of each game session. Important implications:

- Users can restore from the game's own backups
- Our editor should **not** scan this folder as a save profile
- We can offer "restore to game's last backup" as an additional recovery option
- Our backup system is separate and should not conflict with this folder

## DLC Impact

- DLCs do **not** create separate save files — DLC data is integrated into existing persist files
- `persist.game.json` tracks which DLCs are enabled
- A save upgraded to include DLC **cannot be downgraded** — this is irreversible, especially dangerous with Color of Madness
- DLC features add fields within existing files (Crimson Curse in roster, Farmstead in campaign, districts in town)
- **Do NOT inject DLC fields into a non-DLC save** — the game will crash
- DLC quirk libraries: `dlc/580100_crimson_court/.../shared/crimson_court.quirk_library.json`, `dlc/735730_color_of_madness/shared/quirk/com.quirk_library.json`

## Skill and Building Upgrades (persist.upgrades.json)

**Important**: Skill upgrade levels are NOT stored in the hero object in `persist.roster.json`. They are entries in `persist.upgrades.json`.

```json
{
  "base_root": {
    "purchases": {
      "0": {
        "instance_number": 96,
        "tree_id": "###crusader.stand_tall",
        "requirement_code": "1",
        "is_purchased": true
      },
      "1": {
        "instance_number": 0,
        "tree_id": "###sanitarium.cost",
        "requirement_code": "a",
        "is_purchased": true
      }
    }
  }
}
```

- `instance_number` — hero GUID (0 for building upgrades)
- `tree_id` — `###`-prefixed hashed string (e.g., `###crusader.stand_tall`, `###sanitarium.cost`)
- `requirement_code` — `Char` type (raw ASCII character, 1 byte, not integer): `"0"` = unupgraded, `"1"` = tier 1, `"2"` = tier 2 (applies to both skills AND gear); `"a"` = building unlock costs
- `is_purchased` — boolean

"Set hero level" operations must also update this file for gear and skill upgrades to be consistent.

## Estate Name Constraint

The estate/save name in `persist.game.json` (`estatename` field) has a **byte-length constraint**: the DSON binary stores the string length separately. Renaming to a different byte length without updating the length field causes the save to disappear on next load. Our editor must handle this automatically during encode.

## Decoded JSON Structures

### Roster (persist.roster.json)

```json
{
  "base_root": {
    "version": 513,
    "nextGuid": 110,
    "dismissed_hero_count": 1,
    "last_party": {
      "last_party_guids": [96, 42, 7, 55]
    },
    "heroes": {
      "96": {
        "hero_file_data": {
          "raw_data": {
            "base_root": {
              "roster.status": 0,
              "roster.before_on_start_town_visit_status": 0,
              "actor": {
                "name": "HeroName",
                "current_hp": 26,
                "colour_variation": 0,
                "stunned": 0,
                "combat_ready": false,
                "damage_source_data": "###none",
                "buff_group": {},
                "buff_group_next_guid": 0,
                "actor_dot": {}
              },
              "heroClass": "plague_doctor",
              "resolveXp": 2,
              "m_Stress": 0,
              "visited_deaths_door": false,
              "is_death_heart_attack_completed": false,
              "has_had_heart_attack": false,
              "deaths_door_enter_effect_round_cooldown": 0,
              "weapon_rank": 1,
              "armour_rank": 1,
              "affliction_type_id": "",
              "affliction_severity": 0,
              "virtue_type_id": "",
              "backer_hero": false,
              "enemies_killed": 0,
              "steps_taken": 0,
              "provisions_consumed": 0,
              "dd_test_survived": 0,
              "number_of_successful_darkest_dungeon_quests": 0,
              "is_from_town_event": false,
              "quirks": {
                "quick_reflexes": {
                  "is_locked": false,
                  "is_new": false,
                  "mission_count": 5,
                  "replaces_quirk": 0,
                  "replaces_quirk_viewed": false,
                  "evolution_duration_remaining": 0
                }
              },
              "skills": {
                "selected_combat_skills": {},
                "selected_camping_skills": {}
              },
              "trinkets": {"items": {}},
              "dungeon_history": []
            }
          }
        }
      }
    }
  }
}
```

**Note**: Each hero's `hero_file_data.raw_data` is a DSON `FieldType::File` — an embedded binary DSON file serialized within the outer DSON. This is why the nesting is so deep.

### Estate (persist.estate.json)

```json
{
  "base_root": {
    "wallet": {
      "0": {"amount": 666440, "type": "gold"},
      "1": {"amount": 536, "type": "bust"},
      "2": {"amount": 775, "type": "portrait"},
      "3": {"amount": 627, "type": "deed"},
      "4": {"amount": 717, "type": "crest"},
      "5": {"amount": 449, "type": "shard"}
    },
    "trinkets": {
      "items": {
        "0": {"id": "focus_ring", "type": "trinket", "amount": 1}
      }
    },
    "estate_items": {
      "items": {
        "0": {"id": "crimson_court_invitation_A", "type": "estate_currency", "amount": 1}
      }
    },
    "endless_wave_highscore": 0,
    "tampering": {},
    "darkest_dungeon_trinket_unlocks": {}
  }
}
```

Additional estate item types: `blueprint` (Crimson Court crafting currency), `trinket_unlock` (quest reward type).

### Game (persist.game.json)

```json
{
  "base_root": {
    "estatename": "My Estate",
    "game_mode": "standard",
    "totalelapsed": 1196151803,
    "inraid": false,
    "raiddungeon": "none",
    "date_time": "2025-03-15 14:30:00",
    "dd_options_altered": false,
    "profile_options": {
      "values": {
        "quest_select_warnings": [true, true],
        "provision_warnings": [true, true],
        "deck_based_stage_coach": [true, true],
        "curio_tracker": [true, true],
        "dd_mode": [false, false],
        "corpses": [true, true],
        "stall_penalty": [true, true],
        "deaths_door_recovery_debuffs": [true, true],
        "retreats_can_fail": [true, true],
        "multiplied_enemy_crits": [false, false]
      }
    },
    "presented_dlc": {},
    "dlc_init": true
  }
}
```

Note: Most `profile_options.values.*` fields are `TwoBool` (8 bytes, two 4-byte booleans). Exceptions: `town_events` and `never_again` are string-valued (e.g., `"normal"`, `"strict"`). The `game_mode` field can be `"standard"`, `"radiant"`, `"new_game_plus"`, or `"bloodmoon"`.

### Campaign Log (persist.campaign_log.json)

```json
{
  "base_root": {
    "total_weeks": 42,
    "chapters": {
      "0": {
        "chapterIndex": 0,
        "0": {
          "rtti": -579125384,
          "name": "Reynauld",
          "class": "###crusader",
          "guid": 1,
          "level": 2
        }
      }
    }
  }
}
```

RTTI dispatch (chapter event types):

| RTTI Hash | Event Type | Fields |
|-----------|-----------|--------|
| -579125384 | HeroLevelupEvent | name, class (hashed), guid, level |
| 2006063882 | MissionEvent | heroes map (name, class, died, guid), quest (hashed), dungeon_type (hashed), difficulty, length, start, success |
| -37270005 | BuildingUpgradeEvent | trees map (tree + level), id (hashed), percent (Float — hardcoded in type table as `chapters/*/*/percent`), unlocked |
| 844919810 | TownEvent | town_event_result_id (hashed) |

The `died` flag in MissionEvent heroes is used for revival operations.

## Roster Status Codes

Verified against all reference implementations (Java, TypeScript, Go).

| Value | Name | Meaning |
|-------|------|---------|
| 0     | AVAILABLE | In roster, available for party |
| 1     | SQUAD | In squad / town-visit state |
| 2     | STAFFED | In treatment (Sanitarium, Tavern, Abbey) |
| 3     | DEAD | Dead |
| 4     | GONE | Underway / in raid |

## Resolve Level Thresholds

Source: game data `campaign/roster/roster.variables.json` → `resolve_level_thresholds`

**WARNING**: Do NOT use `progression.json` — that contains dungeon difficulty scaling, not hero XP.

| Level | Name | resolveXp | Max Gear Rank |
|-------|------|-----------|---------------|
| 0 | Novice | 0 | 0 |
| 1 | Apprentice | 2 | 1 |
| 2 | Journeyman | 8 | 2 |
| 3 | Veteran | 14 | 3 |
| 4 | Champion | 24 | 4 |
| 5 | — | 36 | 4 |
| 6 | Max | 48 | 4 |

Gear rank caps at 4 for levels 4-6. A hero is at resolve level N if `resolveXp >= threshold[N]` and `resolveXp < threshold[N+1]`. Setting a hero to level 4 means writing `resolveXp: 24`.

## Active Raid (persist.raid.json)

Only present during an active dungeon run. High edit risk — must remain consistent with `persist.roster.json`.

### Top-Level Structure

```json
{
  "base_root": {
    "raid_instance": {
      "id": "quest_identifier",
      "is_plot_quest": false,
      "type": "explore",
      "dungeon": "weald",
      "difficulty": 1,
      "length": 1,
      "goal_ids": ["###kill_bosses"],
      "completion_reward": {
        "resolve_xp": 4,
        "items_definition": {
          "system_config_type": "raid",
          "items": {}
        }
      }
    },
    "in_area": "rooA",
    "areatile": "hallA",
    "last_room_id": "rooA",
    "in_doorway": false,
    "start_elapsed_time": 12345.0,
    "inbattle": false,
    "stat_database": {},
    "raid_finish_quirk_monster_class_ids": [],
    "party": {
      "heroes": [96, 42, 7, 55],
      "start_heroes_size": 4,
      "torchlight": 75.0,
      "IsMovingLeft()": false,
      "retreat_room": "rooA",
      "scoutChance_all": 0.33,
      "scoutModifier_all": 0.0,
      "inventory": {
        "system_config_type": "raid",
        "items": {
          "0": {"id": "torch", "type": "provision", "amount": 4},
          "1": {"id": "food", "type": "provision", "amount": 8}
        },
        "hunger_room_buffer": 2
      }
    }
  }
}
```

### Key Fields

| Field | Type | Notes |
|-------|------|-------|
| `raid_instance.dungeon` | String (hashed) | `"weald"`, `"ruins"`, `"cove"`, `"warrens"`, `"darkestdungeon"`, `"farmstead"` (CoM), `"courtyard"` (CC) |
| `raid_instance.type` | String (hashed) | Quest type: `"explore"`, `"boss"`, `"scout"`, `"cleanse"` |
| `raid_instance.difficulty` | Int | 1 = Apprentice, 3 = Veteran, 5 = Champion |
| `raid_instance.length` | Int | 1 = Short, 2 = Medium, 3 = Long |
| `raid_instance.goal_ids` | StringVector | Hashed strings identifying quest objectives |
| `in_area` | String | Current room ID (e.g., `"rooA"`, `"hallB"`) |
| `inbattle` | Bool | Whether party is currently in a battle |
| `party.heroes` | IntVector | Array of hero GUIDs in left-to-right party order |
| `party.torchlight` | Float | Current torch level, 0.0–100.0 |
| `party.scoutChance_all` | Float | Base scouting chance modifier |
| `party.inventory.hunger_room_buffer` | Int | Rooms until next hunger check |
| `start_elapsed_time` | Float | Game time elapsed at raid start |

### Party Order

The `party.heroes` array is ordered **left to right** on the combat screen (slot 1 = leftmost = index 0, slot 4 = index 3 = frontline nearest enemies). This is the live in-raid order.

`IntVector` field name `party -> heroes` is confirmed in robojumper's `DsonTypes.java`. The `last_party_guids` in `persist.roster.json` records the pre-dungeon party; `party.heroes` in the raid file is the authoritative in-dungeon order.

### Mid-Dungeon Edit Requirement

During an active raid, hero HP exists in two places:
- `persist.raid.json` — the live in-dungeon state
- `persist.roster.json` — the hamlet snapshot (not updated until dungeon exit)

Editing HP mid-dungeon requires updating **both files**. The raid file takes precedence while `inraid: true` in `persist.game.json`.

### Abandoning a Raid via File Deletion

Deleting `persist.raid.json` and setting `"inraid": false` in `persist.game.json` forces the game to treat the party as having returned to the Hamlet. Heroes lose all in-dungeon progress (loot, XP, quirks earned mid-run) but their roster state is restored from `persist.roster.json`. This is the primary documented crash-loop escape for mid-dungeon corruption.

---

## Town Buildings (persist.town.json)

### Hero-in-Building Tracking

Heroes in treatment are tracked in two places simultaneously:
1. `persist.roster.json` — hero object contains `roster.building_name` (string) and `roster.status: 2` (STAFFED)
2. `persist.town.json` — building slot entries list hero GUIDs

These must remain consistent. Editing one without the other causes heroes to appear stuck or duplicated.

### roster.building_name Values (in persist.roster.json)

| Value | Building |
|-------|---------|
| `""` | Not in a building |
| `"abbey"` | Abbey |
| `"tavern"` | Tavern |
| `"sanitarium"` | Sanitarium |

### Building Activity IDs

The `activity_type` within a building slot uses these internal ID strings (confirmed from official Red Hook modding guide):

| Building | Activity IDs |
|---------|-------------|
| Abbey | `"meditation"`, `"prayer"`, `"flagellation"` |
| Tavern | `"bar"`, `"gambling"`, `"brothel"` |
| Sanitarium | `"disease_treatment"`, `"quirk_treatment"` |

### Building Names in persist.upgrades.json

Building upgrade `tree_id` values (after `###` prefix stripping) follow the pattern `<building_name>.<upgrade_key>`. Known building name prefixes:

`sanitarium`, `tavern`, `abbey`, `blacksmith`, `guild`, `stage_coach`, `survivalist`, `barracks`, `nomad_wagon`

### Can Building Upgrades Be Reverted?

Setting `is_purchased: false` on a building upgrade entry in `persist.upgrades.json` removes the unlock. The game reads purchase state directly on load. However:
- Reverting a lower-tier upgrade while a higher one remains `true` may cause visual inconsistency
- Costs are not refunded (data edit only, no in-game refund)

**Recommended approach for downgrade**: Set `is_purchased: false` for the target upgrade and all upgrades above it in the same tree.

---

## Negative Quirk IDs — Complete List

These IDs appear as keys in the `quirks` object inside each hero's save data. Sourced from `shared/quirk/quirk_library.json` and `quirks.string_table.xml`.

### Base Game Negative Quirks

**Stat Penalty:**
`fragile`, `soft`, `slow_reflexes`, `slowdraw`, `the_yips`, `lazy_eye`, `clumsy`, `torn_rotator_cuff`, `scattering`, `inaccurate`, `weak_grip`, `flawed_release`, `nervous`, `ruminator`, `thin_blooded`, `anemic`, `sickly`, `mercurial`, `winded`, `tuckered_out`, `off_guard`, `dud_hitter`, `stress_eater`, `stress_faster`, `night_blindness`, `sensitive_to_light`, `diurnal`, `nocturnal`, `shocker`, `suicidal`, `last_gasp`, `double_vision`, `stomach_cramp`, `disorganized`, `bulimic`, `irrepressible`, `unyielding`, `too_boastful`, `cruelty_conscious`

**Phobia / Fear:**
`fear_of_beast`, `fear_of_eldritch`, `fear_of_man`, `fear_of_unholy`, `zoophobia`, `automatonophobia`, `claustrophobia`, `lygophobia`, `phengophobia`, `satanophobia`, `thanatophobia`, `autophobia`, `necrophobia`, `lurker`

**Dungeon Phobias:**
`ruins_phobe`, `warren_phobe`, `weald_phobe`, `cove_phobe`, `darkest_dungeon_phobe`

**Dungeon Scroungers (negative — reduced heirloom discovery):**
`ruins_scrounger`, `warren_scrounger`, `weald_scrounger`, `cove_scrounger`, `darkest_dungeon_scrounger`

**Hatred (penalize against monster type):**
`hatred_of_eldritch`, `hatred_of_unholy`, `hatred_of_man`, `hatred_of_beast`

**Compulsions / Manias (forced curio/item interactions):**
`kleptomaniac`, `curious`, `bloodthirsty`, `guilty_conscience`, `hieromania`, `necromania`, `ablutomania`, `dacnomania`, `egomania`, `hylomania`, `nymphomania`, `sitiomania`, `photomania`, `plutomania`, `dipsomania`, `paranormania`, `demonomania`, `compulsive`, `hagiomania`, `dark_temptation`

**Town Activity Quirks (force specific stress relief activities):**
`deviant_tastes`, `known_cheat`, `unquiet_mind`, `witness`, `faithless`, `alcoholism`, `gambler`, `bad_gambler`, `love_interest`, `tither`, `flagellant`

**Diseases (`is_disease: true` in quirk_library — treated at Sanitarium):**
`bad_humours`, `creeping_cough`, `hemophilia`, `the_runs`, `lethargy`, `wasting_sickness`, `tetanus`, `rabies`, `syphilis`, `spotted_fever`, `vertigo`, `vampiric_spirits`, `ennui`, `the_ague`, `hysterical_blindness`, `scurvy`, `the_worries`, `the_fits`, `tapeworm`, `the_red_plague`, `the_black_plague`

**Note on diseases**: Diseases have `"is_disease": true` in the quirk_library. In save files, they appear in the same `quirks` object as regular quirks. The Sanitarium UI separates them, but the data layer does not — the same removal operation applies to both.

### Crimson Court DLC Negative Quirks

File: `dlc/580100_crimson_court/features/crimson_court/shared/quirk/crimson_court.quirk_library.json`

**Corvid Quirks:**
`corvid_blindness`, `corvid_appetite`, `corvid_curiosity`

**The Crimson Curse** IS stored as disease-type quirk entries in the `quirks` map — using the IDs `disease_vampire_passive`, `disease_vampire_crave`, `disease_vampire_wasting`, `disease_vampire_blood_lust` (confirmed in `crimson_court.quirk_library.json`). Only one state at a time. The quirk library defines evolution chains between states. Heroes with the curse are immune to standard diseases. See `game-data.md` Blood Curse States table for details.

### Color of Madness DLC Negative Quirks

File: `dlc/735730_color_of_madness/shared/quirk/com.quirk_library.json`

**`shard_mercenary`** — Permanent. Prevents hero from joining any quest except the Farmstead Endless Mode. Cannot be removed or replaced. Applied automatically to Shard Mercenary Stage Coach recruits. Takes 10% of Comet Shards at end of Endless run.

---

## Save Corruption Recovery

### Corruption Taxonomy

| Type | Cause | Symptom |
|------|-------|---------|
| Power-loss truncation | Shutdown during write | `Assert Failed: (text[0] == '{')` in serialize_json.cpp — file truncated |
| Steam Cloud conflict | Multi-client sync with wrong resolution | Heroes at 1 HP, deleted equipment, assertion errors |
| Steam Cloud crash loop | Corrupt save re-downloads after reinstall | Crash → reinstall → cloud restores corrupt save → crash repeats |
| Encoding corruption | Re-encoded with name file or debug flag | Game silently refuses to load profile |
| Mid-dungeon interruption | Crash during expedition | `persist.raid.json` partially written |
| Mod removal crash | Missing class definition | Crash on save load |

### Standard Recovery Procedure (in priority order)

1. **Game's own backup folder** — `profile_#/backup/` is populated at session start. Copy files from `backup/` into `profile_#/` to restore the pre-session state. If only one file is corrupt, copy just that file.

2. **Identify the corrupt file** — The assertion error often names the file. Known corrupt files: `persist.estate.json` (triggers `text[0] == '{'`), `persist.roster.json` (reduced to ~1KB after power loss).

3. **Delete persist.raid.json to escape mid-dungeon loop** — If crashing on a mid-dungeon save: delete `persist.raid.json`, set `"inraid": false` in `persist.game.json`. Heroes lose in-dungeon progress but roster state is preserved from `persist.roster.json`.

4. **Steam Cloud crash loop fix** — Disabling Steam Cloud in game Properties alone does NOT work (data is already cached locally). Required:
   - Steam → Settings → Cloud → manage saves → delete cloud data for the game
   - Place clean local saves before re-enabling cloud sync
   - Alternative: launch via `_windowsnosteam/Darkest.exe` to bypass cloud entirely
   - Some cases require starting fresh — cloud data must be fully purged

5. **Re-encode to fix binary corruption** — Decode → re-encode via robojumper's tool or equivalent. Rebuilds the binary structure correctly. Fixes duplicate DSON key corruption (`persist.progression.json` known case). Does NOT fix truncated files (power-loss corruption requires a backup).

6. **Last resort** — Email `support@redhookgames.com` with the zipped save folder.

### What Cannot Be Recovered

- Files truncated at write time with no valid backup copy
- Heroes auto-deleted by the game after mod removal (deletion is written immediately on load)
- DLC flags once enabled in `persist.game.json` (`dlc_init` fields are irreversible)

---

## Mod Content Stripping

### What Happens When a Modded Class Is Removed

When the game loads a save and a hero's `heroClass` references a class that no longer exists, it **silently deletes that hero from the roster** and writes the change immediately. If a modded hero is in an active raid (`persist.raid.json`), the game **crashes** instead.

### Files That Reference Hero Class

| File | Class reference | Risk if class missing |
|------|----------------|----------------------|
| `persist.roster.json` | `heroClass` field | Hero auto-deleted on load |
| `persist.raid.json` | Party hero data | Game crash |
| `persist.campaign_log.json` | Chapter events store `"class": "###modded_class"` | Crash or assertion failure on log rendering |
| `persist.upgrades.json` | Skill upgrade `tree_id` includes class hash | Orphaned entries — no crash, ignored |
| `persist.town.json` | References hero by GUID only | Harmless once hero is gone from roster |

### Safe Mod Class Removal Checklist

1. **Before removing the mod**: Dismiss all heroes of the modded class (set `roster.status: 3` or delete the hero entry in the editor)
2. **Ensure no modded hero is mid-raid**: Verify `"inraid": false` in `persist.game.json`, or that no modded hero GUID appears in `persist.raid.json`'s `party.heroes`
3. **Clean `persist.campaign_log.json`**: Remove chapter event entries where `"class"` is the modded class hash. These are in `chapters → * → *` and can be safely deleted (removes log history only)
4. **Orphaned upgrade entries**: `persist.upgrades.json` entries whose `instance_number` matches a deleted hero GUID can be left or removed — they are ignored by the game
5. **Remove the mod** after completing the above steps

### Modded Dungeon Warning

Modded dungeons referenced in `persist.game_knowledge.json` or `persist.quest.json` **cannot be safely removed once loaded**. The game crashes when it cannot find the dungeon layout. Manual editing is required to remove all references from quest and knowledge files — no automated recovery path exists.
