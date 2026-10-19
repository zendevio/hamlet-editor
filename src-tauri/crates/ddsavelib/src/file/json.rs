use std::io::{Read, Write};

use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};

use super::{hardcoded_type, FieldIdx, FieldInfo, FieldType, File, NameType, ObjIdx, Unhasher};
use crate::err::FromJsonError;
use crate::util::{escape, name_hash};

const BUILTIN_VERSION_FIELD: &str = "__revision_dont_touch";

// ===========================================================================
// Reading
// ===========================================================================

// ---------------------------------------------------------------------------
// Helper: convert a FromJsonError into a serde::de::Error
// ---------------------------------------------------------------------------

fn from_json_to_serde<E: de::Error>(e: FromJsonError) -> E {
    E::custom(e.to_string())
}

// ---------------------------------------------------------------------------
// Shared core: infer a leaf FieldType from a serde_json::Value
// ---------------------------------------------------------------------------

fn infer_type_from_value(
    name: &str,
    value: &serde_json::Value,
    name_stack: &[NameType],
) -> Result<FieldType, FromJsonError> {
    if value
        .as_str()
        .is_some_and(|s| s.chars().any(char::is_control))
    {
        return Err(FromJsonError::InvalidValue(
            "strings cannot contain control characters or NUL".into(),
        ));
    }
    if let Some(mut hc) = hardcoded_type(name_stack, name) {
        match &mut hc {
            FieldType::Float(ref mut f) => {
                let n = value.as_f64().ok_or_else(|| {
                    FromJsonError::LiteralFormat("expected float".to_owned(), 0, 0)
                })?;
                *f = n as f32;
            }
            FieldType::Char(ref mut c) => {
                let s = value.as_str().ok_or_else(|| {
                    FromJsonError::LiteralFormat("expected char string".to_owned(), 0, 0)
                })?;
                let bytes = s.as_bytes();
                if bytes.len() == 1 && bytes[0].is_ascii() {
                    *c = bytes[0] as char;
                } else {
                    return Err(FromJsonError::LiteralFormat(
                        "expected exactly one ascii char".to_owned(),
                        0,
                        0,
                    ));
                }
            }
            FieldType::IntVector(ref mut v) => {
                let arr = value.as_array().ok_or_else(|| {
                    FromJsonError::LiteralFormat("expected array for IntVector".to_owned(), 0, 0)
                })?;
                let mut tmp = Vec::with_capacity(arr.len());
                for elem in arr {
                    if let Some(s) = elem.as_str() {
                        if s.chars().any(char::is_control) {
                            return Err(FromJsonError::InvalidValue(
                                "strings cannot contain control characters or NUL".into(),
                            ));
                        }
                        if let Some(rest) = s.strip_prefix("###") {
                            tmp.push(name_hash(rest));
                            continue;
                        }
                    }
                    let i = elem
                        .as_i64()
                        .ok_or_else(|| {
                            FromJsonError::LiteralFormat(
                                "expected integer in IntVector".to_owned(),
                                0,
                                0,
                            )
                        })
                        .and_then(|n| i32::try_from(n).map_err(Into::into))?;
                    tmp.push(i);
                }
                *v = tmp.into_boxed_slice();
            }
            FieldType::StringVector(ref mut v) => {
                let arr = value.as_array().ok_or_else(|| {
                    FromJsonError::LiteralFormat("expected array for StringVector".to_owned(), 0, 0)
                })?;
                let mut tmp = Vec::with_capacity(arr.len());
                for elem in arr {
                    let s = elem.as_str().ok_or_else(|| {
                        FromJsonError::LiteralFormat(
                            "expected string in StringVector".to_owned(),
                            0,
                            0,
                        )
                    })?;
                    tmp.push(s.to_owned());
                }
                *v = tmp.into_boxed_slice();
            }
            FieldType::FloatArray(ref mut v) => {
                let arr = value.as_array().ok_or_else(|| {
                    FromJsonError::LiteralFormat("expected array for FloatArray".to_owned(), 0, 0)
                })?;
                let mut tmp = Vec::with_capacity(arr.len());
                for elem in arr {
                    let f = elem.as_f64().ok_or_else(|| {
                        FromJsonError::LiteralFormat(
                            "expected float in FloatArray".to_owned(),
                            0,
                            0,
                        )
                    })?;
                    tmp.push(f as f32);
                }
                *v = tmp.into_boxed_slice();
            }
            FieldType::TwoInt(ref mut i1, ref mut i2) => {
                let arr = value.as_array().ok_or_else(|| {
                    FromJsonError::LiteralFormat("expected array for TwoInt".to_owned(), 0, 0)
                })?;
                if arr.len() != 2 {
                    return Err(FromJsonError::LiteralFormat(
                        "TwoInt requires exactly 2 elements".to_owned(),
                        0,
                        0,
                    ));
                }
                *i1 = arr[0]
                    .as_i64()
                    .ok_or_else(|| {
                        FromJsonError::LiteralFormat("expected i32 in TwoInt".to_owned(), 0, 0)
                    })
                    .and_then(|n| i32::try_from(n).map_err(Into::into))?;
                *i2 = arr[1]
                    .as_i64()
                    .ok_or_else(|| {
                        FromJsonError::LiteralFormat("expected i32 in TwoInt".to_owned(), 0, 0)
                    })
                    .and_then(|n| i32::try_from(n).map_err(Into::into))?;
            }
            FieldType::TwoBool(ref mut b1, ref mut b2) => {
                let arr = value.as_array().ok_or_else(|| {
                    FromJsonError::LiteralFormat("expected array for TwoBool".to_owned(), 0, 0)
                })?;
                if arr.len() != 2 {
                    return Err(FromJsonError::LiteralFormat(
                        "TwoBool requires exactly 2 elements".to_owned(),
                        0,
                        0,
                    ));
                }
                *b1 = arr[0].as_bool().ok_or_else(|| {
                    FromJsonError::LiteralFormat("expected bool in TwoBool".to_owned(), 0, 0)
                })?;
                *b2 = arr[1].as_bool().ok_or_else(|| {
                    FromJsonError::LiteralFormat("expected bool in TwoBool".to_owned(), 0, 0)
                })?;
            }
            _ => {
                return Err(FromJsonError::LiteralFormat(
                    "unhandled hardcoded field type".to_owned(),
                    0,
                    0,
                ))
            }
        }
        return Ok(hc);
    }

    // Heuristic fallback
    match value {
        serde_json::Value::Bool(b) => Ok(FieldType::Bool(*b)),
        serde_json::Value::Number(n) => {
            if n.is_f64() && !n.is_i64() && !n.is_u64() {
                return Err(FromJsonError::LiteralFormat(
                    "non-hardcoded float fields are not allowed".to_owned(),
                    0,
                    0,
                ));
            }
            let i = n
                .as_i64()
                .ok_or_else(|| FromJsonError::LiteralFormat("expected integer".to_owned(), 0, 0))
                .and_then(|v| i32::try_from(v).map_err(Into::into))?;
            Ok(FieldType::Int(i))
        }
        serde_json::Value::String(s) => {
            if let Some(rest) = s.strip_prefix("###") {
                Ok(FieldType::Int(name_hash(rest)))
            } else {
                Ok(FieldType::String(s.clone().into_boxed_str()))
            }
        }
        serde_json::Value::Array(_) => Err(FromJsonError::LiteralFormat(
            "arrays only allowed for hardcoded field types".to_owned(),
            0,
            0,
        )),
        serde_json::Value::Null => Err(FromJsonError::LiteralFormat(
            "null values are not supported".to_owned(),
            0,
            0,
        )),
        serde_json::Value::Object(_) => Err(FromJsonError::LiteralFormat(
            "unexpected object in leaf context".to_owned(),
            0,
            0,
        )),
    }
}

// ---------------------------------------------------------------------------
// Value tree walker (used by from_json_value)
// ---------------------------------------------------------------------------

fn walk_field_value(
    file: &mut File,
    name: &str,
    value: &serde_json::Value,
    parent: Option<ObjIdx>,
    name_stack: &mut Vec<NameType>,
) -> Result<FieldIdx, FromJsonError> {
    let name_type = NameType::from(name);
    let field_idx = file.f.create_field(name).ok_or(FromJsonError::IntegerErr)?;

    match value {
        serde_json::Value::Object(map) => {
            if name == "raw_data" || name == "static_save" {
                let inner = build_file_from_map_value(map)?;
                file.dat
                    .create_data(name_type, parent, FieldType::File(Some(Box::new(inner))));
            } else {
                file.dat
                    .create_data(name_type.clone(), parent, FieldType::Object(Box::new([])));
                let obj_idx = file
                    .o
                    .create_object(field_idx, parent, 0, 0)
                    .ok_or(FromJsonError::IntegerErr)?;
                file.f[field_idx].field_info |= 1;
                file.f[field_idx].field_info |= (obj_idx.numeric() & FieldInfo::OBJ_IDX_BITS) << 11;

                name_stack.push(name_type);
                let mut children = Vec::new();
                for (child_key, child_val) in map.iter() {
                    let child_idx =
                        walk_field_value(file, child_key, child_val, Some(obj_idx), name_stack)?;
                    children.push(child_idx);
                }
                name_stack.pop();

                file.o[obj_idx].num_direct_childs = children.len() as u32;
                file.o[obj_idx].num_all_childs = file.f.len() - 1 - field_idx.numeric();
                if let FieldType::Object(ref mut chl) = file.dat[field_idx].tipe {
                    *chl = children.into_boxed_slice();
                }
            }
        }
        leaf => {
            let field_type = infer_type_from_value(name, leaf, name_stack).map_err(|e| {
                let mut path: Vec<&str> = name_stack.iter().map(|s| s.as_ref()).collect();
                path.push(name);
                FromJsonError::InvalidValue(format!("{}: {e}", path.join(".")))
            })?;
            file.dat.create_data(name_type, parent, field_type);
        }
    }

    Ok(field_idx)
}

fn build_file_from_map_value(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<File, FromJsonError> {
    let mut version: Option<u32> = None;
    let mut root_key: Option<&String> = None;
    let mut root_value: Option<&serde_json::Value> = None;

    for (k, v) in map.iter() {
        if k == BUILTIN_VERSION_FIELD {
            let n = v.as_u64().ok_or_else(|| {
                FromJsonError::LiteralFormat("expected u32 for revision".to_owned(), 0, 0)
            })?;
            version = Some(u32::try_from(n).map_err(|_| FromJsonError::IntegerErr)?);
        } else {
            root_key = Some(k);
            root_value = Some(v);
        }
    }

    let version =
        version.ok_or_else(|| FromJsonError::Expected(BUILTIN_VERSION_FIELD.to_owned(), 0, 0))?;
    let root_key =
        root_key.ok_or_else(|| FromJsonError::Expected("root field".to_owned(), 0, 0))?;
    let root_value = root_value.unwrap();

    let mut file = File::default();
    let mut name_stack = Vec::new();
    walk_field_value(&mut file, root_key, root_value, None, &mut name_stack)?;

    let data_size = file.fixup_offsets()?;
    file.h
        .fixup_header(file.o.len(), file.f.len(), version, data_size)
        .ok_or(FromJsonError::ArithError)?;

    Ok(file)
}

// ---------------------------------------------------------------------------
// Streaming serde Visitor (used by try_from_json, preserves duplicate keys)
// ---------------------------------------------------------------------------

struct TopLevelSeed<'a> {
    merging: bool,
    original: Option<&'a serde_json::Value>,
}

impl<'de> DeserializeSeed<'de> for TopLevelSeed<'_> {
    type Value = File;

    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_map(TopLevelVisitor {
            merging: self.merging,
            original: self.original,
        })
    }
}

struct TopLevelVisitor<'a> {
    merging: bool,
    original: Option<&'a serde_json::Value>,
}

impl<'de> Visitor<'de> for TopLevelVisitor<'_> {
    type Value = File;

    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DSON top-level object with __revision_dont_touch and root field")
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Self::Value, A::Error> {
        build_file_from_map_access(map, self.merging, self.original)
    }
}

fn build_file_from_map_access<'de, A: MapAccess<'de>>(
    mut map: A,
    merging: bool,
    original: Option<&serde_json::Value>,
) -> Result<File, A::Error> {
    let mut version: Option<u32> = None;
    let mut file = File::default();
    let mut root_processed = false;
    let mut name_stack: Vec<NameType> = Vec::new();

    while let Some(key) = map.next_key::<String>()? {
        if key == BUILTIN_VERSION_FIELD {
            version = Some(map.next_value::<u32>()?);
        } else {
            let seed = FieldValueSeed {
                file: &mut file,
                merging,
                original: original.and_then(|value| value.get(&key)),
                name: key,
                parent: None,
                name_stack: &mut name_stack,
            };
            map.next_value_seed(seed)?;
            root_processed = true;
        }
    }

    if !root_processed {
        return Err(de::Error::custom("missing root field"));
    }
    let version =
        version.ok_or_else(|| de::Error::custom(format!("missing {}", BUILTIN_VERSION_FIELD)))?;

    let data_size = file
        .fixup_offsets()
        .map_err(|e| de::Error::custom(e.to_string()))?;
    file.h
        .fixup_header(file.o.len(), file.f.len(), version, data_size)
        .ok_or_else(|| de::Error::custom("arithmetic overflow in header fixup"))?;

    Ok(file)
}

struct FieldValueSeed<'a> {
    file: &'a mut File,
    name: String,
    parent: Option<ObjIdx>,
    name_stack: &'a mut Vec<NameType>,
    merging: bool,
    original: Option<&'a serde_json::Value>,
}

impl<'de, 'a> DeserializeSeed<'de> for FieldValueSeed<'a> {
    type Value = FieldIdx;

    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> Result<Self::Value, D::Error> {
        let mut path: Vec<&str> = self.name_stack.iter().map(|s| s.as_ref()).collect();
        path.push(&self.name);
        let path = path.join(".");
        deserializer
            .deserialize_any(FieldValueVisitor {
                file: self.file,
                merging: self.merging,
                original: self.original,
                name: self.name,
                parent: self.parent,
                name_stack: self.name_stack,
            })
            .map_err(|e| de::Error::custom(format!("{path}: {e}")))
    }
}

struct FieldValueVisitor<'a> {
    file: &'a mut File,
    name: String,
    parent: Option<ObjIdx>,
    name_stack: &'a mut Vec<NameType>,
    merging: bool,
    original: Option<&'a serde_json::Value>,
}

impl<'a> FieldValueVisitor<'a> {
    fn create_leaf(self, ft: FieldType) -> Result<FieldIdx, FromJsonError> {
        let name_type = NameType::from(self.name.as_str());
        let field_idx = self
            .file
            .f
            .create_field(&self.name)
            .ok_or(FromJsonError::IntegerErr)?;
        self.file.dat.create_data(name_type, self.parent, ft);
        Ok(field_idx)
    }
}

fn make_integer_field<E: de::Error>(
    name_stack: &[NameType],
    name: &str,
    v: i64,
) -> Result<FieldType, E> {
    match hardcoded_type(name_stack, name) {
        Some(FieldType::Float(_)) => Ok(FieldType::Float(v as f32)),
        _ => {
            let i = i32::try_from(v).map_err(|_| E::custom("i32 overflow"))?;
            Ok(FieldType::Int(i))
        }
    }
}

impl<'de, 'a> Visitor<'de> for FieldValueVisitor<'a> {
    type Value = FieldIdx;

    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "a DSON field value for key '{}'", self.name)
    }

    fn visit_bool<E: de::Error>(self, v: bool) -> Result<Self::Value, E> {
        self.create_leaf(FieldType::Bool(v))
            .map_err(from_json_to_serde)
    }

    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
        let ft = make_integer_field(self.name_stack, &self.name, v)?;
        self.create_leaf(ft).map_err(from_json_to_serde)
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
        let v = i64::try_from(v).map_err(|_| E::custom("u64 overflow"))?;
        let ft = make_integer_field(self.name_stack, &self.name, v)?;
        self.create_leaf(ft).map_err(from_json_to_serde)
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Self::Value, E> {
        match hardcoded_type(self.name_stack, &self.name) {
            Some(FieldType::Float(_)) => self
                .create_leaf(FieldType::Float(v as f32))
                .map_err(from_json_to_serde),
            _ => Err(E::custom(format!(
                "non-hardcoded float not allowed for field '{}'",
                self.name
            ))),
        }
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
        if v.chars()
            .any(|c| c == '\0' || (!self.merging && c.is_control()))
        {
            return Err(E::custom(
                "strings cannot contain control characters or NUL",
            ));
        }
        let ft = match hardcoded_type(self.name_stack, &self.name) {
            Some(FieldType::Char(_)) => {
                let bytes = v.as_bytes();
                if bytes.len() == 1 && bytes[0].is_ascii() {
                    FieldType::Char(bytes[0] as char)
                } else {
                    return Err(E::custom("expected exactly one ascii char"));
                }
            }
            _ => {
                if let Some(rest) = v
                    .strip_prefix("###")
                    .filter(|_| !self.original.is_some_and(|value| value.is_string()))
                {
                    FieldType::Int(name_hash(rest))
                } else {
                    FieldType::String(v.to_owned().into_boxed_str())
                }
            }
        };
        self.create_leaf(ft).map_err(from_json_to_serde)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let hc = hardcoded_type(self.name_stack, &self.name);
        let ft = match hc {
            Some(FieldType::IntVector(_)) => {
                let mut v = Vec::new();
                while let Some(elem) = seq.next_element::<serde_json::Value>()? {
                    let i = match &elem {
                        serde_json::Value::String(s) if s.starts_with("###") => {
                            if s.chars().any(char::is_control) {
                                return Err(de::Error::custom(
                                    "strings cannot contain control characters or NUL",
                                ));
                            }
                            name_hash(&s[3..])
                        }
                        serde_json::Value::Number(n) => {
                            let raw = n.as_i64().ok_or_else(|| {
                                de::Error::custom("expected integer in IntVector")
                            })?;
                            i32::try_from(raw)
                                .map_err(|_| de::Error::custom("i32 overflow in IntVector"))?
                        }
                        _ => {
                            return Err(de::Error::custom("expected int or ###string in IntVector"))
                        }
                    };
                    v.push(i);
                }
                FieldType::IntVector(v.into_boxed_slice())
            }
            Some(FieldType::StringVector(_)) => {
                let mut v = Vec::new();
                while let Some(s) = seq.next_element::<String>()? {
                    v.push(s);
                }
                FieldType::StringVector(v.into_boxed_slice())
            }
            Some(FieldType::FloatArray(_)) => {
                let mut v = Vec::new();
                while let Some(f) = seq.next_element::<f64>()? {
                    v.push(f as f32);
                }
                FieldType::FloatArray(v.into_boxed_slice())
            }
            Some(FieldType::TwoInt(_, _)) => {
                let i1 = seq
                    .next_element::<i64>()?
                    .ok_or_else(|| de::Error::custom("TwoInt expects 2 elements, got 0"))?;
                let i2 = seq
                    .next_element::<i64>()?
                    .ok_or_else(|| de::Error::custom("TwoInt expects 2 elements, got 1"))?;
                while seq.next_element::<serde_json::Value>()?.is_some() {}
                let i1 =
                    i32::try_from(i1).map_err(|_| de::Error::custom("i32 overflow in TwoInt"))?;
                let i2 =
                    i32::try_from(i2).map_err(|_| de::Error::custom("i32 overflow in TwoInt"))?;
                FieldType::TwoInt(i1, i2)
            }
            Some(FieldType::TwoBool(_, _)) => {
                let b1 = seq
                    .next_element::<bool>()?
                    .ok_or_else(|| de::Error::custom("TwoBool expects 2 elements, got 0"))?;
                let b2 = seq
                    .next_element::<bool>()?
                    .ok_or_else(|| de::Error::custom("TwoBool expects 2 elements, got 1"))?;
                while seq.next_element::<serde_json::Value>()?.is_some() {}
                FieldType::TwoBool(b1, b2)
            }
            _ => {
                return Err(de::Error::custom(format!(
                    "arrays only allowed for hardcoded field types (field '{}')",
                    self.name
                )))
            }
        };
        self.create_leaf(ft).map_err(from_json_to_serde)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let name = self.name;
        let name_type = NameType::from(name.as_str());
        let file = self.file;
        let parent = self.parent;
        let name_stack = self.name_stack;

        if name == "raw_data" || name == "static_save" {
            let inner = build_file_from_map_access(&mut map, self.merging, self.original)?;
            let field_idx = file
                .f
                .create_field(&name)
                .ok_or_else(|| de::Error::custom("too many fields"))?;
            file.dat
                .create_data(name_type, parent, FieldType::File(Some(Box::new(inner))));
            Ok(field_idx)
        } else {
            let field_idx = file
                .f
                .create_field(&name)
                .ok_or_else(|| de::Error::custom("too many fields"))?;
            file.dat
                .create_data(name_type.clone(), parent, FieldType::Object(Box::new([])));
            let obj_idx = file
                .o
                .create_object(field_idx, parent, 0, 0)
                .ok_or_else(|| de::Error::custom("too many objects"))?;
            file.f[field_idx].field_info |= 1;
            file.f[field_idx].field_info |= (obj_idx.numeric() & FieldInfo::OBJ_IDX_BITS) << 11;

            name_stack.push(name_type);
            let mut children: Vec<FieldIdx> = Vec::new();
            while let Some(key) = map.next_key::<String>()? {
                let seed = FieldValueSeed {
                    file,
                    merging: self.merging,
                    original: self.original.and_then(|value| value.get(&key)),
                    name: key,
                    parent: Some(obj_idx),
                    name_stack,
                };
                let child_idx = map.next_value_seed(seed)?;
                children.push(child_idx);
            }
            name_stack.pop();

            file.o[obj_idx].num_direct_childs = children.len() as u32;
            file.o[obj_idx].num_all_childs = file.f.len() - 1 - field_idx.numeric();
            if let FieldType::Object(ref mut chl) = file.dat[field_idx].tipe {
                *chl = children.into_boxed_slice();
            }

            Ok(field_idx)
        }
    }
}

// ---------------------------------------------------------------------------
// Public API: reading
// ---------------------------------------------------------------------------

impl File {
    /// Attempt to decode a [`File`] from a [`Read`] representing a JSON stream.
    ///
    /// Uses `serde_json::Deserializer` with a custom Visitor that preserves
    /// duplicate keys at all nesting levels.
    pub fn try_from_json<R: Read>(reader: R) -> Result<Self, FromJsonError> {
        Self::read_json(reader, None)
    }

    // A merge preserves the original String type even for a leading ###.
    // Only the merge walker can authorize existing controls, never edited text.
    pub(super) fn read_json<R: Read>(
        mut reader: R,
        original: Option<&serde_json::Value>,
    ) -> Result<Self, FromJsonError> {
        let mut buf = Vec::new();
        reader.read_to_end(&mut buf)?;

        let mut de = serde_json::Deserializer::from_slice(&buf);
        let merging = original.is_some();
        let file = TopLevelSeed { merging, original }
            .deserialize(&mut de)
            .map_err(|e| FromJsonError::SerdeJson(e.to_string()))?;
        de.end()
            .map_err(|e| FromJsonError::SerdeJson(e.to_string()))?;
        file.validate_values(!merging)
            .map_err(FromJsonError::InvalidValue)?;
        Ok(file)
    }

    /// Alias preserved for test compatibility.
    pub fn try_from_json_serde<R: Read>(reader: R) -> Result<Self, FromJsonError> {
        Self::try_from_json(reader)
    }

    /// Create a [`File`] from a [`serde_json::Value`].
    ///
    /// Walks the Value tree directly. Duplicate keys are already lost in
    /// `serde_json::Value`; use [`File::try_from_json`] on raw bytes to
    /// preserve them.
    pub fn from_json_value(value: &serde_json::Value) -> Result<Self, FromJsonError> {
        let map = value
            .as_object()
            .ok_or_else(|| FromJsonError::Expected("top-level object".to_owned(), 0, 0))?;
        let file = build_file_from_map_value(map)?;
        file.validate_values(true)
            .map_err(FromJsonError::InvalidValue)?;
        Ok(file)
    }

    /// Alias preserved for test compatibility.
    pub fn from_json_value_direct(value: &serde_json::Value) -> Result<Self, FromJsonError> {
        Self::from_json_value(value)
    }
}

// ===========================================================================
// Writing
// ===========================================================================

impl File {
    /// Write this [`File`] as JSON.
    pub fn write_to_json<T: AsRef<str>, W: Write>(
        &self,
        mut writer: W,
        allow_dupes: bool,
        unhash: &Unhasher<T>,
    ) -> std::io::Result<()> {
        self.write_to_json_priv(writer.by_ref(), &mut vec![], allow_dupes, unhash)
    }

    /// Convert the internal [`File`] representation to a [`serde_json::Value`].
    pub fn to_json_value(&self, unhasher: &Unhasher<impl AsRef<str>>) -> serde_json::Value {
        let mut buf = Vec::new();
        self.write_to_json(&mut buf, true, unhasher)
            .expect("JSON write to Vec cannot fail");
        serde_json::from_slice(&buf).expect("our JSON output should always be valid")
    }

    fn write_to_json_priv<T: AsRef<str>, W: Write>(
        &self,
        writer: &'_ mut W,
        indent: &mut Vec<u8>,
        allow_dupes: bool,
        unhash: &Unhasher<T>,
    ) -> std::io::Result<()> {
        writer.write_all(b"{\n")?;
        writer.write_all(&indent)?;
        writer.write_all(b"    ")?;
        writer.write_all(b"\"")?;
        writer.write_all(BUILTIN_VERSION_FIELD.as_bytes())?;
        writer.write_all(b"\": ")?;
        {
            let mut buf = itoa::Buffer::new();
            writer.write_all(buf.format(self.h.version()).as_bytes())?;
        }
        writer.write_all(b",\n")?;
        if let Some(root) = self.o.iter().find(|o| o.parent.is_none()) {
            indent.extend_from_slice(b"    ");
            self.write_field(
                root.field,
                writer.by_ref(),
                indent,
                false,
                allow_dupes,
                unhash,
            )?;
            indent.truncate(indent.len() - 4);
        }
        writer.write_all(&indent)?;
        writer.write_all(b"}")?;
        Ok(())
    }

    fn write_object<T: AsRef<str>, W: Write>(
        &self,
        field_idx: FieldIdx,
        writer: &'_ mut W,
        indent: &mut Vec<u8>,
        allow_dupes: bool,
        unhash: &Unhasher<T>,
    ) -> std::io::Result<()> {
        let dat = &self.dat[field_idx];
        let c = dat.tipe.unwrap_object();
        if c.is_empty() {
            writer.write_all(b"{}")
        } else {
            writer.write_all(b"{\n")?;
            let mut emitted_fields = if allow_dupes {
                None
            } else {
                Some(std::collections::HashSet::new())
            };
            for (idx, &child) in c.iter().enumerate() {
                if let Some(ref mut emitted_fields) = emitted_fields {
                    if !emitted_fields.insert(&self.dat[child].name) {
                        continue;
                    }
                }
                indent.extend_from_slice(b"    ");
                self.write_field(
                    child,
                    writer,
                    indent,
                    idx != c.len() - 1,
                    allow_dupes,
                    unhash,
                )?;
                indent.truncate(indent.len() - 4);
            }
            writer.write_all(&indent)?;
            writer.write_all(b"}")
        }
    }

    fn write_field<T: AsRef<str>, W: Write>(
        &self,
        field_idx: FieldIdx,
        writer: &'_ mut W,
        indent: &mut Vec<u8>,
        comma: bool,
        allow_dupes: bool,
        unhash: &Unhasher<T>,
    ) -> std::io::Result<()> {
        use FieldType::*;
        let dat = &self.dat[field_idx];
        writer.write_all(&indent)?;
        writer.write_all(b"\"")?;
        writer.write_all(escape(dat.name.as_ref()).as_bytes())?;
        writer.write_all(b"\" : ")?;
        match &dat.tipe {
            Bool(b) => writer.write_all(if *b { b"true" } else { b"false" })?,
            TwoBool(b1, b2) => {
                writer.write_all(b"[")?;
                writer.write_all(if *b1 { b"true" } else { b"false" })?;
                writer.write_all(b", ")?;
                writer.write_all(if *b2 { b"true" } else { b"false" })?;
                writer.write_all(b"]")?;
            }
            Int(i) => match unhash.unhash(*i) {
                Some(s) => {
                    writer.write_all(b"\"")?;
                    writer.write_all(b"###")?;
                    writer.write_all(escape(s).as_bytes())?;
                    writer.write_all(b"\"")?;
                }
                None => {
                    let mut buf = itoa::Buffer::new();
                    writer.write_all(buf.format(*i).as_bytes())?;
                }
            },
            Float(f) => {
                let mut buf = ryu::Buffer::new();
                writer.write_all(buf.format(*f as f64).as_bytes())?;
            }
            Char(c) => {
                writer.write_all(b"\"")?;
                writer.write_all(escape(&c.to_string()).as_bytes())?;
                writer.write_all(b"\"")?;
            }
            String(s) => {
                writer.write_all(b"\"")?;
                writer.write_all(escape(s).as_bytes())?;
                writer.write_all(b"\"")?;
            }
            IntVector(ref v) => {
                writer.write_all(b"[")?;
                for (idx, i) in v.iter().enumerate() {
                    match unhash.unhash(*i) {
                        Some(s) => {
                            writer.write_all(b"\"")?;
                            writer.write_all(b"###")?;
                            writer.write_all(escape(s).as_bytes())?;
                            writer.write_all(b"\"")?;
                        }
                        None => {
                            let mut buf = itoa::Buffer::new();
                            writer.write_all(buf.format(*i).as_bytes())?;
                        }
                    }
                    if idx != v.len() - 1 {
                        writer.write_all(b", ")?;
                    }
                }
                writer.write_all(b"]")?;
            }
            StringVector(ref v) => {
                writer.write_all(b"[")?;
                for (idx, s) in v.iter().enumerate() {
                    writer.write_all(b"\"")?;
                    writer.write_all(escape(s).as_bytes())?;
                    writer.write_all(b"\"")?;
                    if idx != v.len() - 1 {
                        writer.write_all(b", ")?;
                    }
                }
                writer.write_all(b"]")?;
            }
            FloatArray(ref v) => {
                writer.write_all(b"[")?;
                for (idx, f) in v.iter().enumerate() {
                    let mut buf = ryu::Buffer::new();
                    writer.write_all(buf.format(*f as f64).as_bytes())?;
                    if idx != v.len() - 1 {
                        writer.write_all(b", ")?;
                    }
                }
                writer.write_all(b"]")?;
            }
            TwoInt(i1, i2) => {
                writer.write_all(b"[")?;
                {
                    let mut buf = itoa::Buffer::new();
                    writer.write_all(buf.format(*i1).as_bytes())?;
                }
                writer.write_all(b", ")?;
                {
                    let mut buf = itoa::Buffer::new();
                    writer.write_all(buf.format(*i2).as_bytes())?;
                }
                writer.write_all(b"]")?;
            }
            File(ref obf) => {
                let fil = obf.as_ref().unwrap();
                fil.write_to_json_priv(writer, indent, allow_dupes, unhash)?;
            }
            Object(_) => {
                self.write_object(field_idx, writer, indent, allow_dupes, unhash)?;
            }
        };

        if comma {
            writer.write_all(b",\n")?;
        } else {
            writer.write_all(b"\n")?;
        }

        Ok(())
    }
}
