use super::error::AppError;
use tauri_plugin_opener::OpenerExt;

const REPOSITORY_URL: &str = "https://github.com/zendevio/hamlet-editor";
const ISSUES_URL: &str = "https://github.com/zendevio/hamlet-editor/issues";

/// Resolve a fixed project link. The webview names a link, never a URL, so it
/// cannot open arbitrary addresses.
fn project_url(link: &str) -> Option<&'static str> {
    match link {
        "repository" => Some(REPOSITORY_URL),
        "issues" => Some(ISSUES_URL),
        _ => None,
    }
}

/// Open a project link in the system browser.
#[tauri::command]
pub fn open_project_link(app_handle: tauri::AppHandle, link: String) -> Result<(), AppError> {
    let url = project_url(&link).ok_or_else(|| {
        AppError::new("unexpected").detail(format!("unknown project link {link}"))
    })?;
    app_handle
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::new("unexpected").detail(format!("open {url}: {e}")))
}

#[cfg(test)]
mod tests {
    use super::project_url;

    #[test]
    fn only_fixed_project_links_resolve() {
        assert_eq!(
            project_url("issues"),
            Some("https://github.com/zendevio/hamlet-editor/issues")
        );
        assert_eq!(
            project_url("repository"),
            Some("https://github.com/zendevio/hamlet-editor")
        );
        assert_eq!(project_url("https://example.com"), None);
    }
}
