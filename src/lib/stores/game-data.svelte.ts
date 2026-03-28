/**
 * Game-data store: localization, name table, quirks, and trinkets state.
 *
 * Holds the optional name table (loaded from game install) and provides
 * a localize() helper that falls back to snakeToTitle when no entry exists.
 * Also holds quirk and trinket definitions loaded from game JSON files.
 */

import { snakeToTitle } from '$lib/utils';
import type { ClassStats, QuirkDef, TrinketDef } from '$lib/api/gamedata';

// ── State ──

let nameTable = $state<Record<string, string>>({});
let localizationLoaded = $state(false);
let quirks = $state<QuirkDef[]>([]);
let trinkets = $state<TrinketDef[]>([]);
let classStats = $state<ClassStats[]>([]);

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

/** Merge additional entries into the existing name table. */
export function mergeNameTable(entries: Record<string, string>) {
	nameTable = { ...nameTable, ...entries };
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
}
