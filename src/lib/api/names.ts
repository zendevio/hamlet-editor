/**
 * Tauri command wrappers for name table and localization.
 */

import type { MessageDescriptor } from '#lib/errors.js';
import { invoke } from '@tauri-apps/api/core';

/** Generate all known DSON identifiers from the game installation. */
export async function generateNameTable(gamePath: string): Promise<string[]> {
	return await invoke<string[]>('generate_name_table', { gamePath });
}

/** Load display strings only; DSON identifiers use ensureNameTable independently. */
export async function loadLocalization(gamePath: string, language = 'english'): Promise<Record<string, string>> {
	return await invoke<Record<string, string>>('load_localization', { gamePath, language });
}

export async function availableGameTextLanguages(gamePath: string): Promise<string[]> {
	return await invoke<string[]>('available_game_text_languages', { gamePath });
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
	if (!gamePath) throw { id: 'error.game_install_required' } satisfies MessageDescriptor;
	if (pendingNames) {
		await pendingNames;
		return ensureNameTable(gamePath);
	}
	if (readyGamePath === gamePath) return;
	pendingNames = (async () => {
		const names = await generateNameTable(gamePath);
		if (names.length === 0) throw { id: 'error.names_install_empty' } satisfies MessageDescriptor;
		await setNameTableOnBackend(names);
		readyGamePath = gamePath;
	})();
	try {
		await pendingNames;
	} finally {
		pendingNames = null;
	}
}
