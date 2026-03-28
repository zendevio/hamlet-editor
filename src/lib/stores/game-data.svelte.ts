/**
 * Game-data store: localization and name table state.
 *
 * Holds the optional name table (loaded from game install) and provides
 * a localize() helper that falls back to snakeToTitle when no entry exists.
 */

import { snakeToTitle } from '$lib/utils';

// ── State ──

let nameTable = $state<Record<string, string>>({});
let localizationLoaded = $state(false);

// ── Public API ──

export function getGameData() {
	return {
		get nameTable() {
			return nameTable;
		},
		get localizationLoaded() {
			return localizationLoaded;
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

/** Reset localization state (e.g. when game install is cleared). */
export function resetGameData() {
	nameTable = {};
	localizationLoaded = false;
}
