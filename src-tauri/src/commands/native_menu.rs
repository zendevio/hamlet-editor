use super::error::AppError;
#[cfg(any(target_os = "macos", test))]
fn catalog_source(locale: &str) -> Option<&'static str> {
    Some(match locale {
        "en" => include_str!("../../../src/lib/i18n/catalogs/en.json"),
        "de" => include_str!("../../../src/lib/i18n/catalogs/de.json"),
        "ru" => include_str!("../../../src/lib/i18n/catalogs/ru.json"),
        "ja" => include_str!("../../../src/lib/i18n/catalogs/ja.json"),
        _ => return None,
    })
}
#[cfg(any(target_os = "macos", test))]
fn label(locale: &str, key: &str) -> String {
    let source = catalog_source(locale).unwrap_or_else(|| catalog_source("en").unwrap());
    let catalog: serde_json::Value = serde_json::from_str(source).expect("bundled catalog JSON");
    catalog
        .get(format!("native.{key}"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            let english: serde_json::Value =
                serde_json::from_str(include_str!("../../../src/lib/i18n/catalogs/en.json"))
                    .expect("English catalog JSON");
            english[format!("native.{key}")]
                .as_str()
                .unwrap_or(key)
                .to_owned()
        })
}

/// Equivalent to tauri 2.12.5 menu/menu.rs::default, including Window/Help ids.
#[cfg(target_os = "macos")]
pub(crate) fn build(
    app: &tauri::AppHandle,
    locale: &str,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{
        AboutMetadata, Menu, PredefinedMenuItem as Item, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    };
    let text = |key: &str| label(locale, key);
    let metadata = AboutMetadata {
        name: Some("Hamlet Editor".into()),
        version: Some(app.package_info().version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        authors: app
            .config()
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "Hamlet Editor",
                true,
                &[
                    &Item::about(app, Some(&text("about")), Some(metadata))?,
                    &Item::separator(app)?,
                    &Item::services(app, Some(&text("services")))?,
                    &Item::separator(app)?,
                    &Item::hide(app, Some(&text("hide")))?,
                    &Item::hide_others(app, Some(&text("hideOthers")))?,
                    &Item::separator(app)?,
                    &Item::quit(app, Some(&text("quit")))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                text("file"),
                true,
                &[&Item::close_window(app, Some(&text("close")))?],
            )?,
            &Submenu::with_items(
                app,
                text("edit"),
                true,
                &[
                    &Item::undo(app, Some(&text("undo")))?,
                    &Item::redo(app, Some(&text("redo")))?,
                    &Item::separator(app)?,
                    &Item::cut(app, Some(&text("cut")))?,
                    &Item::copy(app, Some(&text("copy")))?,
                    &Item::paste(app, Some(&text("paste")))?,
                    &Item::select_all(app, Some(&text("selectAll")))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                text("view"),
                true,
                &[&Item::fullscreen(app, Some(&text("fullscreen")))?],
            )?,
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                text("window"),
                true,
                &[
                    &Item::minimize(app, Some(&text("minimize")))?,
                    &Item::maximize(app, Some(&text("maximize")))?,
                    &Item::separator(app)?,
                    &Item::close_window(app, Some(&text("close")))?,
                ],
            )?,
            &Submenu::with_id_and_items(app, HELP_SUBMENU_ID, text("help"), true, &[])?,
        ],
    )
}
#[tauri::command]
pub fn set_native_menu_language(app: tauri::AppHandle, locale: String) -> Result<(), AppError> {
    if ![
        "en", "fr", "de", "es", "it", "pt-BR", "pl", "cs", "ru", "zh-Hans", "ja", "ko",
    ]
    .contains(&locale.as_str())
    {
        return Err(AppError::new("menu_locale_unknown").param("locale", locale));
    }
    #[cfg(target_os = "macos")]
    app.set_menu(
        build(&app, &locale).map_err(|error| AppError::new("menu_update_failed").detail(error))?,
    )
    .map_err(|error| AppError::new("menu_update_failed").detail(error))?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_shipped_catalog_is_mapped_to_the_native_menu() {
        let directory =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/i18n/catalogs");
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|v| v.to_str()) != Some("json") {
                continue;
            }
            let locale = path.file_stem().unwrap().to_str().unwrap();
            assert_eq!(
                catalog_source(locale),
                Some(std::fs::read_to_string(&path).unwrap().as_str()),
                "Shipped catalog {locale} must be included in catalog_source"
            );
        }
    }
    #[test]
    fn every_menu_role_maps_to_catalog_and_missing_locales_use_english() {
        let roles = [
            "file",
            "edit",
            "view",
            "window",
            "help",
            "about",
            "services",
            "hide",
            "hideOthers",
            "quit",
            "close",
            "undo",
            "redo",
            "cut",
            "copy",
            "paste",
            "selectAll",
            "fullscreen",
            "minimize",
            "maximize",
        ];
        for role in roles {
            for locale in ["en", "de", "ru", "ja", "fr", "zh-Hans"] {
                assert!(!label(locale, role).is_empty());
                assert_ne!(label(locale, role), role);
            }
            assert_eq!(label("__missing__", role), label("en", role));
        }
        assert_eq!(label("de", "edit"), "Bearbeiten");
        assert_eq!(label("ru", "copy"), "Копировать");
        assert_eq!(label("ja", "quit"), "Hamlet Editorを終了");
        assert!(label("de", "about").contains("Hamlet Editor"));
    }
}
