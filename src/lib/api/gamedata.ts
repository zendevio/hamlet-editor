/**
 * Tauri command wrappers for game data (quirks, trinkets, class stats).
 */

import { invoke } from '@tauri-apps/api/core';

export interface ClassStats {
	class_id: string;
	hp_by_rank: number[];
}

export interface QuirkDef {
	id: string;
	is_positive: boolean;
	is_disease: boolean;
}

export interface TrinketDef {
	id: string;
	rarity: string | null;
	class_restriction: string | null;
}

/**
 * Load all quirk definitions from the game's quirk library JSON files.
 * Returns an empty array on failure.
 */
export async function loadQuirkLibrary(gamePath: string): Promise<QuirkDef[]> {
	try {
		return await invoke<QuirkDef[]>('load_quirk_library', { gamePath });
	} catch {
		return [];
	}
}

/**
 * Load all trinket definitions from the game's trinket JSON files.
 * Returns an empty array on failure.
 */
export async function loadTrinketLibrary(gamePath: string): Promise<TrinketDef[]> {
	try {
		return await invoke<TrinketDef[]>('load_trinket_library', { gamePath });
	} catch {
		return [];
	}
}

/**
 * Load hero class HP stats (per armour rank 0-4) from the game's .info.darkest files.
 * Returns an empty array on failure.
 */
export async function loadClassStats(gamePath: string): Promise<ClassStats[]> {
	try {
		return await invoke<ClassStats[]>('load_class_stats', { gamePath });
	} catch {
		return [];
	}
}

export interface ClassSkills {
	class_id: string;
	combat_skills: string[];
	camping_skills: string[];
}

/**
 * Load combat and camping skill IDs per hero class from game files.
 * Returns an empty array on failure.
 */
export async function loadClassSkills(gamePath: string): Promise<ClassSkills[]> {
	try {
		return await invoke<ClassSkills[]>('load_class_skills', { gamePath });
	} catch {
		return [];
	}
}
