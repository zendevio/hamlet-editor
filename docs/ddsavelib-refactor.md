# ddsavelib Refactor Plan

## Decision

Vendor the `ddsavelib` Rust crate (~2,400 lines across 7 .rs files) into our repo and modernize the code while preserving the battle-tested format logic.

## Why Vendor + Modernize (Not Rewrite)

- **No alternatives exist** — ddsavelib is the only Rust DSON implementation
- **Battle-tested** — used by the DD community for 6+ years, fuzz-tested
- **57 hardcoded field-to-type mappings** — irreplaceable community reverse-engineering
- **Rewrite risk** — 2-4 weeks effort with significant correctness risk
- **Stale crate** — crates.io version is from 2020, repo has newer fixes not published

## Source

- **Crate**: https://crates.io/crates/ddsavelib (v0.1.1, 2020-07-20)
- **Source**: https://github.com/robojumper/DarkestDungeonSaveEditor/tree/master/rust/ddsaveedit/ddsavelib
- **License**: MIT OR Apache-2.0
- **Author**: robojumper
- **Local reference**: `.reference/DarkestDungeonSaveEditor/rust/ddsaveedit/ddsavelib/`

## Current State

### File Structure (7 .rs files, ~2,400 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `lib.rs` | 61 | Re-exports `File`, `Unhasher`, `name_hash`. Uses `#![feature(once_cell)]` and `#![feature(try_reserve)]` (nightly gates) |
| `file/mod.rs` | 499 | Core data structures: Header, Objects, Fields, Data, FieldType enum. Contains `hardcoded_type()` with 57 mappings |
| `file/bin.rs` | 650 | Binary serialization/deserialization |
| `file/json.rs` | 541 | JSON read/write (handles `__revision_dont_touch` and `###` hash prefix convention) |
| `file/json/json_parser.rs` | 457 | Hand-written JSON lexer/parser |
| `err.rs` | 121 | `FromBinError` and `FromJsonError` error types |
| `util.rs` | 71 | `name_hash()`, string escape/unescape utilities |

### Current API

```rust
// Decode binary DSON (takes reader by value — callers can pass &mut reader)
File::try_from_bin<R: Read>(mut reader: R) -> Result<File, FromBinError>

// Decode JSON (takes reader by value)
File::try_from_json<R: Read>(mut reader: R) -> Result<File, FromJsonError>

// Encode to binary DSON (takes &mut writer — the only method that borrows)
File::write_to_bin<W: Write>(&self, writer: &mut W) -> Result<(), io::Error>

// Encode to JSON (takes writer by value, not &mut)
File::write_to_json<T: AsRef<str>, W: Write>(&self, mut writer: W, allow_dupes: bool, unhasher: &Unhasher<T>) -> Result<(), io::Error>

// Hash utility
name_hash(s: &str) -> i32

// Name resolution (Unhasher<T: AsRef<str>> — generic)
Unhasher::<T>::new() -> Self              // available on any T
Unhasher::<&str>::empty() -> Self         // shorthand for &str specialization
Unhasher::offer_name(&mut self, name: T)  // register one name
Unhasher::offer_names(&mut self, names: impl IntoIterator<Item = T>) // register many
```

### Current Dependencies (Cargo.toml)

| Crate | Version | Status |
|-------|---------|--------|
| `byteorder` | ^1.3.4 | OK — still current |
| `itoa` | ^0.4.5 | **Outdated** — current is 1.x |
| `dtoa` | ^0.4.5 | **Outdated** — superseded by `ryu` |
| `string_cache` | ^0.8.0 | Optional, for string interning |

### Nightly Feature Gates

The code uses two Rust nightly features via `#![feature(...)]`:

| Feature | Stable Since | Migration |
|---------|-------------|-----------|
| `once_cell` | Rust 1.80 (`std::sync::LazyLock`) | Replace `std::lazy::SyncLazy` → `std::sync::LazyLock` |
| `try_reserve` | Rust 1.57 | Simply remove the feature gate; `try_reserve_exact` is stable |

**Getting off nightly is a higher priority than the edition upgrade.** The code currently requires `rustc nightly` to compile.

### Known Issues

1. **Invalid UTF-8 field names** (issue #27) — game generates names like `roo\x80`. Parser uses `CStr::to_str()` which rejects non-UTF-8. Open PR #65 (March 2026) attempts to fix.
2. **Binary round-trip is not bit-perfect** — some metadata bits are lost during decode/encode cycle.
3. **Bool vs Byte ambiguity** (issue #3) — some "booleans" may be arbitrary bytes.
4. **Hardcoded type list is incomplete** — unknown field names fall back to size heuristics which can misidentify types.
5. **Requires Rust nightly** — two `#![feature(...)]` gates prevent compilation on stable Rust. Also uses Rust 2018 edition (not 2021).
6. **`unescape()` backslash bug** — `\\` escape sequence is not handled in `util.rs`. Strings containing literal backslashes cannot round-trip through JSON. The `escape()` function correctly produces `\\` but `unescape()` rejects it (returns `None`).
7. **`allow_dupes=false` trailing comma bug** — when the last child field is a duplicate that gets skipped, the preceding field gets a trailing comma before `}`, producing invalid JSON.
8. **Fuzz target stale reference** — `fuzz/Cargo.toml` references `fuzz_target_1.rs` but the actual file is `fuzz_target_bin.rs`.

### Strengths to Preserve

- No `unsafe` code
- Proper error handling with typed errors (no panics)
- Fuzz testing targets
- Round-trip tests (binary → JSON → binary)
- Checked arithmetic throughout (`checked_add`, `checked_mul`)
- Memory allocation guards (`try_reserve_exact`)
- Clean separation: binary format / JSON format / internal representation
- **The hardcoded type table** — most valuable asset

## Modernization Plan

### Phase 1: Vendor and Build
- [ ] Copy source into `src-tauri/crates/ddsavelib/`
- [ ] Remove `#![feature(try_reserve)]` gate (stable since Rust 1.57)
- [ ] Remove `#![feature(once_cell)]` gate; migrate `std::lazy::SyncLazy` → `std::sync::LazyLock` (stable since Rust 1.80)
- [ ] Verify it builds on **stable** Rust
- [ ] Update `Cargo.toml` to Rust 2021 edition
- [ ] Verify tests pass
- [ ] Add as local dependency in main `src-tauri/Cargo.toml`

### Phase 2: Dependency Modernization
- [ ] Replace `dtoa` 0.4 → `ryu`
- [ ] Update `itoa` 0.4 → `itoa` 1.x
- [ ] Evaluate if `string_cache` is still needed
- [ ] Update `byteorder` if newer version available

### Phase 3: Bug Fixes
- [ ] Fix UTF-8 handling (support non-UTF-8 field names gracefully)
- [ ] Investigate binary round-trip fidelity — can we preserve unknown bits?
- [ ] Review Bool vs Byte handling

### Phase 4: API Modernization
- [ ] Replace hand-rolled JSON parser with `serde_json` (see migration concerns below)
- [ ] Add `thiserror` for error types (current `Display` delegates to `Debug` — not human-friendly)
- [ ] Expose `serde_json::Value` API for Tauri integration
- [ ] Add convenience methods: `decode_to_json(path) -> serde_json::Value`, `encode_from_json(path, value)`
- [ ] Consider typed accessors for common save sections (roster, estate)
- [ ] Handle `FieldType::File(Option<Box<File>>)` for embedded DSON in serde_json mapping

### serde_json Migration Concerns

The hand-rolled JSON parser has behaviors that serde_json does NOT replicate:

| Concern | Action Required |
|---------|----------------|
| `###` prefix (hashed integers) | Custom post-processing: check string values for `###` prefix, call `name_hash()` |
| `__revision_dont_touch` | Custom mandatory-field logic; must accept in first or last position in root |
| Duplicate keys | serde_json's HashMap drops duplicates (last wins). Must use custom collector to retain all. |
| `hardcoded_type` dispatch | Must reimplement as custom logic with name-stack tracking |
| `raw_data` / `static_save` nesting | Special-case name check triggering recursive `File` parse |
| `null` values | Current parser rejects `null`. Decide policy for serde_json. |
| `Char` constraint (single ASCII byte) | Enforce after deserialization |
| `f32` formatting on write | serde_json uses `ryu`/`f64` — may produce different decimal representations |
| Field separator | Current: `" : "` (space-colon-space). serde_json: `": "`. Cosmetic but affects byte comparison. |
| `\\` backslash escape | **Current parser is BROKEN** — `unescape()` doesn't handle `\\`. serde_json fixes this. |
| `\uXXXX` unicode escapes | Not supported by current parser. serde_json adds support. |
| TwoInt unhashing | Current writer does NOT unhash TwoInt values (only Int and IntVector). Preserve this. |

### Phase 5: Quality
- [ ] Add comprehensive tests with real save files
- [ ] Port/update fuzz targets
- [ ] Document public API
- [ ] Verify round-trip integrity with multiple save files

## Analysis Passes Required Before Refactoring

Before touching any code, we need deep analysis of:

1. **Full source code audit** — read every file, understand every function
2. **Hardcoded type table** — document all 57 mappings, cross-reference with game data. Note: Rust version has more Float entries (10) than Java (5)
3. **Type inference heuristics** — understand exactly how ambiguous types are resolved
4. **JSON parser internals** — understand what serde_json replacement needs to handle (hash-prefixed strings, `__revision_dont_touch`, duplicate fields)
5. **Binary format edge cases** — alignment, embedded files, duplicate fields
6. **Test coverage** — what's tested, what's not, where are the gaps

## Name Hash Generation

The Java editor includes a comprehensive game data scanner (`ReadNames.java`) that builds the name hash table by parsing 15 file types from the game installation. This produces ~3,273 names from the base game.

### File Patterns Scanned

| File Pattern | What is Extracted |
|---|---|
| `*.info.darkest` | Base filename (class names) |
| `*.upgrades.json` | Base filename + upgrade tree IDs |
| `*.camping_skills.json` | Skill IDs + class.skill cross products |
| `*.dungeon.json` | Base filename |
| `*.types.json` | Quest type IDs and goal IDs |
| `quirk_library.json` | Quirk IDs |
| `*.building.json` | Base filename + activity IDs |
| `*.events.json` | Base filename + event IDs |
| `*.inventory.items.darkest` | Item type and ID via regex |
| `*.inventory.system_configs.darkest` | Same regex as above |
| `*.trinkets.json` | Trinket IDs |
| `curio_props.csv` | First column (prop names) |
| `obstacle_definitions.json` | Obstacle names |
| `quest.plot_quests.json` | Plot quest IDs |
| `*.png` | Names from `tutorial_popup.<name>.png` pattern |

### Hardcoded Names (always added)

```
MONSTER_ENCOUNTERED, AMBUSHED, CURIO_INVESTIGATED, TRAIT_APPLIED,
DEATHS_DOOR_APPLIED, ROOM_VISITED, BATTLE_COMPLETED,
HALLWAY_STEP_COMPLETED, MONSTER_DEFEATED, UNDEFINED
```

Our refactored ddsavelib should include this name generation capability, scanning both the game data directory and mod directories.

## Reference Implementations Analyzed

### Tormak9970/Darkest-Dungeon-Save-Editor (Tauri 1 + Svelte 3)
- DSON parsing entirely in TypeScript (not Rust) — performance issues
- Has confirmed bugs: parseFloat assigns wrong type, StringVector alignment broken, JS integer overflow in hash
- Good patterns: ancestor-path wildcards for type matching, name generation from game data
- No cross-file consistency checks, no auto-detection, no semantic editing

### NoleHealth/ForkDarkestDungeonSaveEditor
- Byte-for-byte identical to the original — no functional additions

### thanhnguyen2187/darkest-savior (Go CLI)
- Minimal implementation, useful test data (sample DSON binaries)
- Confirmed `persist.progression.json` has duplicate DSON keys

## Attribution

Credit [robojumper](https://github.com/robojumper) for:
- Original ddsavelib implementation (MIT License)
- DSON format reverse-engineering and documentation
- DarkestDungeonSaveEditor (Java reference implementation)
