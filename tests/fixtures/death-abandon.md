# Death and abandon fixtures

`run7-snap-3.json` and `run7-snap-4.json` are compact extracts from the owner's decoded run7 captures, `snap-3-dead-in-raid` and `snap-4-after-game-abandon`. Bonel (58) and Brereton (96) retain their full raw hero records. Other roster records retain the captured status, before-town status, building, class, actor and trinket data, preserving the real 28 living/29 total count. Upgrade extracts retain GUID 58 purchases and the Stage Coach roster-size purchases. Snap-3 also includes the active `plot_crimson_court_2` raid and estate. The source captures remain read-only.

`roster-capacity-rules.json` extracts `roster_size_upgrades` from the installed base and Radiant Stage Coach building JSON files and the `additional.roster_size` bonus from Shieldbreaker's roster additional-variables JSON. Base/New Game+/Bloodmoon use 9/12/16/20/24/28, Radiant uses 9/12/16/21/25/30, and Shieldbreaker adds one. Runtime code reads the installed files; the fixture supplies deterministic tests.

These fixtures prove the requested JSON mutations, safety guards and Discard behavior. They do not prove game acceptance of editor revival or minimal abandon. Those remain pending in-game verification.
