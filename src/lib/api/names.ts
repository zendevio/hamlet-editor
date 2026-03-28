/**
 * Tauri command wrappers for name table and localization.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Generate a list of hero name strings from the game's name table files.
 * Returns an empty array if the command is not yet implemented or fails.
 */
export async function generateNameTable(gamePath: string): Promise<string[]> {
	try {
		return await invoke<string[]>('generate_name_table', { gamePath });
	} catch {
		return [];
	}
}

/**
 * Load the game's localization strings as a key→value map.
 * Returns an empty object if the command is not yet implemented or fails.
 */
export async function loadLocalization(gamePath: string): Promise<Record<string, string>> {
	try {
		return await invoke<Record<string, string>>('load_localization', { gamePath });
	} catch {
		return {};
	}
}

/**
 * Push the name table into Rust managed state so that subsequent
 * `load_profile` calls can resolve hashed DSON field names.
 */
export async function setNameTableOnBackend(names: string[]): Promise<void> {
	try {
		await invoke('set_name_table', { names });
	} catch {
		// Non-fatal — worst case hashed names remain unresolved
	}
}
