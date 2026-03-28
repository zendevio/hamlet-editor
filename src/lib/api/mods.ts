/**
 * Tauri command wrappers for mod scanning.
 */

import { invoke } from '@tauri-apps/api/core';

export interface ModInfo {
	name: string;
	path: string;
	has_heroes: boolean;
	has_trinkets: boolean;
}

/**
 * Scan local and Steam Workshop mod directories for the given game install.
 * Returns an empty array on any error or when no mods are found.
 */
export async function scanModDirectories(gamePath: string): Promise<ModInfo[]> {
	try {
		return await invoke<ModInfo[]>('scan_mod_directories', { gamePath, steamLibraryPath: null });
	} catch {
		return [];
	}
}
