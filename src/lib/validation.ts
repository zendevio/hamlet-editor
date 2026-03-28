/**
 * Pre-save cross-file validation.
 *
 * Checks consistency across roster, estate, town, and upgrades data
 * before writing to disk. Returns a list of issues that can optionally
 * be auto-fixed.
 */

import {
	getSaveData,
	getHeroes,
	getHeroRawData,
	maxGearRank,
	xpToLevel,
	type HeroSummary
} from '$lib/stores/save-data.svelte';
import { loadProfile } from '$lib/api/save';
import type { GameInstall } from '$lib/api/detect';
import { getSettings } from '$lib/stores/settings.svelte';

// ── Types ──

export type ValidationSeverity = 'error' | 'warning';

export type { GameInstall };

export interface ValidationIssue {
	severity: ValidationSeverity;
	category: string;
	message: string;
	/** If set, calling this function auto-fixes the issue. */
	fix?: () => void;
}

// ── Validation Checks ──

/**
 * Run all pre-save validation checks.
 * Returns an array of issues found (empty = all clear).
 */
export function runPreSaveValidation(): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	issues.push(...checkGearRanks());
	issues.push(...checkTreatmentConsistency());
	issues.push(...checkDuplicateTrinkets());

	const gameInstall = getSettings().gameInstall;
	if (gameInstall !== null) {
		const saveData = getSaveData();
		const data: Record<string, unknown> = {};
		if (saveData.roster) data['persist.roster.json'] = saveData.roster;
		if (saveData.estate) data['persist.estate.json'] = saveData.estate;
		issues.push(...checkDlcFieldInjection(data, gameInstall));
	}

	return issues;
}

/**
 * Check that no hero's gear rank exceeds their level's maximum.
 * Max gear rank = Math.min(resolveLevel, 4).
 */
function checkGearRanks(): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const heroes = getHeroes();

	for (const hero of heroes) {
		// Skip dead heroes
		if (hero.status === 3) continue;

		const maxRank = maxGearRank(hero.resolveLevel);

		if (hero.weaponRank > maxRank) {
			const guid = hero.guid;
			issues.push({
				severity: 'warning',
				category: 'Gear Rank',
				message: `${hero.name} (${hero.classDisplayName}): weapon rank ${hero.weaponRank} exceeds max ${maxRank} for level ${hero.resolveLevel}.`,
				fix: () => {
					const raw = getHeroRawData(guid);
					if (raw) {
						raw.weapon_rank = maxRank;
					}
				}
			});
		}

		if (hero.armourRank > maxRank) {
			const guid = hero.guid;
			issues.push({
				severity: 'warning',
				category: 'Gear Rank',
				message: `${hero.name} (${hero.classDisplayName}): armour rank ${hero.armourRank} exceeds max ${maxRank} for level ${hero.resolveLevel}.`,
				fix: () => {
					const raw = getHeroRawData(guid);
					if (raw) {
						raw.armour_rank = maxRank;
					}
				}
			});
		}
	}

	return issues;
}

/**
 * Check that heroes in treatment (status=2) have a building_name set.
 */
function checkTreatmentConsistency(): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const heroes = getHeroes();

	for (const hero of heroes) {
		if (hero.status === 2 && !hero.buildingName) {
			const guid = hero.guid;
			issues.push({
				severity: 'warning',
				category: 'Treatment',
				message: `${hero.name} (${hero.classDisplayName}): status is "In Treatment" but no building assigned.`,
				fix: () => {
					// Fix by setting status back to Available
					const raw = getHeroRawData(guid);
					if (raw) {
						raw['roster.status'] = 0;
						raw['roster.building_name'] = '';
					}
				}
			});
		}
	}

	return issues;
}

/**
 * Check for duplicate trinkets between hero equipment and estate storage.
 * In DD1, each trinket instance should appear in exactly one location.
 */
function checkDuplicateTrinkets(): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const saveData = getSaveData();

	if (!saveData.roster || !saveData.estate) return issues;

	// Collect trinket IDs from estate storage
	const estateTrinkets = new Map<string, number>();
	const estateItems = saveData.estate.base_root.trinkets?.items ?? {};
	for (const [key, value] of Object.entries(estateItems)) {
		const id = typeof value === 'object' && value !== null && 'id' in value
			? String((value as Record<string, unknown>).id)
			: key;
		estateTrinkets.set(id, (estateTrinkets.get(id) ?? 0) + 1);
	}

	// Collect trinket IDs from equipped heroes
	const equippedTrinkets = new Map<string, string[]>(); // trinket ID -> hero names
	const heroes = getHeroes();
	for (const hero of heroes) {
		const raw = getHeroRawData(hero.guid);
		if (!raw?.trinkets?.items) continue;
		for (const [, value] of Object.entries(raw.trinkets.items)) {
			const id = typeof value === 'object' && value !== null && 'id' in value
				? String((value as Record<string, unknown>).id)
				: '';
			if (id) {
				const list = equippedTrinkets.get(id) ?? [];
				list.push(hero.name);
				equippedTrinkets.set(id, list);
			}
		}
	}

	// Check for trinkets appearing in both estate and equipped
	for (const [trinketId, heroNames] of equippedTrinkets) {
		if (estateTrinkets.has(trinketId)) {
			issues.push({
				severity: 'warning',
				category: 'Trinkets',
				message: `Trinket "${trinketId}" is equipped on ${heroNames.join(', ')} AND in estate storage. This may cause duplication in-game.`
			});
		}
	}

	// Check for trinkets equipped on multiple heroes
	for (const [trinketId, heroNames] of equippedTrinkets) {
		if (heroNames.length > 1) {
			issues.push({
				severity: 'warning',
				category: 'Trinkets',
				message: `Trinket "${trinketId}" is equipped on multiple heroes: ${heroNames.join(', ')}.`
			});
		}
	}

	return issues;
}

// ── Round-Trip Validation ──

/**
 * Validate that a just-written save file decodes back to the expected data.
 *
 * Re-loads the entire profile via `load_profile` and compares the top-level
 * key count of the specified file's decoded object against the in-memory
 * representation. A key-count mismatch indicates a gross encoding failure
 * (e.g. fields were silently dropped or the file could not be re-decoded).
 *
 * This is a lightweight sanity check — it does NOT guarantee field-level
 * correctness. A full semantic comparison is non-trivial because ddsavelib
 * may reorder fields or normalise numeric representations during encode/decode.
 *
 * @param profilePath  - Absolute path to the profile directory.
 * @param filename     - Name of the specific save file to check (e.g. `persist.roster.json`).
 * @param inMemoryData - The in-memory object that was encoded and written.
 * @returns            - `true` if the top-level key count matches, `false` on mismatch or error.
 */
export async function validateRoundTrip(
	profilePath: string,
	filename: string,
	inMemoryData: Record<string, unknown>
): Promise<boolean> {
	try {
		const reloaded = await loadProfile(profilePath);
		const reloadedFile = reloaded[filename];

		if (typeof reloadedFile !== 'object' || reloadedFile === null) {
			console.warn(`[validateRoundTrip] ${filename}: re-decoded value is not an object`);
			return false;
		}

		const inMemoryKeyCount = Object.keys(inMemoryData).length;
		const reloadedKeyCount = Object.keys(reloadedFile as Record<string, unknown>).length;

		if (inMemoryKeyCount !== reloadedKeyCount) {
			console.warn(
				`[validateRoundTrip] ${filename}: key count mismatch — in-memory ${inMemoryKeyCount} vs re-decoded ${reloadedKeyCount}`
			);
			return false;
		}

		return true;
	} catch (err) {
		console.warn(`[validateRoundTrip] ${filename}: error during re-load — ${err}`);
		return false;
	}
}

// ── DLC Field Injection Guards ──

/**
 * Check that save data does not contain fields from uninstalled DLC expansions.
 *
 * Performs two checks:
 *
 * 1. **Crimson Court** (`has_crimson_court: false`): scans hero quirks in the
 *    roster for keys matching `disease_vampire_*`. These quirks are defined
 *    exclusively in `dlc/580100_crimson_court/…/crimson_court.quirk_library.json`
 *    and will cause the game to fail to resolve the quirk if CC is not installed.
 *
 * 2. **Color of Madness** (`has_color_of_madness: false`): scans the estate
 *    wallet for an entry with `type === "shard"`. Shard currency is introduced
 *    by the CoM DLC; injecting it into a non-CoM save will show a phantom
 *    currency the game cannot spend.
 *
 * This function should be called from `runPreSaveValidation` and passed the
 * current `GameInstall` flags. Use `getDlcFlags()` from the save-data store
 * as a fallback when no explicit install is detected.
 *
 * @param data        - The combined dirty save data keyed by filename.
 * @param gameInstall - Detected DLC flags for the active game installation.
 * @returns Array of `ValidationIssue` warnings (never errors — the user may
 *          have intentionally edited the save for a future install).
 */
export function checkDlcFieldInjection(
	data: Record<string, unknown>,
	gameInstall: GameInstall
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	// ── Crimson Court: disease_vampire_* quirks ──
	if (!gameInstall.has_crimson_court) {
		const rosterFile = data['persist.roster.json'] as
			| { base_root?: { heroes?: Record<string, unknown> } }
			| undefined;
		const heroes = rosterFile?.base_root?.heroes ?? {};

		for (const [, entry] of Object.entries(heroes)) {
			if (typeof entry !== 'object' || entry === null) continue;
			const heroEntry = entry as {
				hero_file_data?: {
					raw_data?: {
						base_root?: { quirks?: Record<string, unknown>; actor?: { name?: string } };
					};
				};
			};
			const baseRoot = heroEntry?.hero_file_data?.raw_data?.base_root;
			const quirks = baseRoot?.quirks ?? {};
			const heroName = baseRoot?.actor?.name ?? 'Unknown';

			for (const quirkId of Object.keys(quirks)) {
				if (quirkId.startsWith('disease_vampire_')) {
					issues.push({
						severity: 'warning',
						category: 'DLC',
						message: `Hero "${heroName}" has Crimson Curse quirk "${quirkId}" but Crimson Court DLC is not installed. The game cannot resolve this quirk without the DLC.`
					});
					// One warning per hero is enough — break after the first match.
					break;
				}
			}
		}
	}

	// ── Color of Madness: shard wallet entry ──
	if (!gameInstall.has_color_of_madness) {
		const estateFile = data['persist.estate.json'] as
			| { base_root?: { wallet?: Record<string, unknown> } }
			| undefined;
		const wallet = estateFile?.base_root?.wallet ?? {};

		for (const [, entry] of Object.entries(wallet)) {
			if (typeof entry !== 'object' || entry === null) continue;
			const walletEntry = entry as { type?: string; amount?: number };
			if (walletEntry.type === 'shard') {
				issues.push({
					severity: 'warning',
					category: 'DLC',
					message: `Estate wallet contains a "shard" currency entry (amount: ${walletEntry.amount ?? 0}) but Color of Madness DLC is not installed. This currency cannot be used without the DLC.`
				});
				// Only one warning needed regardless of how many shard entries exist.
				break;
			}
		}
	}

	return issues;
}
