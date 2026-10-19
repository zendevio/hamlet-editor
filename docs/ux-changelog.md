# UX changelog

User-facing behaviour changes made during the 2026 bug-hunting pass, so each
can be reviewed or reverted on its own. Revert an entry with
`git revert <commit>`.

| Date | Change | Why | Commit |
| --- | --- | --- | --- |
| 2026-10-19 | Removed the "Steam Cloud Active" header badge and the path-based cloud callout in the setup wizard. Replaced them with a static note in the wizard's save-folder step and a Steam Cloud section in the README. | Owner request: the detection was a heuristic (any `userdata` path) that was not worth maintaining. | dd578b4 |
| 2026-10-19 | Raid torchlight and hunger use the saved fields; scouting control removed; abandoning returns living party members to town and can be discarded before saving. Districts list existing Crimson Court entries with their saved built state. | Prevent invalid raid fields, stale party status and invented district records. | pending |
| 2026-10-19 | Wallet, invitations, blood and blueprints accept only whole amounts from 0 to 2147483647 and display inline errors; missing entries are created with verified types. Hero names trim surrounding spaces, use an editor limit of 32 Unicode characters, and reject controls and invisible formatting. Living heroes cannot be edited below 1 HP. | Prevent invalid values and unsafe names from reaching save data. | pending |
| 2026-10-19 | Dismissal explains and blocks treatment, party, upgrade and other save references. Revival, including batch revival, is unavailable until a complete dead-hero transition is verified. Crimson Curse stages can only replace one existing stage through the curse selector. | Preserve references and prevent partial revival or new curse injection. | pending |
| 2026-10-19 | Switching profiles or save/game paths with edits asks Save, Discard or Cancel. Save & Close uses normal validation, save blocks and optional auto-backup. A failed auto-backup aborts saving and keeps edits. | Prevent silent edit loss and ensure close/switch flows honor the same save protections. | pending |
