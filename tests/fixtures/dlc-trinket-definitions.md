# DLC trinket fixture

Read-only extracts from the installed Darkest Dungeon data on 2026-10-20. JSON keys preserve the installed relative paths beneath the data root. Crimson Court contains the full `cc_set_pd_codex_of_plagues` definition; Flagellant contains the full `flag_1` definition. Rust tests recreate this layout in a temporary directory and exercise the production loader. JavaScript tests apply the exposed definition fields to the shared equip guard. No game or save files were written.
