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
 * Load all save data from disk for the active profile.
 * Returns the full parsed profile data (filename → decoded JSON).
 */
export async function loadProfile(profilePath: string): Promise<Record<string, unknown>> {
	return await invoke<Record<string, unknown>>('load_profile', { profilePath });
}

// TODO: decodeSaveFile(path: string): Promise<unknown>
// The `decode_save_file` command was removed from the public Tauri command handler
// (it is now used internally by `load_profile`). If a standalone decode command is
// re-added to the backend, add the wrapper here:
//
// export async function decodeSaveFile(path: string): Promise<unknown> {
//   return await invoke<unknown>('decode_save_file', { path });
// }
