# Skill Toggling Implementation Plan

## Overview
Replace the read-only skills section in HeroDetail with a toggleable grid that allows selecting which combat and camping skills a hero has equipped.

## Data Sources

### Combat Skills
- Parsed from `heroes/<class>/<class>.info.darkest` files
- Format: `combat_skill: .id "skill_name" .level 0 .type "melee" ...`
- Regex: `combat_skill:\s+\.id\s+"([^"]+)"`
- DLC heroes: flagellant, shieldbreaker, musketeer in their DLC subdirectories

### Camping Skills
- Parsed from `raid/camping/*.camping_skills.json` files
- Format: `{ "skills": [ { "id": "...", "hero_classes": ["crusader", "vestal"] } ] }`
- Shared across classes (inverted to per-class lists)

### Save File Structure
```json
"skills": {
  "selected_combat_skills": { "rampart": 0, "defender": 0, "retribution": 0, "bolster": 0 },
  "selected_camping_skills": { "first_aid": 0, "tactics": 0, "instruction": 0 }
}
```
Keys are skill IDs, values are always `0` (integer).

## Constraints
- Standard classes: 4 combat skills selectable from 7 available
- Abomination: all 7 combat skills fixed (no toggling)
- Camping skills: 4 selectable from class-specific + shared pool
- Min 1 combat skill must remain selected
- Graceful fallback to read-only if game data not loaded

## Files to Change

1. `src-tauri/src/commands/gamedata.rs` — new `ClassSkills` struct + `load_class_skills` command
2. `src-tauri/src/lib.rs` — register command
3. `src/lib/api/gamedata.ts` — `ClassSkills` interface + `loadClassSkills` wrapper
4. `src/lib/stores/game-data.svelte.ts` — `classSkills` state, setter, per-class getters
5. `src/lib/stores/save-data.svelte.ts` — `toggleCombatSkill`, `toggleCampingSkill` mutations
6. `src/lib/types/save-data.ts` — tighten skill types to `Record<string, number>`
7. `src/routes/+layout.svelte` — add `loadClassSkills` to initialization
8. `src/lib/components/heroes/HeroDetail.svelte` — replace read-only with toggleable grid

## Effort
~215-255 lines, estimated 2-4 hours.
