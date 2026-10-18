/**
 * Game-data store: localization, name table, quirks, and trinkets state.
 *
 * Holds the optional name table (loaded from game install) and provides
 * a localize() helper that falls back to snakeToTitle when no entry exists.
 * Also holds quirk and trinket definitions loaded from game JSON files.
 */

import { snakeToTitle } from '#lib/utils.js';
import type { ClassSkills, ClassStats, QuirkDef, TrinketDef } from '#lib/api/gamedata.js';

// ── State ──

let nameTable = $state<Record<string, string>>({});
let localizationLoaded = $state(false);
let quirks = $state<QuirkDef[]>([]);
let trinkets = $state<TrinketDef[]>([]);
let classStats = $state<ClassStats[]>([]);
let classSkills = $state<ClassSkills[]>([]);

// ── Public API ──

export function getGameData() {
	return {
		get nameTable() {
			return nameTable;
		},
		get localizationLoaded() {
			return localizationLoaded;
		},
		get quirks() {
			return quirks;
		},
		get trinkets() {
			return trinkets;
		},
		get classStats() {
			return classStats;
		},
		get classSkills() {
			return classSkills;
		}
	};
}

/**
 * Resolve a snake_case identifier to its display string.
 *
 * Looks up the key in the loaded name table first; falls back to
 * snakeToTitle() when no entry is present.
 */
export function localize(key: string): string {
	return nameTable[key] ?? snakeToTitle(key);
}

/** Replace the entire name table (e.g. after loading game strings). */
export function setNameTable(table: Record<string, string>) {
	nameTable = table;
	localizationLoaded = true;
}

/** Replace the loaded quirk definitions. */
export function setQuirks(defs: QuirkDef[]) {
	quirks = defs;
}

/** Replace the loaded trinket definitions. */
export function setTrinkets(defs: TrinketDef[]) {
	trinkets = defs;
}

/** Replace the loaded class stats. */
export function setClassStats(defs: ClassStats[]) {
	classStats = defs;
}

/** Replace the loaded class skills. */
export function setClassSkills(defs: ClassSkills[]) {
	classSkills = defs;
}

/** Get the available combat skill IDs for a given hero class. */
export function getAvailableCombatSkills(heroClass: string): string[] {
	const entry = classSkills.find((s) => s.class_id === heroClass);
	return entry?.combat_skills ?? [];
}

/** Get the available camping skill IDs for a given hero class. */
export function getAvailableCampingSkills(heroClass: string): string[] {
	const entry = classSkills.find((s) => s.class_id === heroClass);
	return entry?.camping_skills ?? [];
}

/**
 * Look up max HP for a hero class at a given armour rank from game data.
 * Returns null if the class is not found in the loaded stats (e.g. modded class
 * or game data not yet loaded).
 */
export function getMaxHp(heroClass: string, armourRank: number): number | null {
	const entry = classStats.find((s) => s.class_id === heroClass);
	if (!entry) return null;
	const rank = Math.max(0, Math.min(armourRank, entry.hp_by_rank.length - 1));
	return entry.hp_by_rank[rank] ?? null;
}

/** Reset localization state (e.g. when game install is cleared). */
export function resetGameData() {
	nameTable = {};
	localizationLoaded = false;
	quirks = [];
	trinkets = [];
	classStats = [];
	classSkills = [];
}
