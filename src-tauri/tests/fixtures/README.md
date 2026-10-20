# Profile fixture

`profile_0/` is the owner-approved copy of the pristine 2026-10-19 22:07:12 save, including its raid subfolder and the game's own backup. Tests copy it into unique temporary directories and never modify the fixture or the original save.

`upgrade-names.json` contains only the resolved upgrade tree identifiers referenced by this profile, extracted from the existing decoded `pristine_fixednames/persist.upgrades.json` reference. Tests do not need an installed game or the owner's paths.

No-edit encoding is compared against a direct ddsavelib binary round trip. The library clears bit 31 in field-info words and zeroes alignment padding. Game acceptance of that existing normalization is not asserted by these tests.

Editor backups now record their canonical source profile path in `.hamlet-backup.json`. Old backups without a manifest remain listed for matching `profile_N` IDs; their source account/location cannot be established. Restore of a complete editor backup deletes absent relative save paths only when their filename appears in the backup's save-file set. Other filenames and unrelated files are retained. Legacy and game backups are partial snapshots, so restoring them does not delete profile files. Game restores also ignore stale top-level raid/map files.

Transactions sync replacement files, retain originals while applying all changes, and roll back on reported I/O errors. Multi-file replacement cannot be atomic across a power loss. If the filesystem also refuses rollback, the error reports the retained recovery directory.

Frontend dismissal regression data in `../../../tests/fixtures/dismiss-reference.json` is the complete clean decoded roster, town, upgrades, game, campaign log and progression from this same pristine save. GUID 36 is absent from roster and purchases but retains four campaign-log references. The former raid heroes (96, 34, 1, 48) all have `roster.before_on_start_town_visit_status: 1`; current statuses are 0 or 2 after the town visit. Tests inject current status 1 to check reset of expedition heroes omitted from the party. `last_party_guids` uses four fixed slots `[1,48,34,-1]`, with `-1` marking an empty slot; dismissal replaces the GUID with `-1` and preserves all four slots through binary save/reload. The decoded estate trinket store has contiguous numeric keys `0` through `81`, with every entry shaped `{id, type: "trinket", amount: 1}`. Dismissal tests use these verified entries when returning equipment to storage.
