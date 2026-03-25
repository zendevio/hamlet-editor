/**
 * Tauri command wrappers for path detection.
 *
 * Each function calls a Rust backend command via `invoke`. Since the backend
 * commands may not be implemented yet, every call is wrapped in try/catch
 * with sensible fallbacks (empty arrays / false).
 */

import { invoke } from '@tauri-apps/api/core';

// ── Types matching the Rust structs in path-detection.md ──

export type SaveSource = 'Steam' | 'Gog' | 'Epic' | 'Manual';
export type InstallSource = 'Steam' | 'Gog' | 'Manual';

export interface SaveLocation {
	path: string;
	source: SaveSource;
	steam_user_id: string | null;
	profile_id: string;
	has_active_raid: boolean;
	week_number: number | null;
}

export interface GameInstall {
	path: string;
	source: InstallSource;
	has_crimson_court: boolean;
	has_shieldbreaker: boolean;
	has_color_of_madness: boolean;
	has_musketeer: boolean;
	has_mods: boolean;
}

// ── Commands ──

export async function detectSaveLocations(): Promise<SaveLocation[]> {
	try {
		return await invoke<SaveLocation[]>('detect_save_locations');
	} catch {
		return [];
	}
}

export async function detectGameInstallations(): Promise<GameInstall[]> {
	try {
		return await invoke<GameInstall[]>('detect_game_installations');
	} catch {
		return [];
	}
}

/**
 * Check if Darkest Dungeon is currently running.
 * Returns { running, uncertain } where:
 *   - running=true means the game process was detected
 *   - uncertain=true means detection failed (fail-safe: treat as possibly running)
 */
export async function isGameRunning(): Promise<{ running: boolean; uncertain: boolean }> {
	try {
		const result = await invoke<boolean>('is_game_running');
		return { running: result, uncertain: false };
	} catch {
		// Fail-safe: detection errored, treat as uncertain (game may be running)
		return { running: false, uncertain: true };
	}
}

/**
 * Validate that a path contains a recognisable Darkest Dungeon save directory
 * (i.e. the required persist.*.json files are present).
 */
export async function validateSaveDirectory(path: string): Promise<boolean> {
	try {
		return await invoke<boolean>('validate_save_directory', { path });
	} catch {
		return false;
	}
}

/**
 * Validate that a path contains a recognisable Darkest Dungeon game installation
 * (i.e. the game binary or known marker files are present).
 */
export async function validateGameDirectory(path: string): Promise<boolean> {
	try {
		return await invoke<boolean>('validate_game_directory', { path });
	} catch {
		return false;
	}
}
