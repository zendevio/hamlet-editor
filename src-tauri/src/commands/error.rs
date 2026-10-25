use serde::Serialize;
use serde_json::{Map, Value};

/// Locale-free IPC protocol. Codes are explicit constants at each producer;
/// params carry identifiers and paths, and detail retains the raw diagnostic.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub params: Map<String, Value>,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: &'static str) -> Self {
        Self {
            code,
            params: Map::new(),
            detail: None,
        }
    }

    pub fn param(mut self, name: &str, value: impl Into<Value>) -> Self {
        self.params.insert(name.to_owned(), value.into());
        self
    }

    pub fn detail(mut self, detail: impl std::fmt::Display) -> Self {
        self.detail = Some(detail.to_string());
        self
    }

    pub(crate) fn raw_detail(&self) -> String {
        self.detail.clone().unwrap_or_else(|| self.to_string())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Logs and nested diagnostics preserve the protocol, without English copy.
        write!(
            formatter,
            "{}",
            serde_json::to_string(self).map_err(|_| std::fmt::Error)?
        )
    }
}

impl std::error::Error for AppError {}

#[cfg(test)]
pub(crate) mod test_log {
    use std::sync::{Mutex, Once};

    struct Capture(Mutex<Vec<String>>);
    static CAPTURE: Capture = Capture(Mutex::new(Vec::new()));
    static START: Once = Once::new();

    impl log::Log for Capture {
        fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
            metadata.level() == log::Level::Error
        }

        fn log(&self, record: &log::Record<'_>) {
            if self.enabled(record.metadata()) {
                self.0.lock().unwrap().push(record.args().to_string());
            }
        }

        fn flush(&self) {}
    }

    pub(crate) fn start() {
        START.call_once(|| {
            log::set_logger(&CAPTURE).unwrap();
            log::set_max_level(log::LevelFilter::Error);
        });
    }

    pub(crate) fn assert_logged(error: &super::AppError) {
        assert!(CAPTURE.0.lock().unwrap().contains(&error.to_string()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_fixture_round_trips_through_serialization() {
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("../../../tests/fixtures/app-errors.json")).unwrap();
        for case in cases {
            let code = Box::leak(case["code"].as_str().unwrap().to_owned().into_boxed_str());
            let mut error = AppError::new(code);
            for (key, value) in case["params"].as_object().unwrap() {
                error = error.param(key, value.clone());
            }
            error = error.detail(case["detail"].as_str().unwrap());
            assert_eq!(serde_json::to_value(&error).unwrap(), case);
            assert_eq!(error.raw_detail(), "raw diagnostic <unchanged>");
        }
        assert_eq!(
            serde_json::to_value(AppError::new("game_running")).unwrap(),
            serde_json::json!({"code": "game_running", "params": {}, "detail": null})
        );
    }
}
