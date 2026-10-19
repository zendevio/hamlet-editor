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
| 6 | Make an edit, start the game, load the campaign, quit the game. | The editor blocks saving while the game runs, then marks the profile stale; the close dialog offers no Save and Close; Discard reloads the game's data. |
| 7 | Dismiss a hero who has a trinket equipped. | The game loads without the hero and the trinket is back in the trinket inventory. Heroes in treatment, in the last party or in an unfinished expedition cannot be dismissed. |
| 8 | Make an edit, use Discard; make another, close and choose Discard and Close. | Discard leaves nothing unsaved; the window closes on the first click. |
| 9 | Make an edit, close and choose Save and Close. | The save completes and the window closes. |
| 10 | Town page. | Upgrade trees, treatment slots and built districts match the game. |

Not yet verified in the game (the editor blocks these): reviving a dead hero,
and abandoning a Courtyard (plot) expedition.

Finish by restoring the backup and checking the manifest matches.
