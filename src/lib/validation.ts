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

// ── Types ──

export type ValidationSeverity = 'error' | 'warning';

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
