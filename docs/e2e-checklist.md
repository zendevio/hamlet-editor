# End-to-end checklist (editor + game)

Automated tests (`pnpm test`, `cargo test`, `cargo test -p ddsavelib`) cover the
save pipeline with a real save fixture, but only the real game proves it accepts
what the editor writes. Run this checklist before a release and after any change
to how saves are read, merged, encoded or written. It needs Darkest Dungeon 1
installed and a real campaign.

## Before you start

1. Close the game and the editor. Turn off Steam Cloud for the game (see the
   README).
2. Back up the whole save folder, for example
   `<Steam>/userdata/<id>/262060/`, and record a checksum manifest:
   `find . -type f -exec shasum -a 256 {} + | LC_ALL=C sort -k2 > manifest.sha256`.
3. Restore that backup between scenarios (game and editor closed), and
   re-check the manifest. Steam rewrites `remotecache.vdf` whenever the game
   runs; ignore it.
   Quit the Steam client before restoring and start it again afterwards.
   A copy that keeps the old file timestamps (`rsync -a`, `cp -p`) while Steam
   runs leaves Steam's cached file sizes stale, and the game then stops on
   `Assert Failed: (len == file_info.m_FileSize) ... didn't read whole file?`
   even for an untouched backup. Files the editor saves get fresh timestamps
   and do not trigger this.
4. Turn on the game's debug output (`debug_output` in
   `persist.options.json`) and play windowed. After each game session, read the
   new lines of `Darkest.app/Contents/Resources/data/app.log` (macOS) for
   errors, asserts and save/load warnings.
5. Launch the editor with `HAMLET_WINDOW=maximized` for a predictable layout.

The game rewrites several save files whenever a campaign is loaded. That is
expected; compare the editor's own writes before launching the game.

## Scenarios

| # | Scenario | Pass when |
| --- | --- | --- |
| 1 | Change gold by +1 and save. | Only `persist.estate.json` changes; the game loads and shows the new gold; no new errors in the log. |
| 2 | Change every wallet currency, plus a Crimson Court invitation the save does not have yet. | The game shows the new values. |
| 3 | Rename a hero, change stress with the slider, add and remove quirks. | Only `persist.roster.json` changes; the hero sheet in the game matches. |
| 4 | Change a level-1 hero's level up and back down. | Weapon and armour ranks never change. |
| 5 | Click every hero, open every page and every town building, click HP and stress sliders without dragging. | Nothing is marked unsaved; closing needs no dialog; saved fractional HP (for example 67.1) is unchanged. |
| 6 | Make an edit, start the game, load the campaign, quit the game. | The editor blocks saving while the game runs, then marks the profile stale; the close dialog offers no Save and Close; clicking Reload and choosing Discard shows the game's data. |
| 7 | Dismiss a hero who has a trinket equipped. | The game loads without the hero and the trinket is back in the trinket inventory. Heroes in treatment, dead heroes and the final living hero cannot be dismissed. Dismissal is blocked during an active raid. Town status 1 and stale raid references do not block dismissal. A hero in the last party can be dismissed: their slot becomes -1 and the game must still load that party. |
| 8 | Make an edit, use Discard; make another, close and choose Discard and Close. | Discard leaves nothing unsaved; the window closes on the first click. |
| 9 | Make an edit, close and choose Save and Close. | The save completes and the window closes. |
| 10 | Town page. | Upgrade trees, treatment slots and built districts match the game. |
| 11 | Town revival (verified in game 2026-10-20: Bonel back in the roster, Graveyard empty, embarked at full HP). Start with the captured town save after the in-game Courtyard retreat (Bonel, GUID 58 dead), revive and Save; separately test Discard, active-raid block and full-capacity block. | Only roster changes: statuses 0/0, class max HP, empty combat buffs, turn/rank fields 0, combat_ready false, visited_deaths_door false. Stress, quirks, skills, upgrades and death history stay unchanged; lost skill upgrades are not restored. Capacity is 29 with the captured Stage Coach upgrades and Shieldbreaker bonus, so 28 living allows revival. Game shows Bonel alive and absent from the Graveyard, he can embark with full HP, no new errors. Discard restores the original death. Unknown capacity and 29 living block revival. |
| 12 | Minimal editor abandon (verified in game 2026-10-20 for the Courtyard case: town loads, Brereton selectable, Bonel in the Graveyard; regular raid, trinket and loot cases still unverified). Start with the captured active Courtyard raid after Bonel died (Brereton alive); repeat on a regular raid, with inventory trinkets and loot, and test Discard. | inraid false, raiddungeon none; raid_save and raid file retained. Brereton status 0/before-town 1 with cleared combat state and unchanged HP/stress; Bonel stays dead with before-town 3; last party [-1,-1,96,-1]. Party inventory trinkets move to estate; supplies and loot are lost as listed in the dialog. No week advance, quest/quirk processing or campaign log edits. Game loads town with Brereton selectable and Bonel's grave intact; next embark works. Discard restores all original fields and inventories. Compare with in-game "Regroup in the Hamlet!", which performs the complete week/results processing. |
| 13 | Equip a trinket from "In your inventory", unequip it to the inventory, equip it on another hero; Save. | The game shows the trinket on the second hero only and not in the inventory (verified 2026-10-20). |
| 14 | With Steam running: create an editor backup, play until the game creates a raid, quit, then restore the editor backup. | The confirmation shows the removed-file count and Steam refusal reason with Restore disabled. Unsaved edits remain intact. Quit Steam, click Check again, and confirm Restore becomes available; the restore works and the game loads the campaign. Also start Steam while the unsaved-edits prompt is open and choose Discard: the confirmation reopens blocked and edits remain intact. |

Finish by restoring the backup and checking the manifest matches.
