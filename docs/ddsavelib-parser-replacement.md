# ddsavelib Parser Replacement Plan

## Status: Deferred (post v0.3.0)

## Goal
Replace the hand-rolled JSON parser in ddsavelib with a serde_json-based implementation while maintaining 100% compatibility with DD1 save files.

## Why
- The hand-rolled parser is 1,000+ lines of custom lexer/parser code
- It has known bugs (trailing comma with `allow_dupes=false`)
- serde_json is better maintained, handles `\\` and `\uXXXX` escapes, and is the Rust standard
- The bridge pattern (v0.3.0) works but adds an unnecessary serialization round-trip

## Why It's High Risk
The hand-rolled parser handles 5 DD-specific quirks that serde_json doesn't support natively:

1. **Duplicate keys** — `persist.progression.json` has duplicate field names. Hand-rolled parser keeps all. serde_json drops duplicates.
2. **`###` prefix** — Strings starting with `###` are re-hashed to integers during read. Only applies to Int and IntVector fields.
3. **`hardcoded_type` dispatch** — 57-entry ancestor-path-based type table resolves ambiguous 4-byte fields (Int vs Float). Requires name-stack tracking during parse.
4. **`raw_data` / `static_save` recursion** — Two field names trigger nested DSON file parsing.
5. **`__revision_dont_touch`** — Must appear exactly once, positionally flexible (before or after root field).

## Approach: Test-Driven Replacement

### Phase 1: Build Golden Test Suite
- Copy real DD1 save files from the user's game installation as test fixtures
- For each file: binary → JSON (via current parser) → capture as "golden" output
- Round-trip tests: binary → JSON → binary → JSON → compare both JSONs
- Specific quirk tests:
  - `persist.progression.json` — verify duplicate keys are preserved
  - Files with `###` prefixed strings — verify re-hashing produces correct integers
  - `persist.roster.json` — verify `raw_data` recursion works (hero embedded DSON)
  - All files — verify `__revision_dont_touch` is preserved
  - Files touching all 57 hardcoded type entries — verify type inference matches
- These tests define the contract and pass against the current parser

### Phase 2: Build New Parser (alongside old one)
- New module: `file/json_serde.rs` (parallel to existing `file/json.rs`)
- Uses `serde_json::Value` as the intermediate representation
- Custom handling for each quirk:
  - Duplicate keys: use `Vec<(String, Value)>` or `IndexMap` with append semantics
  - `###` prefix: post-processing walk with ancestor-path context
  - `hardcoded_type`: replicate the name-stack lookup on the Value tree
  - `raw_data`/`static_save`: detect by key name, recursively encode sub-objects
  - `__revision_dont_touch`: extract before/after root, inject on write
- Run the entire Phase 1 test suite against the new parser
- Iterate until all tests pass

### Phase 3: Swap + Cleanup
- Make new parser the default behind a feature flag
- Keep old parser accessible via `feature = "legacy-parser"`
- Run against real saves in production for a release cycle
- Remove old parser and feature flag after confidence is established

## Estimated Effort
- Phase 1: 1-2 days (test suite creation)
- Phase 2: 2-3 weeks (new parser implementation + iteration)
- Phase 3: 1 day (swap + cleanup)

## Dependencies
- Real DD1 save files for test fixtures (available on dev machine)
- The bridge API (v0.3.0) continues to work as fallback during development

## Decision Criteria
- All golden tests pass on new parser
- Real save files from at least 3 different game states (early game, mid game, endgame with DLC)
- Round-trip binary equality (excluding known bit 31 loss)
- No performance regression on large files (persist.roster.json with 30+ heroes)
