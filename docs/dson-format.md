# DSON Binary Format Specification

> Source: [robojumper/DarkestDungeonSaveEditor/docs/dson.md](https://github.com/robojumper/DarkestDungeonSaveEditor/blob/master/docs/dson.md)

Darkest Dungeon save files use `.json` file extensions but are actually a proprietary binary format called DSON (Darkest Dungeon Serialized Object Notation).

## Basics

- All values are **little-endian**
- Strings are **UTF-8, null-terminated**
- String hash function: `hash = 0; for each byte b in utf8(str): hash = hash * 53 + unsigned(b)`. **All arithmetic is 32-bit signed with wrapping overflow** (Java `int` semantics, Rust `i32::wrapping_mul`/`wrapping_add`). Python or JS implementations must explicitly mask to 32 bits.

## Header (64 bytes)

| Offset | Size | Type | Name              | Description                              |
|--------|------|------|-------------------|------------------------------------------|
| 0      | 4    | Raw  | magicNr           | `01 B1 00 00`                            |
| 4      | 4    | Raw  | revision          | Game build: `00 00 {uint16 LE}`          |
| 8      | 4    | int  | headerLength      | Always 64                                |
| 12     | 4    | int  | zeroes            | 0                                        |
| 16     | 4    | int  | meta1Size         | `numMeta1Entries << 4`                   |
| 20     | 4    | int  | numMeta1Entries   | Number of objects in file                |
| 24     | 4    | int  | meta1Offset       | Always 64 (= headerLength)               |
| 28     | 8    | long | zeroes2           | 0                                        |
| 36     | 8    | long | zeroes3           | 0                                        |
| 44     | 4    | int  | numMeta2Entries   | Number of fields in file                 |
| 48     | 4    | int  | meta2Offset       |                                          |
| 52     | 4    | int  | zeroes4           | 0                                        |
| 56     | 4    | int  | dataLength        |                                          |
| 60     | 4    | int  | dataOffset        |                                          |

## Meta1 Block

One entry per object, 16 bytes each. Starts at `meta1Offset`.

| Size | Type | Name              | Description                                        |
|------|------|-------------------|----------------------------------------------------|
| 4    | int  | parentIndex       | Parent object index into Meta1; -1 for root        |
| 4    | int  | meta2EntryIdx     | Index of this object's own field entry in Meta2    |
| 4    | int  | numDirectChildren | Direct children field count                        |
| 4    | int  | numAllChildren    | All (direct + indirect) children count             |

## Meta2 Block

One entry per field, 12 bytes each. Starts at `meta2Offset`.

| Size | Type | Name     | Description                    |
|------|------|----------|--------------------------------|
| 4    | int  | nameHash | Hash of field name             |
| 4    | int  | offset   | Relative offset from data start|
| 4    | int  | fieldInfo| Bitfield (see below)           |

### fieldInfo Bitfield

| Bits     | Extraction                                    | Description                              |
|----------|-----------------------------------------------|------------------------------------------|
| bit 0    | `fieldInfo & 1`                               | 1 = object, 0 = primitive                |
| bit 1    | `fieldInfo & 2`                               | Unknown/reserved (exists in some files, purpose unknown) |
| bits 2-10| `(fieldInfo >> 2) & 0x1FF`                    | Field name length including null terminator (9-bit) |
| bits 11-30| `(fieldInfo >> 11) & 0xFFFFF`                | Meta1 index if object (20-bit)           |
| bit 31   | `fieldInfo & 0x80000000`                      | Unknown — **must be stripped before any other extraction**: `fieldInfo = fieldInfo & 0x7FFFFFFF` |

## Data Block

Starts at `dataOffset`. Field data is stored sequentially; each field's offset is relative to data block start.

### Alignment

Most types require 4-byte alignment. Padding bytes are inserted between fields as needed:
`padding = ((offset + 3) & !0b11) - offset`

Bool and Char are **unaligned** (no padding).

### Field Types

| Type         | Aligned | Size      | Description                                              |
|--------------|---------|-----------|----------------------------------------------------------|
| Object       | N/A     | 0         | Object name only (no data, children follow)              |
| Bool         | No      | 1         | `false if data == 0x00`                                  |
| Char         | No      | 1         | ASCII character                                          |
| TwoBool      | Yes     | 8         | Two 4-byte integers interpreted as booleans              |
| String       | Yes     | 4 + n     | 4-byte length + null-terminated UTF-8 chars              |
| File         | Yes     | 4 + n     | Embedded DSON file (same as String but parseable as DSON)|
| Int          | Yes     | 4         | 4-byte signed integer                                   |
| Float        | Yes     | 4         | IEEE 754 single-precision float                          |
| IntVector    | Yes     | 4 + (4*n) | 4-byte count + n integers                               |
| StringVector | Yes     | 4 + (n*?) | 4-byte count + n entries of (0-3 alignment pad + 4-byte length + null-term string). Each string is individually 4-byte aligned relative to the StringVector's data start. |
| FloatArray   | Yes     | 4*n       | Arbitrary number of floats (size from field gap)         |
| TwoInt       | Yes     | 8         | Two 4-byte integers                                     |

### Type Inference

The DSON format does **not** encode type information explicitly. Type is inferred using:

1. **Hardcoded field name mappings** — 57 field names are mapped to known types (1 Char, 10 Float, 25 IntVector, 6 StringVector, 4 FloatArray, 1 TwoInt, 10 TwoBool). This is the most reliable method and represents years of community reverse-engineering. The Rust implementation (robojumper) uses ancestor-path patterns with `*` wildcards for suffix/tail matching (e.g., `["actor","buff_group","*","amount"]` → Float). The matching walks the name trace in reverse from the leaf field upward.
2. **Size heuristics** — when the field name is not in the hardcoded table:
   - 1 byte → Bool (Char only for the hardcoded `requirement_code` field)
   - 4 bytes, aligned → Int (vs Float is ambiguous — only hardcoded table can distinguish)
   - 5+ bytes, aligned → String **only if** the 4-byte length prefix + data exactly fills the available space (`len + 4 == aligned_max_len`); otherwise `UnknownField` error
   - 8 bytes → attempts String heuristic first (checks if 4-byte length prefix + data == 8, i.e. a 4-byte string). If the string check fails, returns `UnknownField` error. TwoBool and TwoInt can only be reliably identified via the hardcoded table.
   - 2–3 bytes → **Error** (`UnknownField`)
3. **Embedded file detection** — only two hardcoded field names are recognized: `raw_data` and `static_save`. These are parsed as nested DSON. No general detection by magic number exists in the decoder (intentional design choice to avoid incorrect re-encoding).

### Special Cases

- **"File" fields** contain embedded DSON data. Exactly two field names are recognized: `raw_data` and `static_save`. Detected by exact name match, not by magic number probing.
- **Duplicate fields** — some save files contain duplicate field names within the same object. The parser must handle this.
- **Object stack** — object structure is defined by field order. Objects are pushed/popped from a stack based on child counts tracked in Meta1.
- **Invalid UTF-8** — the game generates field names with bytes outside valid UTF-8 range (e.g., room names like `roo\x80`). The reference Rust implementation does NOT handle this — it returns `Utf8Error`. **Our implementation must handle this gracefully** (use lossy conversion or `Vec<u8>` for field names). This is a known bug in ddsavelib (issue #27).

## JSON Representation Conventions

### `__revision_dont_touch` Field

When writing JSON output, the library inserts a special `__revision_dont_touch` field at the top level that stores the binary header's revision/version number. When reading JSON back, the parser accepts this field either **before or after** the root object field, but it must appear exactly once. This field **must** be preserved for round-trip fidelity.

### `###` Hash Prefix

When using an Unhasher, integer values that match known name hashes are written as `"###name"` strings (e.g., `"###jester"`). When reading JSON back, strings starting with `###` are re-hashed to their integer values. This is used for human-readable field references in decoded output.

**Note**: For our editor's round-trip workflow (decode → edit → re-encode), we do NOT use the Unhasher, so `###` prefixes will not appear.

### Bit 31 in fieldInfo

Two sources of binary round-trip loss:

1. **Bit 31** — stripped during parsing: `field_info & !0x8000_0000`. Lost in both binary→binary and binary→JSON→binary cycles.
2. **Bit 1** — preserved during binary parsing but lost in the JSON representation cycle. When creating field entries from JSON, only the name-length bits are set; bit 1 is never reconstructed.

Both bits have unknown purpose. The game appears to tolerate their absence in re-encoded files.

## Encode/Decode Rules

**Critical**: When decoding a file for later re-encoding:
- Do NOT use a name file (unhasher)
- Do NOT use debug flags
- Failure to follow these rules produces files the game cannot load

## Attribution

Format specification by [robojumper](https://github.com/robojumper), documented as part of [DarkestDungeonSaveEditor](https://github.com/robojumper/DarkestDungeonSaveEditor) (MIT License).
