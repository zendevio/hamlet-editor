//! Copy pre-release settings and backups before the first webview loads settings.

use std::fs::{self, OpenOptions};
use std::io;
use std::path::Path;
use tauri::Manager;

const LEGACY_IDENTIFIER: &str = "com.hamlet-editor.app";

pub fn migrate_legacy_data(app: &tauri::AppHandle) {
    let paths = app.path();
    let roots = paths
        .app_data_dir()
        .and_then(|data| paths.app_local_data_dir().map(|local| (data, local)));
    match roots {
        Ok((data, local)) => {
            let (Some(data_parent), Some(local_parent)) = (data.parent(), local.parent()) else {
                warn(format_args!(
                    "Could not resolve legacy app data directories"
                ));
                return;
            };
            for error in migrate_data_dirs(
                &data_parent.join(LEGACY_IDENTIFIER),
                &data,
                &local_parent.join(LEGACY_IDENTIFIER),
                &local,
            ) {
                warn(format_args!("Legacy app data migration: {error}"));
            }
        }
        Err(error) => warn(format_args!(
            "Could not resolve app data directories for migration: {error}"
        )),
    }
}

// The file logger is debug-only. Keep migration failures visible on stderr in
// release builds too, without making startup depend on logging initialization.
fn warn(message: std::fmt::Arguments<'_>) {
    if cfg!(debug_assertions) {
        log::warn!("{message}");
    } else {
        eprintln!("{message}");
    }
}

// Settings use AppData (roaming on Windows); backups use AppLocalData.
// Existing settings or backups make this an established installation, which
// must never import stale pre-release data. Successful copies make this a no-op
// on subsequent starts, including when both platform directories are the same.
fn migrate_data_dirs(
    old_data: &Path,
    new_data: &Path,
    old_local: &Path,
    new_local: &Path,
) -> Vec<String> {
    let settings = new_data.join("settings.json");
    let backups = new_local.join("backups");
    for destination in [&settings, &backups] {
        match fs::symlink_metadata(destination) {
            Ok(_) => return Vec::new(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return vec![format!("Cannot inspect {}: {error}", destination.display())]
            }
        }
    }

    let mut errors = Vec::new();
    for (source, destination) in [
        (old_data.join("settings.json"), settings),
        (old_local.join("backups"), backups),
    ] {
        // Check the root too: a symlink must not redirect the copy elsewhere.
        let root = source.parent().expect("Migration source has a parent");
        match fs::symlink_metadata(root) {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => {
                errors.push(format!(
                    "Legacy directory is not a regular directory: {}",
                    root.display()
                ));
                continue;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                errors.push(format!("Cannot inspect {}: {error}", root.display()));
                continue;
            }
        }
        match fs::symlink_metadata(&source) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                errors.push(format!("Cannot inspect {}: {error}", source.display()));
                continue;
            }
            Ok(_) => {}
        }
        if let Err(error) = copy_new(&source, &destination) {
            errors.push(format!(
                "Cannot copy {} to {}: {error}",
                source.display(),
                destination.display()
            ));
        }
    }
    errors
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
        let result = io::copy(&mut input, &mut output).and_then(|_| output.sync_all());
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
