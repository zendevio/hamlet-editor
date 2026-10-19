use super::{File, Unhasher};
use crate::err::FromJsonError;
use serde::de::{MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::collections::HashMap;

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

    fn merge(&mut self, edited: &Value) {
        match (self, edited) {
            (Self::Object(entries), Value::Object(map)) => {
                // The frontend sees the last occurrence of each name. Earlier
                // occurrences remain untouched; deleting a name removes all.
                let last: HashMap<String, usize> = entries
                    .iter()
                    .enumerate()
                    .map(|(i, (k, _))| (k.clone(), i))
                    .collect();
                for (i, (key, value)) in entries.iter_mut().enumerate() {
                    if last.get(key) == Some(&i) {
                        if let Some(new_value) = map.get(key) {
                            value.merge(new_value);
                        }
                    }
                }
                entries.retain(|(key, _)| map.contains_key(key));
                for (key, value) in map {
                    if !last.contains_key(key) {
                        entries.push((key.clone(), Self::from_value(value)));
                    }
                }
            }
            (Self::Array(entries), Value::Array(values)) => {
                entries.truncate(values.len());
                for (i, value) in values.iter().enumerate() {
                    if let Some(entry) = entries.get_mut(i) {
                        entry.merge(value);
                    } else {
                        entries.push(Self::from_value(value));
                    }
                }
            }
            (original, value) => *original = Self::from_value(value),
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
    /// existing object order and duplicate entries, and append newly added keys.
    pub fn merge_json_value(&self, edited: &Value) -> Result<Self, FromJsonError> {
        let mut bytes = Vec::new();
        self.write_to_json(&mut bytes, true, &Unhasher::empty())?;
        let mut ordered: OrderedValue =
            serde_json::from_slice(&bytes).map_err(|e| FromJsonError::SerdeJson(e.to_string()))?;
        ordered.merge(edited);
        let merged =
            serde_json::to_vec(&ordered).map_err(|e| FromJsonError::SerdeJson(e.to_string()))?;
        Self::try_from_json(merged.as_slice())
    }
}
