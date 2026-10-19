# UX changelog

User-facing behaviour changes made during the 2026 bug-hunting pass, so each
can be reviewed or reverted on its own. Revert an entry with
`git revert <commit>`.

| Date | Change | Why | Commit |
| --- | --- | --- | --- |
| 2026-10-19 | Removed the "Steam Cloud Active" header badge and the path-based cloud callout in the setup wizard. Replaced them with a static note in the wizard's save-folder step and a Steam Cloud section in the README. | Owner request: the detection was a heuristic (any `userdata` path) that was not worth maintaining. | (this commit) |
