/**
 * Tauri command wrappers for save operations.
 *
 * Each function calls a Rust backend command via `invoke`. Errors are
 * propagated to the caller since save failures must be surfaced to the user.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Save all dirty file data for the active profile.
 * The backend handles auto-backup (if enabled), binary encoding,
 * round-trip validation, and atomic file writes.
 */
export async function saveProfile(
	profilePath: string,
	data: Record<string, unknown>
): Promise<void> {
	await invoke<void>('save_profile', { profilePath, data });
}

/**
 * Reload all save data from disk for the active profile.
 * Returns the full parsed profile data.
 */
export async function reloadProfile(profilePath: string): Promise<Record<string, unknown>> {
	return await invoke<Record<string, unknown>>('reload_profile', { profilePath });
}
