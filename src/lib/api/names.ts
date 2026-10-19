/**
 * Tauri command wrappers for name table and localization.
 */

import { invoke } from '@tauri-apps/api/core';

/** Generate all known DSON identifiers from the game installation. */
export async function generateNameTable(gamePath: string): Promise<string[]> {
	return await invoke<string[]>('generate_name_table', { gamePath });
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
 * `load_profile` calls can resolve upgrade tree hashes.
 */
export async function setNameTableOnBackend(names: string[]): Promise<void> {
	await invoke('set_name_table', { names });
}

let readyGamePath = '';
let pendingNames: Promise<void> | null = null;

/** Every profile load, including switches and restores, waits for this barrier. */
export async function ensureNameTable(gamePath: string): Promise<void> {
	if (!gamePath) throw new Error('Select a game installation before loading a profile.');
	if (pendingNames) {
		await pendingNames;
		return ensureNameTable(gamePath);
	}
	if (readyGamePath === gamePath) return;
	pendingNames = (async () => {
		const names = await generateNameTable(gamePath);
		if (names.length === 0) throw new Error('Name table is empty. Check the game installation.');
		await setNameTableOnBackend(names);
		readyGamePath = gamePath;
	})();
	try {
		await pendingNames;
	} finally {
		pendingNames = null;
	}
}
