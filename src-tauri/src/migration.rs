//! Copy pre-release settings and backups before the first webview loads settings.

use std::fs::{self, OpenOptions};
use std::io;
use std::path::Path;
use tauri::Manager;

const LEGACY_IDENTIFIER: &str = "com.hamlet-editor.app";

#[derive(Default)]
pub struct MigrationNotice(pub std::sync::Mutex<Option<String>>);

#[tauri::command]
pub fn take_migration_notice(state: tauri::State<'_, MigrationNotice>) -> Option<String> {
    state.0.lock().ok()?.take()
}

pub fn migrate_legacy_data(app: &tauri::AppHandle) {
    let result = (|| {
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let local = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        let data_parent = data.parent().ok_or("Missing app data parent")?;
        let local_parent = local.parent().ok_or("Missing local data parent")?;
        let notices = migrate_data_dirs(
            &data_parent.join(LEGACY_IDENTIFIER),
            &data,
            &local_parent.join(LEGACY_IDENTIFIER),
            &local,
        );
        if notices.is_empty() {
            Ok(())
        } else {
            Err(notices.join("; "))
        }
    })();
    if let Err(error) = result {
        log::warn!("Legacy app data migration: {error}");
        *app.state::<MigrationNotice>().0.lock().unwrap() = Some(format!(
            "Previous version import needs attention: {error}. \
             Original files are unchanged. For an IO failure, quit the editor, resolve the cause and restart."
        ));
    }
}

// Settings must be ready before the webview starts. The originals remain the
// durable copy, so staged files do not need an expensive full fsync per file.
fn migrate_data_dirs(
    old_data: &Path,
    new_data: &Path,
    old_local: &Path,
    new_local: &Path,
) -> Vec<String> {
    match import_data(old_data, new_data, old_local, new_local) {
        Ok(notices) => notices,
        Err(error) => vec![error.to_string()],
    }
}

fn exists(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn remove_staging(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn import_data(
    old_data: &Path,
    new_data: &Path,
    old_local: &Path,
    new_local: &Path,
) -> io::Result<Vec<String>> {
    let settings = new_data.join("settings.json");
    let backups = new_local.join("backups");
    let journal = new_data.join(".legacy-import-ready");
    let staged_settings = new_data.join(".settings.json.import");
    let staged_backups = new_local.join(".backups.import");
    let has_staging = exists(&staged_settings)? || exists(&staged_backups)?;
    if !has_staging && !exists(&journal)? && (exists(&settings)? || exists(&backups)?) {
        return Ok(Vec::new());
    }
    if !has_staging
        && !exists(&old_data.join("settings.json"))?
        && !exists(&old_local.join("backups"))?
        && !exists(&journal)?
    {
        return Ok(Vec::new());
    }
    for root in [new_data, new_local] {
        if exists(root)? && !fs::symlink_metadata(root)?.is_dir() {
            return Err(io::Error::other(
                "Destination directory is not a regular directory",
            ));
        }
    }
    fs::create_dir_all(new_data)?;
    // An OS lock is released even after a crash. Never clean another live
    // instance's staging files. The lock file itself is deliberately retained.
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(new_data.join(".legacy-import-lock"))?;
    lock.lock()?;
    let ready = exists(&journal)?;
    if !ready {
        remove_staging(&staged_settings)?;
        remove_staging(&staged_backups)?;
        if exists(&settings)? || exists(&backups)? {
            return Ok(Vec::new());
        }
        let result = (|| {
            for (root, name, destination) in [
                (old_data, "settings.json", &staged_settings),
                (old_local, "backups", &staged_backups),
            ] {
                if !exists(root)? {
                    continue;
                }
                if !fs::symlink_metadata(root)?.is_dir() {
                    return Err(io::Error::other(
                        "Legacy directory is not a regular directory",
                    ));
                }
                let source = root.join(name);
                if exists(&source)? {
                    copy_new(&source, destination).map_err(|error| {
                        io::Error::new(
                            error.kind(),
                            format!(
                                "Cannot copy {} to {}: {error}",
                                source.display(),
                                destination.display()
                            ),
                        )
                    })?;
                }
            }
            // This journal is created only after BOTH copies finish. On a
            // crash between renames, the next start finishes the publication.
            let mut marker = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&journal)?;
            use std::io::Write;
            marker.write_all(b"ready\n")?;
            marker.sync_all()?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = remove_staging(&staged_settings);
            let _ = remove_staging(&staged_backups);
            let _ = remove_staging(&journal);
            return Err(error);
        }
    }
    let resources = [
        (&staged_backups, &backups, old_local.join("backups")),
        (&staged_settings, &settings, old_data.join("settings.json")),
    ];
    // A ready journal can outlive cached file data after an OS crash. Repair
    // truncated staging from the untouched originals before publishing anything.
    for (stage, destination, source) in &resources {
        if !exists(destination)?
            && (exists(stage)? || exists(source)?)
            && (!exists(stage)? || !matching_sizes(source, stage)?)
        {
            remove_staging(stage)?;
            copy_new(source, stage)?;
        }
    }
    let mut notices = Vec::new();
    for (stage, destination, source) in &resources {
        if !exists(stage)? {
            continue;
        }
        let publication = if exists(destination)? {
            Err(io::Error::from(io::ErrorKind::AlreadyExists))
        } else {
            retry_publication(|| {
                if *stage == &staged_settings {
                    // Same-filesystem hard links publish atomically without
                    // replacing settings saved by another running instance.
                    fs::hard_link(stage, destination)
                } else {
                    fs::rename(stage, destination)
                }
            })
        };
        match publication {
            Ok(()) => {
                if *stage == &staged_settings {
                    fs::remove_file(stage)?;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists || exists(destination)? => {
                remove_staging(stage)?;
                notices.push(format!(
                    "Kept current data at {}. Recover previous data manually from {} without overwriting current files",
                    destination.display(), source.display()
                ));
            }
            Err(error) => return Err(error),
        }
    }
    // A single directory sync per distinct target parent, never per backup.
    #[cfg(unix)]
    for parent in [new_data, new_local] {
        if parent.is_dir() {
            if let Err(error) = fs::File::open(parent).and_then(|dir| dir.sync_all()) {
                log::warn!("Cannot sync import directory {}: {error}", parent.display());
            }
        }
        if new_data == new_local {
            break;
        }
    }
    fs::remove_file(journal)?;
    Ok(notices)
}

// Retry transient scanner/indexer handles, especially on Windows. Other IO
// errors return immediately; the journal keeps the remaining import retryable.
fn retry_publication(mut publish: impl FnMut() -> io::Result<()>) -> io::Result<()> {
    for attempt in 0..10 {
        match publish() {
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied && attempt < 9 => {
                std::thread::sleep(std::time::Duration::from_millis(100 + attempt * 10));
            }
            result => return result,
        }
    }
    unreachable!()
}

fn matching_sizes(source: &Path, stage: &Path) -> io::Result<bool> {
    let original = fs::symlink_metadata(source)?;
    let copied = fs::symlink_metadata(stage)?;
    if original.is_file() && copied.is_file() {
        return Ok(original.len() == copied.len());
    }
    if !original.is_dir() || !copied.is_dir() {
        return Ok(false);
    }
    let mut count = 0;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let child = stage.join(entry.file_name());
        if !exists(&child)? || !matching_sizes(&entry.path(), &child)? {
            return Ok(false);
        }
        count += 1;
    }
    Ok(count == fs::read_dir(stage)?.collect::<io::Result<Vec<_>>>()?.len())
}

/// Create every destination exclusively; refuse symlinks and special files.
/// Remove only entries created by this attempt if a copy fails. Originals stay
/// available even when startup cannot complete the migration.
fn copy_new(source: &Path, destination: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if !metadata.is_dir() && !metadata.is_file() {
        return Err(io::Error::other(
            "Symlinks and special files are not migrated",
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::other("Missing destination parent"))?;
    fs::create_dir_all(parent)?;
    if !fs::symlink_metadata(parent)?.is_dir() {
        return Err(io::Error::other(
            "Destination directory is not a regular directory",
        ));
    }
    if metadata.is_dir() {
        fs::create_dir(destination)?;
        let result = (|| {
            for entry in fs::read_dir(source)? {
                let entry = entry?;
                copy_new(&entry.path(), &destination.join(entry.file_name()))?;
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(destination);
        }
        result
    } else {
        let mut input = fs::File::open(source)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)?;
        let result = io::copy(&mut input, &mut output).map(|_| ());
        drop(output);
        if result.is_err() {
            let _ = fs::remove_file(destination);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct Sandbox(PathBuf);

    impl Sandbox {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "hamlet-migration-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
        fn write(&self, name: &str, bytes: &[u8]) {
            let path = self.path(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, bytes).unwrap();
        }
        fn migrate(&self) -> Vec<String> {
            migrate_data_dirs(
                &self.path("old-data"),
                &self.path("new-data"),
                &self.path("old-local"),
                &self.path("new-local"),
            )
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn copies_roaming_settings_and_nested_local_backups_without_moving() {
        let sandbox = Sandbox::new();
        sandbox.write("old-data/settings.json", br#"{"autoBackup":true}"#);
        sandbox.write(
            "old-local/backups/profile_0/snapshot/raid/persist.raid.json",
            b"backup",
        );
        sandbox.write("old-local/unrelated", b"leave behind");
        assert!(sandbox.migrate().is_empty());
        for (old, new) in [
            ("old-data/settings.json", "new-data/settings.json"),
            (
                "old-local/backups/profile_0/snapshot/raid/persist.raid.json",
                "new-local/backups/profile_0/snapshot/raid/persist.raid.json",
            ),
        ] {
            assert_eq!(
                fs::read(sandbox.path(old)).unwrap(),
                fs::read(sandbox.path(new)).unwrap()
            );
        }
        assert!(!sandbox.path("new-local/unrelated").exists());
        sandbox.write("old-local/backups/later", b"stale");
        sandbox.write("old-data/settings.json", b"stale");
        assert!(sandbox.migrate().is_empty());
        assert!(!sandbox.path("new-local/backups/later").exists());
        assert_eq!(
            fs::read(sandbox.path("new-data/settings.json")).unwrap(),
            br#"{"autoBackup":true}"#
        );
    }

    #[test]
    fn same_data_and_local_directory_is_supported() {
        let sandbox = Sandbox::new();
        sandbox.write("old/settings.json", b"settings");
        sandbox.write("old/backups/snapshot/save", b"backup");
        let old = sandbox.path("old");
        let new = sandbox.path("new");
        assert!(migrate_data_dirs(&old, &new, &old, &new).is_empty());
        assert_eq!(fs::read(new.join("settings.json")).unwrap(), b"settings");
        assert_eq!(
            fs::read(new.join("backups/snapshot/save")).unwrap(),
            b"backup"
        );
    }

    #[test]
    fn either_existing_resource_prevents_importing_stale_data() {
        for existing in ["new-data/settings.json", "new-local/backups/current/save"] {
            let sandbox = Sandbox::new();
            sandbox.write("old-data/settings.json", b"old settings");
            sandbox.write("old-local/backups/old/save", b"old backup");
            sandbox.write(existing, b"current");
            assert!(sandbox.migrate().is_empty());
            assert_eq!(fs::read(sandbox.path(existing)).unwrap(), b"current");
            assert!(!sandbox.path("new-local/backups/old").exists());
            if existing.starts_with("new-local") {
                assert!(!sandbox.path("new-data/settings.json").exists());
            }
        }
    }

    #[test]
    fn missing_legacy_data_does_not_create_directories() {
        let sandbox = Sandbox::new();
        assert!(sandbox.migrate().is_empty());
        assert!(!sandbox.path("new-data").exists());
        assert!(!sandbox.path("new-local").exists());
    }

    #[test]
    fn copy_never_overwrites_an_existing_file_or_directory() {
        let sandbox = Sandbox::new();
        sandbox.write("source", b"old");
        sandbox.write("destination", b"current");
        assert!(copy_new(&sandbox.path("source"), &sandbox.path("destination")).is_err());
        assert_eq!(fs::read(sandbox.path("destination")).unwrap(), b"current");
        fs::create_dir(sandbox.path("source-dir")).unwrap();
        fs::create_dir(sandbox.path("destination-dir")).unwrap();
        assert!(copy_new(
            &sandbox.path("source-dir"),
            &sandbox.path("destination-dir")
        )
        .is_err());
        assert!(sandbox.path("destination-dir").is_dir());
    }

    #[test]
    fn io_errors_are_reported_without_touching_legacy_data() {
        let sandbox = Sandbox::new();
        sandbox.write("old-data/settings.json", b"settings");
        sandbox.write("old-local/backups/snapshot/save", b"backup");
        sandbox.write("new-data", b"not a directory");
        assert!(!sandbox.migrate().is_empty());
        assert_eq!(
            fs::read(sandbox.path("old-data/settings.json")).unwrap(),
            b"settings"
        );
    }

    #[cfg(unix)]
    #[test]
    fn failed_backup_copy_is_retryable_and_stale_staging_is_cleaned() {
        use std::os::unix::fs::symlink;
        let sandbox = Sandbox::new();
        sandbox.write("old-data/settings.json", b"settings");
        sandbox.write("old-local/backups/snapshot/save", b"backup");
        symlink(
            sandbox.path("old-data/settings.json"),
            sandbox.path("old-local/backups/bad"),
        )
        .unwrap();
        assert!(!sandbox.migrate().is_empty());
        assert!(!sandbox.path("new-data/settings.json").exists());
        assert!(!sandbox.path("new-local/backups").exists());
        sandbox.write("new-local/.backups.import/truncated", b"partial");
        fs::remove_file(sandbox.path("old-local/backups/bad")).unwrap();
        assert!(sandbox.migrate().is_empty());
        assert_eq!(
            fs::read(sandbox.path("new-data/settings.json")).unwrap(),
            b"settings"
        );
        assert_eq!(
            fs::read(sandbox.path("new-local/backups/snapshot/save")).unwrap(),
            b"backup"
        );
        assert!(!sandbox.path("new-local/backups/truncated").exists());
    }

    #[test]
    fn stale_staging_is_cleaned_without_overwriting_new_data() {
        let sandbox = Sandbox::new();
        sandbox.write("new-data/settings.json", b"current");
        sandbox.write("new-data/.settings.json.import", b"stale");
        sandbox.write("new-local/.backups.import/partial", b"partial");
        assert!(sandbox.migrate().is_empty());
        assert_eq!(
            fs::read(sandbox.path("new-data/settings.json")).unwrap(),
            b"current"
        );
        assert!(!sandbox.path("new-data/.settings.json.import").exists());
        assert!(!sandbox.path("new-local/.backups.import").exists());
        assert!(!sandbox.path("new-local/backups").exists());
    }

    #[test]
    fn interrupted_publication_preserves_new_settings_and_finishes_the_rest() {
        let sandbox = Sandbox::new();
        sandbox.write("new-data/.legacy-import-ready", b"ready\n");
        sandbox.write("new-data/.settings.json.import", b"old");
        sandbox.write("new-data/settings.json", b"current");
        sandbox.write("old-local/backups/save", b"backup");
        sandbox.write("new-local/.backups.import/save", b"backup");
        let notices = sandbox.migrate();
        assert_eq!(notices.len(), 1);
        assert!(notices[0].contains(&sandbox.path("old-data/settings.json").display().to_string()));
        assert_eq!(
            fs::read(sandbox.path("new-data/settings.json")).unwrap(),
            b"current"
        );
        assert_eq!(
            fs::read(sandbox.path("new-local/backups/save")).unwrap(),
            b"backup"
        );
        assert!(!sandbox.path("new-data/.settings.json.import").exists());
        assert!(!sandbox.path("new-data/.legacy-import-ready").exists());
        assert!(sandbox.migrate().is_empty());
    }

    #[test]
    fn interrupted_publication_finishes_without_overwriting_completed_backups() {
        let sandbox = Sandbox::new();
        sandbox.write("old-data/settings.json", b"settings");
        sandbox.write("new-data/.legacy-import-ready", b"ready\n");
        sandbox.write("new-data/.settings.json.import", b"settings");
        sandbox.write("new-local/backups/snapshot/save", b"complete");
        assert!(sandbox.migrate().is_empty());
        assert_eq!(
            fs::read(sandbox.path("new-data/settings.json")).unwrap(),
            b"settings"
        );
        assert_eq!(
            fs::read(sandbox.path("new-local/backups/snapshot/save")).unwrap(),
            b"complete"
        );
        assert!(!sandbox.path("new-data/.legacy-import-ready").exists());
    }

    #[test]
    fn legacy_webview_only_does_not_create_import_state() {
        let sandbox = Sandbox::new();
        sandbox.write("old-local/EBWebView/data", b"webview");
        for _ in 0..2 {
            assert!(sandbox.migrate().is_empty());
            assert!(!sandbox.path("new-data").exists());
            assert!(!sandbox.path("new-local").exists());
        }
    }

    #[test]
    fn ready_staging_is_recopied_when_file_sizes_or_entries_differ() {
        let sandbox = Sandbox::new();
        sandbox.write("old-data/settings.json", b"complete settings");
        sandbox.write("old-local/backups/snapshot/save", b"complete backup");
        sandbox.write("old-local/backups/snapshot/other", b"other");
        sandbox.write("new-data/.legacy-import-ready", b"ready\n");
        sandbox.write("new-data/.settings.json.import", b"");
        sandbox.write("new-local/.backups.import/snapshot/save", b"partial");
        sandbox.write("new-local/.backups.import/extra", b"unwanted");
        assert!(sandbox.migrate().is_empty());
        assert_eq!(
            fs::read(sandbox.path("new-data/settings.json")).unwrap(),
            b"complete settings"
        );
        assert_eq!(
            fs::read(sandbox.path("new-local/backups/snapshot/save")).unwrap(),
            b"complete backup"
        );
        assert!(sandbox.path("new-local/backups/snapshot/other").exists());
        assert!(!sandbox.path("new-local/backups/extra").exists());
        assert!(!sandbox.path("new-data/.legacy-import-ready").exists());
    }

    #[cfg(unix)]
    #[test]
    fn failed_staging_repair_is_retried_even_when_the_stage_was_removed() {
        use std::os::unix::fs::symlink;
        let sandbox = Sandbox::new();
        sandbox.write("old-local/backups/save", b"complete backup");
        symlink(
            sandbox.path("old-local/backups/save"),
            sandbox.path("old-local/backups/bad"),
        )
        .unwrap();
        sandbox.write("new-data/.legacy-import-ready", b"ready\n");
        sandbox.write("new-local/.backups.import/save", b"");
        assert!(!sandbox.migrate().is_empty());
        assert!(!sandbox.path("new-local/.backups.import").exists());
        fs::remove_file(sandbox.path("old-local/backups/bad")).unwrap();
        assert!(sandbox.migrate().is_empty());
        assert_eq!(
            fs::read(sandbox.path("new-local/backups/save")).unwrap(),
            b"complete backup"
        );
        assert!(!sandbox.path("new-data/.legacy-import-ready").exists());
    }

    #[test]
    fn ready_conflicting_backups_preserve_current_data_and_publish_settings() {
        let sandbox = Sandbox::new();
        sandbox.write("old-data/settings.json", b"settings");
        sandbox.write("new-data/.settings.json.import", b"settings");
        sandbox.write("new-data/.legacy-import-ready", b"ready\n");
        sandbox.write("new-local/backups/current", b"current");
        sandbox.write("new-local/.backups.import/old", b"old");
        let notices = sandbox.migrate();
        assert_eq!(notices.len(), 1);
        assert!(notices[0].contains(&sandbox.path("old-local/backups").display().to_string()));
        assert_eq!(
            fs::read(sandbox.path("new-local/backups/current")).unwrap(),
            b"current"
        );
        assert_eq!(
            fs::read(sandbox.path("new-data/settings.json")).unwrap(),
            b"settings"
        );
        assert!(!sandbox.path("new-local/backups/old").exists());
        assert!(!sandbox.path("new-local/.backups.import").exists());
        assert!(!sandbox.path("new-data/.legacy-import-ready").exists());
        assert!(sandbox.migrate().is_empty());
    }

    #[test]
    fn publication_retries_permission_denied_but_not_other_errors() {
        let mut attempts = 0;
        retry_publication(|| {
            attempts += 1;
            if attempts < 3 {
                Err(io::Error::from(io::ErrorKind::PermissionDenied))
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(attempts, 3);
        attempts = 0;
        let error = retry_publication(|| {
            attempts += 1;
            Err(io::Error::from(io::ErrorKind::AlreadyExists))
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(attempts, 1);
    }

    #[test]
    fn settings_publication_never_replaces_an_existing_destination() {
        let sandbox = Sandbox::new();
        sandbox.write("stage", b"old settings");
        sandbox.write("destination", b"current settings");
        let error =
            retry_publication(|| fs::hard_link(sandbox.path("stage"), sandbox.path("destination")))
                .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(
            fs::read(sandbox.path("destination")).unwrap(),
            b"current settings"
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_sources_destinations_and_legacy_roots_are_refused() {
        use std::os::unix::fs::symlink;
        let sandbox = Sandbox::new();
        sandbox.write("outside/save", b"untouched");
        sandbox.write("old-local/backups/snapshot/save", b"backup");
        symlink(
            sandbox.path("outside"),
            sandbox.path("old-local/backups/link"),
        )
        .unwrap();
        assert!(!sandbox.migrate().is_empty());
        assert!(!sandbox.path("new-local/backups").exists());
        assert_eq!(
            fs::read(sandbox.path("outside/save")).unwrap(),
            b"untouched"
        );
        symlink(sandbox.path("outside"), sandbox.path("new-local/backups")).unwrap();
        assert!(sandbox.migrate().is_empty());
        assert!(!sandbox.path("outside/snapshot").exists());

        let other = Sandbox::new();
        other.write("outside/settings.json", b"private");
        symlink(other.path("outside"), other.path("old-data")).unwrap();
        assert!(!other.migrate().is_empty());
        assert!(!other.path("new-data/settings.json").exists());
    }
}
