use super::{File, Unhasher};
use crate::err::FromJsonError;
use serde::de::{MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

/// JavaScript serializes integral floats as integers without changing their value.
fn json_values_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| json_values_equal(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| b.get(key).is_some_and(|b| json_values_equal(value, b)))
        }
        _ => left == right,
    }
}

/// Objects use a sequence so repeated names and original order survive edits.
enum OrderedValue {
    Object(Vec<(String, Self)>),
    Array(Vec<Self>),
    Scalar(Value),
}

impl OrderedValue {
    fn from_value(value: &Value) -> Self {
        match value {
            Value::Object(map) => Self::Object(
                map.iter()
                    .map(|(k, v)| (k.clone(), Self::from_value(v)))
                    .collect(),
            ),
            Value::Array(values) => Self::Array(values.iter().map(Self::from_value).collect()),
            _ => Self::Scalar(value.clone()),
        }
    }

    fn validate_edits(&self, edited: &Value, path: &str) -> Result<(), FromJsonError> {
        let invalid = || {
            FromJsonError::InvalidValue(format!(
                "{path}: strings cannot contain control characters or NUL"
            ))
        };
        match (self, edited) {
            (Self::Scalar(Value::String(original)), Value::String(text)) if original == text => {
                Ok(())
            }
            (_, Value::String(text)) if text.chars().any(char::is_control) => Err(invalid()),
            (Self::Object(entries), Value::Object(map)) => {
                for (key, value) in map {
                    if key.chars().any(char::is_control) && !entries.iter().any(|(k, _)| k == key) {
                        return Err(invalid());
                    }
                    let empty = Self::Scalar(Value::Null);
                    let original = entries
                        .iter()
                        .rev()
                        .find(|(k, _)| k == key)
                        .map(|(_, v)| v)
                        .unwrap_or(&empty);
                    original.validate_edits(value, &format!("{path}.{key}"))?;
                }
                Ok(())
            }
            (Self::Array(entries), Value::Array(values)) => {
                for (i, value) in values.iter().enumerate() {
                    let empty = Self::Scalar(Value::Null);
                    entries
                        .get(i)
                        .unwrap_or(&empty)
                        .validate_edits(value, &format!("{path}[{i}]"))?;
                }
                Ok(())
            }
            // New containers have no authorized pre-existing text.
            (_, Value::Object(_) | Value::Array(_)) => {
                Self::from_value(&Value::Null).validate_new(edited, path)
            }
            _ => Ok(()),
        }
    }

    fn validate_new(&self, value: &Value, path: &str) -> Result<(), FromJsonError> {
        match value {
            Value::Object(_) => Self::Object(Vec::new()).validate_edits(value, path),
            Value::Array(_) => Self::Array(Vec::new()).validate_edits(value, path),
            _ => self.validate_edits(value, path),
        }
    }

    /// Apply only the difference from the original last-copy view to every copy.
    /// Earlier copies can contain distinct values and keys the user never saw.
    fn merge(&mut self, original: &Value, edited: &Value) {
        if json_values_equal(original, edited) {
            return;
        }
        match (self, original, edited) {
            (Self::Object(entries), Value::Object(before), Value::Object(after)) => {
                entries.retain(|(key, _)| !before.contains_key(key) || after.contains_key(key));
                for (key, value) in after {
                    if before.get(key).is_some_and(|v| json_values_equal(v, value)) {
                        continue;
                    }
                    let mut found = false;
                    for (_, entry) in entries.iter_mut().filter(|(k, _)| k == key) {
                        found = true;
                        if let Some(previous) = before.get(key) {
                            entry.merge(previous, value);
                        } else {
                            *entry = Self::from_value(value);
                        }
                    }
                    if !found {
                        entries.push((key.clone(), Self::from_value(value)));
                    }
                }
            }
            (Self::Array(entries), Value::Array(before), Value::Array(after)) => {
                if after.len() < before.len() {
                    entries.truncate(after.len());
                }
                for (i, value) in after.iter().enumerate() {
                    if before.get(i).is_some_and(|v| json_values_equal(v, value)) {
                        continue;
                    }
                    if let Some(entry) = entries.get_mut(i) {
                        if let Some(previous) = before.get(i) {
                            entry.merge(previous, value);
                        } else {
                            *entry = Self::from_value(value);
                        }
                    } else {
                        // Fill missing positions only when an edited index needs them.
                        entries.extend(after[entries.len()..=i].iter().map(Self::from_value));
                    }
                }
            }
            (target, _, value) => *target = Self::from_value(value),
        }
    }
}

impl Serialize for OrderedValue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Object(entries) => {
                let mut map = serializer.serialize_map(Some(entries.len()))?;
                for (key, value) in entries {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
            Self::Array(entries) => {
                let mut seq = serializer.serialize_seq(Some(entries.len()))?;
                for value in entries {
                    seq.serialize_element(value)?;
                }
                seq.end()
            }
            Self::Scalar(value) => value.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for OrderedValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct OrderedVisitor;
        impl<'de> Visitor<'de> for OrderedVisitor {
            type Value = OrderedValue;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("JSON value")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = map.next_entry()? {
                    entries.push(entry);
                }
                Ok(OrderedValue::Object(entries))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = seq.next_element()? {
                    entries.push(entry);
                }
                Ok(OrderedValue::Array(entries))
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(v.into()))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(v.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(v.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(v.into()))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(v.into()))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(Value::Null))
            }
        }
        deserializer.deserialize_any(OrderedVisitor)
    }
}

impl File {
    /// Merge the frontend's complete edited value onto the decoded file. Keep
    /// existing order and untouched duplicate data; propagate edits to every copy.
    pub fn merge_json_value(&self, edited: &Value) -> Result<Self, FromJsonError> {
        let mut bytes = Vec::new();
        self.write_to_json(&mut bytes, true, &Unhasher::empty())?;
        let mut ordered: OrderedValue =
            serde_json::from_slice(&bytes).map_err(|e| FromJsonError::SerdeJson(e.to_string()))?;
        ordered.validate_edits(edited, "")?;
        let original: Value =
            serde_json::from_slice(&bytes).map_err(|e| FromJsonError::SerdeJson(e.to_string()))?;
        ordered.merge(&original, edited);
        let merged =
            serde_json::to_vec(&ordered).map_err(|e| FromJsonError::SerdeJson(e.to_string()))?;
        Self::read_json(merged.as_slice(), Some(&original))
    }
}
