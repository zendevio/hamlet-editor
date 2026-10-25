use super::error::AppError;
use serde::Serialize;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const SOURCE_TIMEOUT: Duration = Duration::from_millis(500);
const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Status {
    Ok,
    Absent,
    Unreadable,
    TimedOut,
}
#[derive(Serialize, Debug)]
pub struct Evidence<T> {
    status: Status,
    value: Option<T>,
}
impl<T> Evidence<T> {
    fn new(status: Status, value: Option<T>) -> Self {
        Self { status, value }
    }
}
#[derive(Serialize, Debug)]
pub struct GameOption {
    language: Option<String>,
    path_kind: &'static str,
    verified: bool,
}
#[derive(Serialize)]
pub struct LanguageEvidence {
    os_locales: Evidence<Vec<String>>,
    game_options: Evidence<GameOption>,
    steam_manifest: Evidence<String>,
}
#[derive(Debug, PartialEq, Eq)]
struct Candidate {
    path: PathBuf,
    kind: &'static str,
    verified: bool,
}

pub(crate) fn read_bounded(path: &Path) -> io::Result<String> {
    let mut text = String::new();
    std::fs::File::open(path)?
        .take(MAX_BYTES + 1)
        .read_to_string(&mut text)?;
    if text.len() as u64 > MAX_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Language/settings file exceeds 1 MiB",
        ));
    }
    Ok(text)
}
fn parse_options(text: &str) -> Result<Option<String>, serde_json::Error> {
    let value: serde_json::Value = serde_json::from_str(text)?;
    Ok(value
        .pointer("/data/values/language")
        .and_then(|value| value.as_str())
        .map(str::to_owned))
}

// Valve KeyValues: quoted strings, braces, whitespace and line comments only.
// Parse the whole bounded document, rejecting truncation and excessive nesting.
fn parse_acf(text: &str) -> Result<serde_json::Value, ()> {
    fn token(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> Result<Option<String>, ()> {
        loop {
            while chars.peek().is_some_and(|ch| ch.is_whitespace()) {
                chars.next();
            }
            if chars.peek() != Some(&'/') {
                break;
            }
            chars.next();
            if chars.next() != Some('/') {
                return Err(());
            }
            for ch in chars.by_ref() {
                if ch == '\n' {
                    break;
                }
            }
        }
        match chars.next() {
            None => Ok(None),
            Some(ch @ ('{' | '}')) => Ok(Some(ch.to_string())),
            Some('"') => {
                let mut value = String::new();
                while let Some(ch) = chars.next() {
                    match ch {
                        '"' => return Ok(Some(format!("s{value}"))),
                        '\\' => value.push(chars.next().ok_or(())?),
                        ch => value.push(ch),
                    }
                }
                Err(())
            }
            _ => Err(()),
        }
    }
    fn object(
        chars: &mut std::iter::Peekable<std::str::Chars<'_>>,
        depth: u8,
    ) -> Result<serde_json::Value, ()> {
        if depth > 16 {
            return Err(());
        }
        let mut map = serde_json::Map::new();
        loop {
            let key = match token(chars)? {
                None if depth == 0 => break,
                Some(key) if key == "}" && depth > 0 => break,
                Some(key) if key.starts_with('s') => key[1..].to_ascii_lowercase(),
                _ => return Err(()),
            };
            let value = match token(chars)? {
                Some(value) if value == "{" => object(chars, depth + 1)?,
                Some(value) if value.starts_with('s') => {
                    serde_json::Value::String(value[1..].to_owned())
                }
                _ => return Err(()),
            };
            if map.insert(key, value).is_some() {
                return Err(());
            }
        }
        Ok(serde_json::Value::Object(map))
    }
    object(&mut text.chars().peekable(), 0)
}

/// Bound ancestry to the known Steam layout, including macOS's nested data root.
fn steam_name_matches(actual: &str, expected: &str) -> bool {
    name_matches(
        actual,
        expected,
        cfg!(any(target_os = "windows", target_os = "macos")),
    )
}
fn name_matches(actual: &str, expected: &str, case_insensitive: bool) -> bool {
    if case_insensitive {
        actual.eq_ignore_ascii_case(expected)
    } else {
        actual == expected
    }
}
fn steam_install(path: &Path) -> Option<(PathBuf, String)> {
    for ancestor in path.ancestors().take(9) {
        let common = ancestor.parent()?;
        let steamapps = common.parent()?;
        if steam_name_matches(common.file_name()?.to_str()?, "common")
            && steam_name_matches(steamapps.file_name()?.to_str()?, "steamapps")
        {
            return Some((
                steamapps.to_path_buf(),
                ancestor.file_name()?.to_str()?.to_owned(),
            ));
        }
    }
    None
}
fn options_candidates(
    game: &Path,
    platform: &str,
    home: Option<&Path>,
    documents: Option<&Path>,
) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    if game.as_os_str().is_empty() {
        return candidates;
    }
    if platform == "linux" {
        if let Some((steamapps, _)) = steam_install(game) {
            candidates.push(Candidate { path: steamapps.join("compatdata/262060/pfx/drive_c/users/steamuser/Documents/Darkest/persist.options.json"), kind: "proton_documents", verified: false });
        }
    }
    let native = match platform {
        "macos" => home.map(|home| {
            (
                home.join("Library/Application Support/Darkest"),
                "macos_support",
                true,
            )
        }),
        "windows" => documents.map(|docs| (docs.join("Darkest"), "windows_documents", false)),
        "linux" => home.map(|home| {
            (
                home.join(".local/share/Red Hook Studios/Darkest"),
                "linux_data",
                false,
            )
        }),
        _ => None,
    };
    if let Some((path, kind, verified)) = native {
        candidates.push(Candidate {
            path: path.join("persist.options.json"),
            kind,
            verified,
        });
    }
    candidates
}
fn collect_options(candidates: Vec<Candidate>) -> Evidence<GameOption> {
    let mut unreadable = false;
    for candidate in candidates {
        match read_bounded(&candidate.path) {
            Ok(text) => match parse_options(&text) {
                Ok(language) => {
                    return Evidence::new(
                        Status::Ok,
                        Some(GameOption {
                            language,
                            path_kind: candidate.kind,
                            verified: candidate.verified,
                        }),
                    )
                }
                Err(_) => unreadable = true,
            },
            Err(error) => unreadable |= error.kind() != io::ErrorKind::NotFound,
        }
    }
    Evidence::new(
        if unreadable {
            Status::Unreadable
        } else {
            Status::Absent
        },
        None,
    )
}
fn collect_manifest(game: &Path) -> Evidence<String> {
    let Some((steamapps, install_dir)) = steam_install(game) else {
        return Evidence::new(Status::Absent, None);
    };
    let text = match read_bounded(&steamapps.join("appmanifest_262060.acf")) {
        Ok(text) => text,
        Err(error) => {
            return Evidence::new(
                if error.kind() == io::ErrorKind::NotFound {
                    Status::Absent
                } else {
                    Status::Unreadable
                },
                None,
            )
        }
    };
    let Ok(value) = parse_acf(&text) else {
        return Evidence::new(Status::Unreadable, None);
    };
    // A manifest for a different installation must never supply a signal.
    if !value
        .pointer("/appstate/installdir")
        .and_then(|v| v.as_str())
        .is_some_and(|dir| steam_name_matches(dir, &install_dir))
        || value.pointer("/appstate/appid").and_then(|v| v.as_str()) != Some("262060")
    {
        return Evidence::new(Status::Absent, None);
    }
    Evidence::new(
        Status::Ok,
        value
            .pointer("/appstate/userconfig/language")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
    )
}
fn launch<T: Send + 'static>(
    work: impl FnOnce() -> Evidence<T> + Send + 'static,
) -> mpsc::Receiver<Evidence<T>> {
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = send.send(work());
    });
    receive
}
fn receive<T>(source: mpsc::Receiver<Evidence<T>>, deadline: Instant) -> Evidence<T> {
    match source.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(value) => value,
        Err(mpsc::RecvTimeoutError::Timeout) => Evidence::new(Status::TimedOut, None),
        Err(mpsc::RecvTimeoutError::Disconnected) => Evidence::new(Status::Unreadable, None),
    }
}
fn collect(game: PathBuf) -> LanguageEvidence {
    let deadline = Instant::now() + SOURCE_TIMEOUT;
    let os = launch(|| {
        let locales: Vec<_> = sys_locale::get_locales().collect();
        Evidence::new(
            if locales.is_empty() {
                Status::Absent
            } else {
                Status::Ok
            },
            Some(locales),
        )
    });
    let options_game = game.clone();
    let options = launch(move || {
        collect_options(options_candidates(
            &options_game,
            std::env::consts::OS,
            dirs::home_dir().as_deref(),
            dirs::document_dir().as_deref(),
        ))
    });
    let manifest = launch(move || collect_manifest(&game));
    LanguageEvidence {
        os_locales: receive(os, deadline),
        game_options: receive(options, deadline),
        steam_manifest: receive(manifest, deadline),
    }
}
#[tauri::command]
pub async fn collect_language_evidence(game_path: String) -> Result<LanguageEvidence, AppError> {
    tauri::async_runtime::spawn_blocking(move || collect(PathBuf::from(game_path)))
        .await
        .map_err(|error| AppError::new("language_evidence_failed").detail(error))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn steam_names_follow_platform_case_rules() {
        assert!(steam_name_matches("steamapps", "steamapps"));
        for (actual, expected) in [
            ("SteamApps", "steamapps"),
            ("Common", "common"),
            ("DARKESTDUNGEON", "DarkestDungeon"),
        ] {
            assert_eq!(
                steam_name_matches(actual, expected),
                cfg!(any(target_os = "windows", target_os = "macos"))
            );
            assert!(name_matches(actual, expected, true));
            assert!(!name_matches(actual, expected, false));
        }
        assert!(!steam_name_matches("Other", "DarkestDungeon"));
    }
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    #[test]
    fn mixed_case_steam_ancestry_and_manifest_match() {
        let root = std::env::temp_dir().join(format!(
            "hamlet-steam-case-{}",
            super::super::transaction::unique_suffix()
        ));
        let steamapps = root.join("SteamApps");
        std::fs::create_dir_all(&steamapps).unwrap();
        std::fs::write(steamapps.join("appmanifest_262060.acf"), r#""AppState" { "appid" "262060" "installdir" "darkestdungeon" "UserConfig" { "language" "russian" } }"#).unwrap();
        assert_eq!(
            collect_manifest(&steamapps.join("Common/DarkestDungeon"))
                .value
                .as_deref(),
            Some("russian")
        );
        assert_eq!(
            collect_manifest(&steamapps.join("Common/Other")).status,
            Status::Absent
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn options_json_malformed_missing_default_and_language() {
        assert!(parse_options("{").is_err());
        for text in ["{}", r#"{"data":{"values":{"language":3}}}"#] {
            assert_eq!(parse_options(text).unwrap(), None);
        }
        for language in ["default", "japanese", "unknown"] {
            assert_eq!(
                parse_options(&format!(
                    r#"{{"data":{{"values":{{"language":"{language}"}}}}}}"#
                ))
                .unwrap()
                .as_deref(),
                Some(language)
            );
        }
    }
    #[test]
    fn acf_malformed_missing_default_and_language() {
        for text in [
            r#""AppState" {"#,
            r#""AppState" { "x" }"#,
            "garbage",
            r#""AppState" {} }"#,
        ] {
            assert!(parse_acf(text).is_err(), "{text}");
        }
        assert!(parse_acf(r#""AppState" {}"#)
            .unwrap()
            .pointer("/appstate/userconfig/language")
            .is_none());
        for language in ["default", "german", "latam", "tchinese"] {
            let text = format!(
                "// comment\n\"AppState\" {{ \"UserConfig\" {{ \"language\" \"{language}\" }} }}"
            );
            assert_eq!(
                parse_acf(&text)
                    .unwrap()
                    .pointer("/appstate/userconfig/language")
                    .unwrap(),
                language
            );
        }
    }
    #[test]
    fn bounded_paths_for_all_platforms_and_selected_installation() {
        let game = Path::new(
            "/library/steamapps/common/DarkestDungeon/_osx/Darkest.app/Contents/Resources/data",
        );
        assert_eq!(
            steam_install(game),
            Some((PathBuf::from("/library/steamapps"), "DarkestDungeon".into()))
        );
        assert!(steam_install(Path::new("/other/game")).is_none());
        for (platform, expected, kind, verified) in [
            (
                "macos",
                "/home/Library/Application Support/Darkest/persist.options.json",
                "macos_support",
                true,
            ),
            (
                "windows",
                "/documents/Darkest/persist.options.json",
                "windows_documents",
                false,
            ),
            (
                "linux",
                "/home/.local/share/Red Hook Studios/Darkest/persist.options.json",
                "linux_data",
                false,
            ),
        ] {
            let candidates = options_candidates(
                Path::new("/gog/game"),
                platform,
                Some(Path::new("/home")),
                Some(Path::new("/documents")),
            );
            assert_eq!(
                candidates,
                vec![Candidate {
                    path: expected.into(),
                    kind,
                    verified
                }]
            );
        }
        let proton = options_candidates(game, "linux", Some(Path::new("/home")), None);
        assert_eq!(proton.len(), 2);
        assert_eq!(proton[0].path, Path::new("/library/steamapps/compatdata/262060/pfx/drive_c/users/steamuser/Documents/Darkest/persist.options.json"));
        assert!(!proton[0].verified);
        assert!(
            options_candidates(Path::new(""), "macos", Some(Path::new("/home")), None).is_empty()
        );
    }
    #[test]
    fn temporary_sources_only_language_leaves_collector_and_manifest_matches_install() {
        let root = std::env::temp_dir().join(format!(
            "hamlet-language-{}",
            super::super::transaction::unique_suffix()
        ));
        let steamapps = root.join("steamapps");
        std::fs::create_dir_all(&steamapps).unwrap();
        let file = steamapps.join("appmanifest_262060.acf");
        std::fs::write(&file, r#""AppState" { "appid" "262060" "installdir" "DarkestDungeon" "UserConfig" { "language" "russian" } }"#).unwrap();
        assert_eq!(
            collect_manifest(&steamapps.join("common/DarkestDungeon"))
                .value
                .as_deref(),
            Some("russian")
        );
        assert_eq!(
            collect_manifest(&steamapps.join("common/Other")).status,
            Status::Absent
        );
        let options = root.join("persist.options.json");
        std::fs::write(
            &options,
            r#"{"secret":"never returned","data":{"values":{"language":"default"}}}"#,
        )
        .unwrap();
        let result = collect_options(vec![Candidate {
            path: options,
            kind: "fixture",
            verified: false,
        }]);
        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains("secret"));
        assert!(json.contains("default"));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn parallel_deadline_does_not_wait_for_late_sources() {
        let start = Instant::now();
        let deadline = start + SOURCE_TIMEOUT;
        let sources: Vec<_> = (0..3)
            .map(|_| {
                launch(|| {
                    std::thread::sleep(Duration::from_millis(700));
                    Evidence::<String>::new(Status::Ok, Some("late".into()))
                })
            })
            .collect();
        for source in sources {
            assert_eq!(receive(source, deadline).status, Status::TimedOut);
        }
        assert!(start.elapsed() >= SOURCE_TIMEOUT);
        assert!(start.elapsed() < Duration::from_millis(650));
        eprintln!(
            "three parallel language sources, production deadline: {:?}",
            start.elapsed()
        );
        let fast = launch(|| Evidence::<String>::new(Status::Ok, Some("fast".into())));
        assert_eq!(
            receive(fast, Instant::now() + SOURCE_TIMEOUT)
                .value
                .as_deref(),
            Some("fast")
        );
    }
}
