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

pub(crate) fn validate_relative(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        || path.to_string_lossy().contains('\\')
    {
        return Err(format!("Invalid relative save path: {}", path.display()));
    }
    Ok(())
}

fn validate_target(root: &Path, relative: &Path) -> Result<(), String> {
    validate_relative(relative)?;
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!("Symlink in save path: {}", path.display()));
            }
            Ok(meta) if path == root.join(relative) && !meta.is_file() => {
                return Err(format!("Save target is not a file: {}", path.display()));
            }
            Ok(meta) if path != root.join(relative) && !meta.is_dir() => {
                return Err(format!(
                    "Save parent is not a directory: {}",
                    path.display()
                ));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Failed to inspect {}: {e}", path.display())),
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
) -> Result<(), String> {
    apply_changes_with_hook(root, writes, deletes, &mut |_| Ok(()))
}

/// Read-only destination validation, also used by restore preflight.
pub(crate) fn validate_changes(
    root: &Path,
    writes: &BTreeMap<PathBuf, Vec<u8>>,
    deletes: &BTreeSet<PathBuf>,
) -> Result<(), String> {
    for relative in writes.keys().chain(deletes) {
        validate_target(root, relative)?;
        if writes.contains_key(relative) && deletes.contains(relative) {
            return Err(format!("Cannot write and delete {}", relative.display()));
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
    after_change: &mut dyn FnMut(usize) -> Result<(), String>,
) -> Result<(), String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("Invalid profile: {e}"))?;
    validate_changes(&root, writes, deletes)?;
    if writes.is_empty() && deletes.is_empty() {
        return Ok(());
    }
    let stage_path = root.join(format!(".hamlet-transaction-{}", unique_suffix()));
    fs::create_dir(&stage_path).map_err(|e| format!("Failed to stage saves: {e}"))?;
    let stage = Staging(stage_path);
    let io_error = |path: &Path, e| format!("Save transaction failed for {}: {e}", path.display());
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
            return Err(format!(
                "{error}; rollback failed: {}. Recovery files: {}",
                rollback_errors.join("; "),
                recovery.display()
            ));
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
                    Err("injected I/O failure".into())
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
            assert_eq!(error, "injected I/O failure");
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
