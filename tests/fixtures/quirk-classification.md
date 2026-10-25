# Fallback quirk classification extract

`quirk-classification.json` contains only `id`, `is_positive` and `is_disease`
from the installed game libraries, read on 2026-10-25:

- `shared/quirk/quirk_library.json`
- `dlc/580100_crimson_court/features/crimson_court/shared/quirk/crimson_court.quirk_library.json`
- `dlc/735730_color_of_madness/shared/quirk/com.quirk_library.json`

There are 213 unique IDs. Rows are sorted by ID. Missing boolean flags are
normalized to false. Disease takes precedence over positive, then negative is
the default. The fallback arrays in `src/lib/data/quirks.ts` were regenerated
from the same extract. `tests/quirks.test.mjs` compares their full ID/category
catalogue to this fixture, including the absence of invented IDs.

## Regenerating

Run this from the repository root with the game's data root (the `gamePath`
shown in the editor's Settings), then update the arrays in
`src/lib/data/quirks.ts` to match and run `pnpm test`:

```sh
python3 - "<game data root>" > tests/fixtures/quirk-classification.json <<'PY'
import json, sys, pathlib
root = pathlib.Path(sys.argv[1])
libs = ["shared/quirk/quirk_library.json",
        "dlc/580100_crimson_court/features/crimson_court/shared/quirk/crimson_court.quirk_library.json",
        "dlc/735730_color_of_madness/shared/quirk/com.quirk_library.json"]
rows = {}
for lib in libs:
    for q in json.loads((root / lib).read_text())["quirks"]:
        rows[q["id"]] = {"id": q["id"], "is_positive": bool(q.get("is_positive", False)),
                         "is_disease": bool(q.get("is_disease", False))}
print(json.dumps(sorted(rows.values(), key=lambda r: r["id"]), indent=2))
PY
```
