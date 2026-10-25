use super::error::AppError;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TRANSACTION: AtomicU64 = AtomicU64::new(0);

pub(crate) fn unique_suffix() -> String {
    format!(
        "{}-{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        std::process::id(),
        NEXT_TRANSACTION.fetch_add(1, Ordering::Relaxed)
    )
}

pub(crate) fn validate_relative(path: &Path) -> Result<(), AppError> {
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        || path.to_string_lossy().contains('\\')
    {
        return Err(
            AppError::new("relative_path_invalid").param("path", path.display().to_string())
        );
    }
    Ok(())
}

fn validate_target(root: &Path, relative: &Path) -> Result<(), AppError> {
    validate_relative(relative)?;
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(
                    AppError::new("save_path_symlink").param("path", path.display().to_string())
                );
            }
            Ok(meta) if path == root.join(relative) && !meta.is_file() => {
                return Err(
                    AppError::new("save_target_invalid").param("path", path.display().to_string())
                );
            }
            Ok(meta) if path != root.join(relative) && !meta.is_dir() => {
                return Err(
                    AppError::new("save_parent_invalid").param("path", path.display().to_string())
                );
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(AppError::new("path_inspect")
                    .param("path", path.display().to_string())
                    .detail(e))
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn sync_dir(path: &Path) -> std::io::Result<()> {
    fs::File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_dir(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

struct Staging(PathBuf);

impl Drop for Staging {
    fn drop(&mut self) {
        if let Err(e) = fs::remove_dir_all(&self.0) {
            log::warn!("Failed to clean transaction {}: {e}", self.0.display());
        }
    }
}

pub(crate) fn apply_changes(
    root: &Path,
    writes: &BTreeMap<PathBuf, Vec<u8>>,
    deletes: &BTreeSet<PathBuf>,
) -> Result<(), AppError> {
    apply_changes_with_hook(root, writes, deletes, &mut |_| Ok(()))
}

/// Read-only destination validation, also used by restore preflight.
pub(crate) fn validate_changes(
    root: &Path,
    writes: &BTreeMap<PathBuf, Vec<u8>>,
    deletes: &BTreeSet<PathBuf>,
) -> Result<(), AppError> {
    for relative in writes.keys().chain(deletes) {
        validate_target(root, relative)?;
        if writes.contains_key(relative) && deletes.contains(relative) {
            return Err(
                AppError::new("transaction_conflict").param("path", relative.display().to_string())
            );
        }
    }
    Ok(())
}

/// Stage and sync every replacement before touching targets. Originals stay in
/// the same filesystem until all replacements and deletions have succeeded.
pub(crate) fn apply_changes_with_hook(
    root: &Path,
    writes: &BTreeMap<PathBuf, Vec<u8>>,
    deletes: &BTreeSet<PathBuf>,
    after_change: &mut dyn FnMut(usize) -> Result<(), AppError>,
) -> Result<(), AppError> {
    let root = root.canonicalize().map_err(|e| {
        AppError::new("profile_invalid")
            .param("path", root.display().to_string())
            .detail(e)
    })?;
    validate_changes(&root, writes, deletes)?;
    if writes.is_empty() && deletes.is_empty() {
        return Ok(());
    }
    let stage_path = root.join(format!(".hamlet-transaction-{}", unique_suffix()));
    fs::create_dir(&stage_path).map_err(|e| AppError::new("transaction_stage").detail(e))?;
    let stage = Staging(stage_path);
    let io_error = |path: &Path, e| {
        AppError::new("transaction_io")
            .param("path", path.display().to_string())
            .detail(e)
    };
    for (relative, bytes) in writes {
        let path = stage.0.join("new").join(relative);
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| io_error(relative, e))?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| io_error(relative, e))?;
        let mut permissions = file
            .metadata()
            .map_err(|e| io_error(relative, e))?
            .permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            permissions.set_mode(permissions.mode() | 0o200);
        }
        #[cfg(not(unix))]
        permissions.set_readonly(false);
        file.set_permissions(permissions)
            .map_err(|e| io_error(relative, e))?;
        file.write_all(bytes).map_err(|e| io_error(relative, e))?;
        file.sync_all().map_err(|e| io_error(relative, e))?;
        sync_dir(path.parent().unwrap()).map_err(|e| io_error(relative, e))?;
    }

    let mut applied = Vec::new();
    let mut created_dirs = Vec::new();
    let outcome = (|| {
        // Deletions happen only after all replacements have been installed.
        for relative in writes.keys().chain(deletes) {
            let target = root.join(relative);
            if !writes.contains_key(relative) && !target.exists() {
                continue;
            }
            let mut missing = Vec::new();
            let mut parent = target.parent().unwrap();
            while !parent.exists() {
                missing.push(parent.to_path_buf());
                parent = parent.parent().unwrap();
            }
            for parent in missing.into_iter().rev() {
                fs::create_dir(&parent).map_err(|e| io_error(relative, e))?;
                created_dirs.push(parent);
            }
            let original = stage.0.join("old").join(relative);
            fs::create_dir_all(original.parent().unwrap()).map_err(|e| io_error(relative, e))?;
            let existed = target.exists();
            if existed {
                fs::rename(&target, &original).map_err(|e| io_error(relative, e))?;
            }
            applied.push((relative.clone(), existed));
            if writes.contains_key(relative) {
                fs::rename(stage.0.join("new").join(relative), &target)
                    .map_err(|e| io_error(relative, e))?;
            }
            after_change(applied.len())?;
            sync_dir(target.parent().unwrap()).map_err(|e| io_error(relative, e))?;
        }
        sync_dir(&root).map_err(|e| io_error(&root, e))
    })();

    if let Err(error) = outcome {
        let mut rollback_errors = Vec::new();
        for (relative, existed) in applied.into_iter().rev() {
            let target = root.join(&relative);
            let rollback = if existed {
                // Remove the replacement first for Windows rename semantics.
                if target.exists() {
                    fs::remove_file(&target).map_err(|e| io_error(&relative, e))
                } else {
                    Ok(())
                }
                .and_then(|()| {
                    fs::rename(stage.0.join("old").join(&relative), &target)
                        .map_err(|e| io_error(&relative, e))
                })
            } else if target.exists() {
                fs::remove_file(&target).map_err(|e| io_error(&relative, e))
            } else {
                Ok(())
            };
            if let Err(e) = rollback {
                rollback_errors.push(e);
            }
        }
        for dir in created_dirs.into_iter().rev() {
            if let Err(e) = fs::remove_dir(&dir) {
                rollback_errors.push(io_error(&dir, e));
            }
        }
        if !rollback_errors.is_empty() {
            let recovery = stage.0.clone();
            std::mem::forget(stage);
            let error = AppError::new("transaction_rollback")
                .param("recoveryPath", recovery.display().to_string())
                .detail(
                    std::iter::once(error)
                        .chain(rollback_errors)
                        .map(|error| {
                            if let Some(path) = error.params.get("path").and_then(|p| p.as_str()) {
                                format!("{path}: {}", error.raw_detail())
                            } else {
                                error.to_string()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
            log::error!("{error}");
            return Err(error);
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injected_io_failure_rolls_back_replacements_deletions_and_new_directories() {
        for fail_after in 1..=3 {
            let root = std::env::temp_dir().join(format!("hamlet-rollback-{}", unique_suffix()));
            fs::create_dir(&root).unwrap();
            fs::write(root.join("persist.game.json"), b"original game").unwrap();
            fs::write(root.join("persist.raid.json"), b"original raid").unwrap();
            let writes = BTreeMap::from([
                (PathBuf::from("persist.game.json"), b"edited game".to_vec()),
                (
                    PathBuf::from("new_raid/persist.raid.json"),
                    b"new raid".to_vec(),
                ),
            ]);
            let deletes = BTreeSet::from([PathBuf::from("persist.raid.json")]);
            let error = apply_changes_with_hook(&root, &writes, &deletes, &mut |count| {
                if count == fail_after {
                    Err(AppError::new("transaction_io")
                        .param("path", "fixture")
                        .detail("injected I/O failure"))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
            assert_eq!(
                error,
                AppError::new("transaction_io")
                    .param("path", "fixture")
                    .detail("injected I/O failure")
            );
            assert_eq!(
                fs::read(root.join("persist.game.json")).unwrap(),
                b"original game"
            );
            assert_eq!(
                fs::read(root.join("persist.raid.json")).unwrap(),
                b"original raid"
            );
            assert!(!root.join("new_raid").exists());
            assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
            fs::remove_dir_all(root).unwrap();
        }
    }
}

#[cfg(test)]
mod error_tests {
    use super::*;

    #[test]
    fn unsafe_paths_and_plan_conflicts_retain_the_path() {
        for path in ["", "../outside", "/absolute", "folder\\file"] {
            assert_eq!(
                validate_relative(Path::new(path)).unwrap_err(),
                AppError::new("relative_path_invalid").param("path", path)
            );
        }
        let root = std::env::temp_dir().join(format!("hamlet-errors-{}", unique_suffix()));
        fs::create_dir(&root).unwrap();
        let relative = PathBuf::from("persist.game.json");
        let writes = BTreeMap::from([(relative.clone(), vec![])]);
        let deletes = BTreeSet::from([relative.clone()]);
        assert_eq!(
            validate_changes(&root, &writes, &deletes).unwrap_err(),
            AppError::new("transaction_conflict").param("path", "persist.game.json")
        );
        fs::create_dir(root.join(&relative)).unwrap();
        assert_eq!(
            validate_target(&root, &relative).unwrap_err(),
            AppError::new("save_target_invalid")
                .param("path", root.join(&relative).display().to_string())
        );
        fs::remove_dir(root.join(&relative)).unwrap();
        fs::write(root.join("parent"), b"not a directory").unwrap();
        assert_eq!(
            validate_target(&root, Path::new("parent/persist.game.json")).unwrap_err(),
            AppError::new("save_parent_invalid")
                .param("path", root.join("parent").display().to_string())
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("parent"), root.join(&relative)).unwrap();
            assert_eq!(
                validate_target(&root, &relative).unwrap_err(),
                AppError::new("save_path_symlink")
                    .param("path", root.join(&relative).display().to_string())
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rollback_failure_retains_recovery_path_and_original_diagnostics() {
        let root = std::env::temp_dir().join(format!("hamlet-recovery-{}", unique_suffix()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("persist.game.json"), b"original").unwrap();
        let writes = BTreeMap::from([(PathBuf::from("persist.game.json"), b"edited".to_vec())]);
        let error = apply_changes_with_hook(&root, &writes, &BTreeSet::new(), &mut |_| {
            // Replace the newly installed file with a directory so rollback's
            // remove_file fails. The original must survive in the staging tree.
            fs::remove_file(root.join("persist.game.json")).unwrap();
            fs::create_dir(root.join("persist.game.json")).unwrap();
            Err(AppError::new("transaction_io")
                .param("path", "persist.game.json")
                .detail("original injected OS diagnostic"))
        })
        .unwrap_err();
        assert_eq!(error.code, "transaction_rollback");
        let recovery = PathBuf::from(error.params["recoveryPath"].as_str().unwrap());
        assert!(recovery.starts_with(root.canonicalize().unwrap()));
        assert_eq!(
            fs::read(recovery.join("old/persist.game.json")).unwrap(),
            b"original"
        );
        assert!(error
            .detail
            .as_deref()
            .unwrap()
            .contains("original injected OS diagnostic"));
        assert!(error.detail.as_deref().unwrap().lines().count() >= 2);
        assert!(error
            .detail
            .as_deref()
            .unwrap()
            .lines()
            .all(|line| line.contains("persist.game.json")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn multiple_rollback_failures_name_every_file_and_keep_every_original() {
        super::super::error::test_log::start();
        let root = std::env::temp_dir().join(format!("hamlet-multi-recovery-{}", unique_suffix()));
        fs::create_dir(&root).unwrap();
        let names = ["persist.game.json", "persist.roster.json"];
        let mut writes = BTreeMap::new();
        for name in names {
            fs::write(root.join(name), format!("original {name}")).unwrap();
            writes.insert(PathBuf::from(name), b"edited".to_vec());
        }
        let error = apply_changes_with_hook(&root, &writes, &BTreeSet::new(), &mut |count| {
            if count != 2 {
                return Ok(());
            }
            for name in names {
                fs::remove_file(root.join(name)).unwrap();
                fs::create_dir(root.join(name)).unwrap();
            }
            Err(AppError::new("transaction_io")
                .param("path", "original-failure.json")
                .detail("original injected OS diagnostic"))
        })
        .unwrap_err();
        assert_eq!(error.code, "transaction_rollback");
        super::super::error::test_log::assert_logged(&error);
        let recovery = PathBuf::from(error.params["recoveryPath"].as_str().unwrap());
        let lines: Vec<_> = error.detail.as_deref().unwrap().lines().collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(
            lines[0],
            "original-failure.json: original injected OS diagnostic"
        );
        for name in names {
            assert!(lines[1..]
                .iter()
                .any(|line| line.starts_with(&format!("{name}: "))));
            assert_eq!(
                fs::read_to_string(recovery.join("old").join(name)).unwrap(),
                format!("original {name}")
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
}
