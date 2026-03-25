/**
 * Tauri command wrappers for backup operations.
 *
 * Each function calls a Rust backend command via `invoke`. Errors are
 * propagated to the caller (not swallowed) since backup failures should
 * be surfaced to the user.
 */

import { invoke } from '@tauri-apps/api/core';

// ── Types matching the Rust BackupEntry struct ──

export interface BackupEntry {
	path: string;
	timestamp: string; // ISO 8601
	file_count: number;
	profile_id: string;
}

// ── Commands ──

/**
 * Create a timestamped backup of all save files in the profile.
 * Returns the backup directory path.
 */
export async function createBackup(profilePath: string): Promise<string> {
	return await invoke<string>('create_backup', { profilePath });
}

/**
 * List all editor-created backups for the given profile.
 * Returns entries sorted newest-first.
 */
export async function listBackups(profilePath: string): Promise<BackupEntry[]> {
	return await invoke<BackupEntry[]>('list_backups', { profilePath });
}

/**
 * Restore a backup to the profile directory.
 * A pre-restore safety backup is created automatically.
 */
export async function restoreBackup(backupPath: string, profilePath: string): Promise<void> {
	await invoke<void>('restore_backup', { backupPath, profilePath });
}

/**
 * Restore from the game's own backup/ subdirectory inside the profile.
 * A pre-restore safety backup is created automatically.
 */
export async function restoreGameBackup(profilePath: string): Promise<void> {
	await invoke<void>('restore_game_backup', { profilePath });
}
