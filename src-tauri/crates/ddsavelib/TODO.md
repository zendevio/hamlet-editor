# ddsavelib Remaining Refactor Work

Tracked against the full plan in `docs/ddsavelib-refactor.md`.
Phases 1 and 2 (vendor, build on stable Rust, dependency modernization) are complete.

---

## Phase 3: Bug Fixes

- [ ] **UTF-8 handling (issue #27)** — game generates field names like `roo\x80`.
  The parser currently calls `CStr::to_str()` which rejects non-UTF-8 bytes.
  Open PR #65 (March 2026) attempts a fix. Solution: switch to a lossy
  conversion or store field names as `Vec<u8>` / `Box<[u8]>` and decode lazily.

- [ ] **Binary round-trip fidelity** — the encode/decode cycle is not bit-perfect;
  some metadata bits are silently dropped during `try_from_bin` and not
  restored by `write_to_bin`. Investigate which header/padding bytes are
  affected and whether they can be preserved as opaque blobs.

- [ ] **Bool vs Byte ambiguity (issue #3)** — `FieldType::Bool` is used for values
  that the game actually treats as arbitrary single bytes. Determine the correct
  heuristic (or extend `hardcoded_type` mappings) so these fields survive a
  round-trip without being clamped to 0/1.

---

## Phase 4: API Modernization — serde_json Migration

Replace the hand-rolled JSON parser (`file/json/json_parser.rs`) with
`serde_json`. The following 13 concerns must each be addressed:

1. **`###` prefix (hashed integers)** — string values beginning with `###` encode
   a pre-hashed integer. Must post-process: detect prefix, call `name_hash()`,
   store as `FieldType::Int`.

2. **`__revision_dont_touch`** — mandatory root field; must be accepted in first
   OR last position. Enforce presence and reject if missing.

3. **Duplicate keys** — `serde_json`'s `HashMap` drops duplicates (last wins).
   Must use a custom deserializer / `IndexMap` variant that retains all entries.

4. **`hardcoded_type` dispatch** — type selection depends on the current
   ancestor-name stack, not just the leaf key. Must reimplement name-stack
   tracking during deserialization.

5. **`raw_data` / `static_save` nesting** — these field names trigger a recursive
   `File` parse of the nested object. Must special-case these names during
   deserialization.

6. **`null` values** — current parser rejects `null`. Decide policy: reject,
   map to a sentinel value, or add a new `FieldType::Null` variant.

7. **`Char` constraint (single ASCII byte)** — must validate after deserialization
   that `FieldType::Char` values are exactly one ASCII byte.

8. **`f32` formatting on write** — `serde_json` uses `ryu` / `f64` internally and
   may produce different decimal representations than the current `dtoa`-based
   writer. Verify round-trip equality for all float fields.

9. **Field separator** — current writer emits `" : "` (space-colon-space);
   `serde_json` emits `": "`. Cosmetic, but breaks byte-level diff comparisons.
   Decide whether to normalize or preserve the original style.

10. **`\\` backslash escape** — `unescape()` in `util.rs` is currently broken and
    does not handle `\\`. Migrating to `serde_json` fixes this as a side effect;
    verify no other callers depend on the broken behavior.

11. **`\uXXXX` unicode escapes** — not supported by the current parser. `serde_json`
    adds support automatically; verify no existing save files rely on absence of
    this feature.

12. **TwoInt unhashing** — the current writer intentionally does NOT unhash
    `FieldType::TwoInt` values (only `Int` and `IntVector` are unhashed).
    Preserve this asymmetry explicitly in the new writer.

13. **`thiserror` for error types** — current `FromBinError` and `FromJsonError`
    implement `Display` by delegating to `Debug`, which is not human-friendly.
    Replace with `#[derive(thiserror::Error)]` and proper `Display` messages.

---

## Phase 5: Quality

- [ ] **Tests with real save files** — add integration tests that load actual
  `persist.*.json` / binary DSON files from `.reference/` and assert
  round-trip correctness for each. Cover edge cases: duplicate keys,
  embedded `raw_data` files, non-UTF-8 field names.

- [ ] **Fuzz targets** — the existing fuzz target references `fuzz_target_1.rs`
  but the actual file is `fuzz_target_bin.rs` (stale `fuzz/Cargo.toml`).
  Fix the reference, add a second target for the JSON path, and add a
  round-trip target (binary → JSON → binary → compare).

- [ ] **API documentation** — add `///` doc comments to all public items:
  `File`, `Unhasher`, `name_hash`, `FromBinError`, `FromJsonError`,
  and the four encode/decode methods. Include at least one example per method.

- [ ] **Verify round-trip integrity** — run the full encode/decode cycle against
  a corpus of save files from multiple DD1 versions (base game, Crimson Court,
  Shieldbreaker, Color of Madness) and confirm zero data loss.
