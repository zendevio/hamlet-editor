import { heroClassName } from '#lib/save-labels.js';
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
	getTreatmentSlots,
	releaseHeroFromTreatment
} from '#lib/stores/save-data.svelte.js';
import type { GameInstall } from '#lib/api/detect.js';
import { getSettings } from '#lib/stores/settings.svelte.js';

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

/** Gear ranks are indices into the five weapon/armour definitions, independent of level. */
function checkGearRanks(): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const hero of getHeroes()) {
		for (const [kind, rank] of [['weapon', hero.weaponRank], ['armour', hero.armourRank]] as const) {
			if (Number.isInteger(rank) && rank >= 0 && rank <= 4) continue;
			issues.push({
				severity: 'error',
				category: 'Gear Rank',
				message: `${hero.name} (${heroClassName(hero.heroClass)}): ${kind} rank ${rank} must be a whole number from 0 to 4.`
			});
		}
	}
	return issues;
}

/** Town slots are authoritative; roster.building_name may be blank. */
function checkTreatmentConsistency(): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const heroes = getHeroes();
	if (!getSaveData().town) {
		if (heroes.some((hero) => hero.status === 2)) {
			issues.push({
				severity: 'error',
				category: 'Treatment',
				message: 'Town data is missing. Reload the profile before changing treatment.'
			});
		}
		return issues;
	}
	const slots = getTreatmentSlots().filter(({ slot }) => slot.hero !== 0);
	for (const hero of heroes) {
		const assigned = slots.filter(({ slot }) => String(slot.hero) === hero.guid);
		if (
			(hero.status === 2 && assigned.length === 0) ||
			(assigned.length > 0 && hero.status !== 2) || assigned.length > 1
		) {
			issues.push({
				severity: 'warning',
				category: 'Treatment',
				message: `${hero.name} (${heroClassName(hero.heroClass)}): roster treatment status and town slot assignments disagree. Release treatment to clear both.`,
				fix: () => releaseHeroFromTreatment(hero.guid)
			});
		}
	}
	const knownHeroes = new Set(heroes.map((hero) => hero.guid));
	for (const { slot, buildingName, activityType, slotIndex } of slots) {
		const guid = String(slot.hero);
		if (knownHeroes.has(guid)) continue;
		issues.push({
			severity: 'warning',
			category: 'Treatment',
			message: `${buildingName} ${activityType} slot ${Number(slotIndex) + 1} references missing hero ${guid}.`,
			fix: () => releaseHeroFromTreatment(guid)
		});
	}
	return issues;
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
