# ddsavelib Remaining Refactor Work

Tracked against the full plan in `docs/ddsavelib-refactor.md`.
Phases 1 and 2 (vendor, build on stable Rust, dependency modernization) are complete.

---

## Phase 3: Bug Fixes

- [ ] **UTF-8 handling (issue #27)** — game generates field names like `roo\x80`.
  The parser currently calls `CStr::to_str()` which rejects non-UTF-8 bytes.
  Open PR #65 (March 2026) attempts a fix. Solution: switch to a lossy
  conversion or store field names as `Vec<u8>` / `Box<[u8]>` and decode lazily.

- **Binary round-trip fidelity** — two bits in the `fieldInfo` word are lost
  during decoding. Analysis (March 2026, against 16 sample DSON files, 8 122
  fields):

  **Bit 31 (`0x80000000`)**
  Stripped unconditionally in `Fields::try_from_bin`:
  `field_info = raw & !0x8000_0000`. Present in 5.7 % of fields across the
  corpus (464/8122), spread across both object and primitive fields with no
  detectable pattern. The bit is never written back by `write_to_bin`.

  *Feasibility of preserving bit 31*: technically straightforward — store it
  as a `bool` flag in `FieldInfo` (or a separate `u32 extra_bits` field) and
  OR it back on write. The internal `FieldInfo` struct is private, so no public
  API change is required. However the flag's semantics are unknown, and DD1 is
  confirmed to load re-encoded files where the bit is absent, so the practical
  benefit is low. Preserving it would only matter for byte-exact diff testing.
  **Verdict**: defer until a concrete need arises (e.g. binary diffing tools).

  **Bit 1 (`0b10`)**
  Never set in any of the 8 122 fields in the corpus (0 occurrences). The
  `create_field` path in `Fields::create_field` builds `field_info` from name
  length only, so even if a source file had bit 1 set, it would be lost in a
  JSON round-trip. Because bit 1 is absent from all known DD1 save files, the
  loss is currently theoretical only.

  *Feasibility of preserving bit 1*: same approach as bit 31 — store and
  replay. Even lower priority than bit 31 given its total absence in the
  corpus. **Verdict**: no action needed.

  **Practical impact**: DD1 tolerates both bits being absent. Round-trip files
  load and play correctly. The only observable difference is a byte-level
  mismatch between the original and re-encoded binary, which is acceptable for
  a save editor. This item can be closed unless a binary-identical output
  requirement is added.

- **Bool vs Byte ambiguity (issue #3)** — the dynamic type-inference path
  maps any 1-byte field to `FieldType::Bool(byte != 0)`, collapsing multi-byte
  values to `true`. Analysis against the same 16-file corpus (1 750 one-byte
  fields total):

  All 1-byte fields with values outside `{0x00, 0x01}` were `requirement_code`
  (409 occurrences: values `0x30`–`0x32` = ASCII `'0'`/`'1'`/`'2'`,
  `0x61`–`0x63` = `'a'`/`'b'`/`'c'`). This field is already listed in the
  `hardcoded_type` table as `FieldType::Char`, so the Bool path is never
  reached for it.

  **Finding**: in the current corpus there are no 1-byte non-object fields that
  (a) are treated as Bool and (b) carry a value > 1. All byte-range values in
  the corpus are correctly routed through the `Char` hardcode. The Bool-clamp
  issue is therefore latent but not currently triggered by any known DD1 save
  field. If modded saves introduce new single-byte fields with arbitrary values,
  those would be clamped; extending `hardcoded_type` is the correct fix when
  such fields are identified.

  **Action**: no immediate code change. Document in `hardcoded_type` that `Char`
  is currently the only 1-byte non-Bool type and that new entries should be
  added if byte-range fields emerge from mod/DLC data.

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
