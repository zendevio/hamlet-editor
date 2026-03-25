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

export async function isGameRunning(): Promise<boolean> {
	try {
		return await invoke<boolean>('is_game_running');
	} catch {
		return false;
	}
}
