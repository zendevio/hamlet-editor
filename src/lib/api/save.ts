/**
 * Tauri command wrappers for save operations.
 *
 * Each function calls a Rust backend command via `invoke`. Errors are
 * propagated to the caller since save failures must be surfaced to the user.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Save all dirty file data for the active profile.
 * The backend checks load provenance and disk freshness, then commits all writes and deletions transactionally.
 * The caller handles backups and input validation.
 */
export async function saveProfile(
	profilePath: string,
	data: Record<string, unknown>,
	nameTableVersion: number
): Promise<void> {
	await invoke<void>('save_profile', { profilePath, data, nameTableVersion });
}

/**
 * Load all save data from disk for the active profile.
 * Returns parsed file data and the name-table version used for loading.
 */
export interface LoadedProfile {
	data: Record<string, unknown>;
	name_table_version: number;
}

export async function loadProfile(profilePath: string): Promise<LoadedProfile> {
	return await invoke<LoadedProfile>('load_profile', { profilePath });
}
