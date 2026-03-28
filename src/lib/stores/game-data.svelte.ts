/**
 * Game-data store: localization, name table, quirks, and trinkets state.
 *
 * Holds the optional name table (loaded from game install) and provides
 * a localize() helper that falls back to snakeToTitle when no entry exists.
 * Also holds quirk and trinket definitions loaded from game JSON files.
 */

import { snakeToTitle } from '$lib/utils';
import type { QuirkDef, TrinketDef } from '$lib/api/gamedata';

// ── State ──

let nameTable = $state<Record<string, string>>({});
let localizationLoaded = $state(false);
let quirks = $state<QuirkDef[]>([]);
let trinkets = $state<TrinketDef[]>([]);

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

/** Reset localization state (e.g. when game install is cleared). */
export function resetGameData() {
	nameTable = {};
	localizationLoaded = false;
	quirks = [];
	trinkets = [];
}
