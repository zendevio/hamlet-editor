/**
 * Central store for all loaded save data.
 *
 * Holds the in-memory representations of every save file for the active profile.
 * Uses Svelte 5 runes for reactive state. All mutation flows through exported
 * functions so we can track dirty state and support per-entity revert.
 */

import { ensureNameTable } from '#lib/api/names.js';
import { loadProfile } from '#lib/api/save.js';
import { readTreatmentSlots, clearTreatmentSlot } from '#lib/treatment.js';
import { stripDsonPrefix } from '#lib/utils.js';
import { getSettings } from '#lib/stores/settings.svelte.js';
import { localize, getMaxHp as getGameDataMaxHp } from '#lib/stores/game-data.svelte.js';
import {
	TREATMENT_BUILDINGS,
	BUILDING_ACTIVITIES,
	BUILDING_DISPLAY_NAMES,
	ACTIVITY_DISPLAY_NAMES,
	DISTRICT_IDS,
	DISTRICT_DISPLAY_NAMES,
	BUILDING_UPGRADE_PREFIXES,
	RESOLVE_XP_THRESHOLDS,
	RESOLVE_LEVEL_NAMES,
	STATUS_MAP,
	HP_TABLE,
	CLASS_DISPLAY_NAMES
} from '#lib/data/constants.js';
import { createMockRoster, createMockUpgrades, createMockEstate, createMockTown } from '#lib/data/mock.js';

// ── Re-export types so existing imports from this module still work ──

export type {
	HeroQuirk,
	HeroActor,
	HeroBaseRoot,
	HeroEntry,
	RosterData,
	EstateData,
	GameData,
	UpgradePurchase,
	UpgradesData,
	TownBuildingSlot,
	TownBuilding,
	TownDistrict,
	TownDistricts,
	TownData,
	HeroSummary,
	TreatmentHero,
	BuildingUpgradeGroup,
	SaveFileName,
	// Raid types
	InventoryItem,
	RaidParty,
	RaidInstance,
	RaidData
} from '#lib/types/save-data.js';

// ── Re-export constants so existing imports from this module still work ──

export {
	TREATMENT_BUILDINGS,
	BUILDING_ACTIVITIES,
	BUILDING_DISPLAY_NAMES,
	ACTIVITY_DISPLAY_NAMES,
	DISTRICT_IDS,
	DISTRICT_DISPLAY_NAMES,
	BUILDING_UPGRADE_PREFIXES,
	RESOLVE_XP_THRESHOLDS,
	RESOLVE_LEVEL_NAMES,
	STATUS_MAP,
	HP_TABLE,
	CLASS_DISPLAY_NAMES
};

export type { TreatmentBuildingName } from '#lib/data/constants.js';

// ── Import types for internal use ──

import type {
	HeroQuirk,
	HeroBaseRoot,
	HeroEntry,
	RosterData,
	EstateData,
	GameData,
	UpgradePurchase,
	UpgradesData,
	TownData,
	HeroSummary,
	TreatmentHero,
	BuildingUpgradeGroup,
	SaveFileName,
	RaidData
} from '#lib/types/save-data.js';
import type { TreatmentBuildingName } from '#lib/data/constants.js';

// ── Reactive State ──

let roster = $state<RosterData | null>(null);
let estate = $state<EstateData | null>(null);
let town = $state<TownData | null>(null);
let upgrades = $state<UpgradesData | null>(null);
let raid = $state<RaidData | null>(null);
let game = $state<GameData | null>(null);
let campaignLog = $state<Record<string, unknown> | null>(null);
let progression = $state<Record<string, unknown> | null>(null);
let gameInRaid = $state(false);
let isLoaded = $state(false);
let nameTableVersion = $state(0);
let isLoading = $state(false);
let loadedProfilePath = $state('');
let loadedGamePath = $state('');
let profileLoadSequence = 0;
// Svelte 5 requires immutable replacement to trigger reactivity on Sets.
let dirtyFiles = $state<Set<string>>(new Set());
// Files to be deleted on next save (e.g. raid file after abandonRaid).
let deletedFiles = $state<Set<string>>(new Set());
// JSON snapshots of on-disk state, used for in-memory revert.
let rosterSnapshot = $state<string | null>(null);
let estateSnapshot = $state<string | null>(null);
let townSnapshot = $state<string | null>(null);
let upgradesSnapshot = $state<string | null>(null);
let raidSnapshot = $state<string | null>(null);
let gameSnapshot = $state<string | null>(null);
let campaignLogSnapshot = $state<string | null>(null);
let progressionSnapshot = $state<string | null>(null);

// ── DLC Flags ──

/**
 * Derived DLC flags — prefer `settings.gameInstall` when available,
 * fall back to save-data heuristics so the estate/town pages still work
 * without a detected install.
 */

const _settings = getSettings();

export function getDlcFlags() {
	return {
		/** True when Crimson Court DLC is detected. */
		get hasCrimsonCourt(): boolean {
			if (_settings.gameInstall !== null) return _settings.gameInstall.has_crimson_court;
			// Fallback: look for CC evidence in save data
			if (estate) {
				for (const item of Object.values(estate.base_root.estate_items?.items ?? {})) {
					const i = item as { id?: string };
					if (i.id?.startsWith('crimson_court_invitation_')) return true;
				}
			}
			if (roster) {
				for (const entry of Object.values(roster.base_root.heroes)) {
					const quirks = entry.hero_file_data.raw_data.base_root.quirks;
					for (const quirkId of Object.keys(quirks)) {
						if (quirkId.startsWith('disease_vampire_')) return true;
					}
				}
			}
			return false;
		},
		/** True when Color of Madness DLC is detected. */
		get hasColorOfMadness(): boolean {
			if (_settings.gameInstall !== null) return _settings.gameInstall.has_color_of_madness;
			// Fallback: shard currency or endless_wave_highscore in estate
			if (estate) {
				for (const entry of Object.values(estate.base_root.wallet ?? {})) {
					const e = entry as { type?: string };
					if (e.type === 'shard') return true;
				}
				const highscore = (estate.base_root as Record<string, unknown>)['endless_wave_highscore'];
				if (highscore !== undefined && highscore !== null) return true;
			}
			return false;
		},
		/** True when Shieldbreaker DLC is detected. */
		get hasShieldbreaker(): boolean {
			if (_settings.gameInstall !== null) return _settings.gameInstall.has_shieldbreaker;
			// Fallback: any shieldbreaker hero in roster
			if (roster) {
				for (const entry of Object.values(roster.base_root.heroes)) {
					if (entry.hero_file_data.raw_data.base_root.heroClass === 'shieldbreaker') return true;
				}
			}
			return false;
		},
		/** True when Musketeer DLC is detected. */
		get hasMusketeer(): boolean {
			if (_settings.gameInstall !== null) return _settings.gameInstall.has_musketeer;
			// Fallback: any musketeer hero in roster
			if (roster) {
				for (const entry of Object.values(roster.base_root.heroes)) {
					if (entry.hero_file_data.raw_data.base_root.heroClass === 'musketeer') return true;
				}
			}
			return false;
		}
	};
}

// ── Derived Helpers ──

/** Convert resolveXp to a resolve level (0-6). */
export function xpToLevel(xp: number): number {
	for (let i = RESOLVE_XP_THRESHOLDS.length - 1; i >= 0; i--) {
		if (xp >= RESOLVE_XP_THRESHOLDS[i]) return i;
	}
	return 0;
}

/** Get max HP for a hero class at a given armour rank.
 *
 * Tries game-data (parsed from .darkest files) first; falls back to the
 * hardcoded HP_TABLE; returns 1 for completely unknown classes.
 */
export function getMaxHp(heroClass: string, armourRank: number): number {
	const fromGameData = getGameDataMaxHp(heroClass, armourRank);
	if (fromGameData !== null) return fromGameData;
	const table = HP_TABLE[heroClass];
	if (!table) return 1;
	const rank = Math.max(0, Math.min(armourRank, 4));
	return table[rank];
}

/** Max gear rank for a given resolve level. */
export function maxGearRank(level: number): number {
	return Math.min(level, 4);
}

/** Extract a HeroSummary from the raw roster entry. */
function heroEntryToSummary(guid: string, entry: HeroEntry): HeroSummary {
	const root = entry.hero_file_data.raw_data.base_root;
	const status = root['roster.status'];
	const statusInfo = STATUS_MAP[status] ?? {
		label: `Unknown(${status})`,
		color: 'gray',
		dotClass: 'bg-gray-500'
	};
	const resolveLevel = xpToLevel(root.resolveXp);

	return {
		guid,
		name: root.actor.name,
		heroClass: root.heroClass,
		classDisplayName: CLASS_DISPLAY_NAMES[root.heroClass] ?? localize('hero_class_name_' + root.heroClass),
		resolveLevel,
		resolveXp: root.resolveXp,
		currentHp: root.actor.current_hp,
		maxHp: getMaxHp(root.heroClass, root.armour_rank),
		stress: root.m_Stress,
		status,
		statusLabel: statusInfo.label,
		statusDotClass: statusInfo.dotClass,
		weaponRank: root.weapon_rank,
		armourRank: root.armour_rank,
		afflictionTypeId: root.affliction_type_id,
		virtueTypeId: root.virtue_type_id,
		visitedDeathsDoor: root.visited_deaths_door,
		buildingName: root['roster.building_name'] ?? '',
		quirks: root.quirks,
		selectedCombatSkills: root.skills?.selected_combat_skills ?? {},
		selectedCampingSkills: root.skills?.selected_camping_skills ?? {},
		trinkets: root.trinkets?.items ?? {}
	};
}

// ── Public API ──

export function getSaveData() {
	return {
		get roster() {
			return roster;
		},
		get estate() {
			return estate;
		},
		get town() {
			return town;
		},
		get upgrades() {
			return upgrades;
		},
		get raid() {
			return raid;
		},
		get game() {
			return game;
		},
		get campaignLog() {
			return campaignLog;
		},
		get progression() {
			return progression;
		},
		get gameInRaid() {
			return gameInRaid;
		},
		get dirtyFiles() {
			return dirtyFiles;
		},
		get isLoading() {
			return isLoading;
		},
		get profilePath() {
			return loadedProfilePath;
		},
		get gamePath() {
			return loadedGamePath;
		},
		get nameTableVersion() {
			return nameTableVersion;
		},
		get isLoaded() {
			return isLoaded;
		}
	};
}

/** Get all heroes as HeroSummary[]. */
export function getHeroes(): HeroSummary[] {
	if (!roster) return [];
	const heroes = roster.base_root.heroes;
	return Object.entries(heroes).map(([guid, entry]) => heroEntryToSummary(guid, entry));
}

/** Get a single hero's raw base_root for detailed editing. */
export function getHeroRawData(guid: string): HeroBaseRoot | null {
	if (!roster) return null;
	const entry = roster.base_root.heroes[guid];
	if (!entry) return null;
	return entry.hero_file_data.raw_data.base_root;
}

/** Mark a file as having unsaved changes. */
export function markDirty(filename: SaveFileName) {
	dirtyFiles = new Set([...dirtyFiles, filename]);
}

/** Check if any files are dirty. */
export function hasDirtyFiles(): boolean {
	return dirtyFiles.size > 0;
}

// ── Mutation Functions ──

/** Update a hero's HP. */
export function setHeroHp(guid: string, hp: number) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw.actor.current_hp = Math.max(0, hp);
	markDirty('persist.roster.json');
}

/** Update a hero's stress. */
export function setHeroStress(guid: string, stress: number) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw.m_Stress = Math.max(0, Math.min(200, stress));
	markDirty('persist.roster.json');
}

/** Update a hero's name. */
export function setHeroName(guid: string, name: string) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw.actor.name = name;
	markDirty('persist.roster.json');
}

/** Update a hero's resolve level (sets resolveXp to the threshold). */
export function setHeroLevel(guid: string, level: number) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	const clamped = Math.max(0, Math.min(6, level));
	raw.resolveXp = RESOLVE_XP_THRESHOLDS[clamped];
	markDirty('persist.roster.json');
}

/** Update a hero's weapon rank. */
export function setHeroWeaponRank(guid: string, rank: number) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw.weapon_rank = Math.max(0, Math.min(4, rank));
	markDirty('persist.roster.json');
}

/** Update a hero's armour rank. */
export function setHeroArmourRank(guid: string, rank: number) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw.armour_rank = Math.max(0, Math.min(4, rank));
	markDirty('persist.roster.json');
}

const VIRTUE_IDS = new Set(['courageous', 'focused', 'powerful', 'vigorous', 'stalwart']);

/** Update a hero's affliction or virtue. Clears the opposing field automatically. */
export function setHeroAffliction(guid: string, valueId: string) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	if (!valueId) {
		// Clear both
		raw.affliction_type_id = '';
		raw.virtue_type_id = '';
		raw.affliction_severity = 0;
	} else if (VIRTUE_IDS.has(valueId)) {
		raw.virtue_type_id = valueId;
		raw.affliction_type_id = '';
		raw.affliction_severity = 0;
	} else {
		raw.affliction_type_id = valueId;
		raw.virtue_type_id = '';
		raw.affliction_severity = raw.affliction_severity || 1;
	}
	markDirty('persist.roster.json');
}

/** Update a hero's visited_deaths_door flag. */
export function setHeroDeathsDoor(guid: string, visited: boolean) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw.visited_deaths_door = visited;
	markDirty('persist.roster.json');
}

/** Set hero status. */
export function setHeroStatus(guid: string, status: number) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw['roster.status'] = status;
	markDirty('persist.roster.json');
}

/** Add a quirk to a hero. */
export function addHeroQuirk(guid: string, quirkId: string, quirk: HeroQuirk) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw.quirks[quirkId] = quirk;
	markDirty('persist.roster.json');
}

/** Remove a quirk from a hero. */
export function removeHeroQuirk(guid: string, quirkId: string) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	delete raw.quirks[quirkId];
	markDirty('persist.roster.json');
}

/** Toggle a quirk's lock state. */
export function toggleQuirkLock(guid: string, quirkId: string) {
	const raw = getHeroRawData(guid);
	if (!raw || !raw.quirks[quirkId]) return;
	raw.quirks[quirkId].is_locked = !raw.quirks[quirkId].is_locked;
	markDirty('persist.roster.json');
}

/** Toggle a combat skill on or off for a hero. */
export function toggleCombatSkill(guid: string, skillId: string) {
	const raw = getHeroRawData(guid);
	if (!raw?.skills) return;
	const skills = raw.skills.selected_combat_skills as Record<string, number>;
	if (skillId in skills) {
		delete skills[skillId];
	} else {
		skills[skillId] = 0;
	}
	markDirty('persist.roster.json');
}

/** Toggle a camping skill on or off for a hero. */
export function toggleCampingSkill(guid: string, skillId: string) {
	const raw = getHeroRawData(guid);
	if (!raw?.skills) return;
	const skills = raw.skills.selected_camping_skills as Record<string, number>;
	if (skillId in skills) {
		delete skills[skillId];
	} else {
		skills[skillId] = 0;
	}
	markDirty('persist.roster.json');
}

/** Heal a hero to max HP. */
export function healHeroToMax(guid: string) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	const maxHp = getMaxHp(raw.heroClass, raw.armour_rank);
	raw.actor.current_hp = maxHp;
	markDirty('persist.roster.json');
}

/**
 * Clear the `died` flag for a hero in all MissionEvent entries in the campaign log.
 *
 * Iterates through `campaignLog.base_root.chapters` (numeric-string keys),
 * then through each chapter's entries (also numeric-string keys). Any entry
 * with `rtti === 2006063882` (MissionEvent) has a `heroes` map whose entries
 * each have a `guid` (number) and `died` (boolean). Entries matching the hero
 * GUID have their `died` flag set to false.
 *
 * Marks `persist.campaign_log.json` dirty if any change was made.
 */
export function clearDiedFlags(heroGuid: string) {
	if (!campaignLog) return;
	const guidNum = parseInt(heroGuid, 10);
	const baseRoot = campaignLog['base_root'] as Record<string, unknown> | undefined;
	if (!baseRoot) return;
	const chapters = baseRoot['chapters'] as Record<string, unknown> | undefined;
	if (!chapters) return;

	let changed = false;

	for (const chapter of Object.values(chapters)) {
		if (typeof chapter !== 'object' || chapter === null) continue;
		const chapterObj = chapter as Record<string, unknown>;
		for (const [key, entry] of Object.entries(chapterObj)) {
			// Skip the chapterIndex metadata key
			if (key === 'chapterIndex') continue;
			if (typeof entry !== 'object' || entry === null) continue;
			const event = entry as Record<string, unknown>;
			// MissionEvent RTTI
			if (event['rtti'] !== 2006063882) continue;
			const heroes = event['heroes'] as Record<string, unknown> | undefined;
			if (!heroes) continue;
			for (const heroEntry of Object.values(heroes)) {
				if (typeof heroEntry !== 'object' || heroEntry === null) continue;
				const h = heroEntry as Record<string, unknown>;
				if (h['guid'] === guidNum && h['died'] === true) {
					h['died'] = false;
					changed = true;
				}
			}
		}
	}

	if (changed) {
		markDirty('persist.campaign_log.json');
	}
}

/**
 * Mark the progression file dirty after a hero revival.
 *
 * The `visit_graveyard` achievement in `persist.progression.json`
 * (`base_root.real_achievements.visit_graveyard.completed`) is a campaign-level
 * flag that tracks whether the player has ever visited the graveyard — it does
 * NOT need to be cleared per revival. No per-hero death state has been found
 * in progression data in the reference sample.
 *
 * TODO: If future investigation reveals a per-hero death record in progression
 * (e.g. a hero GUID reference under a different field), clear it here.
 * For now this function is a no-op but is wired into reviveHero so the call
 * site is already in place.
 */
export function clearGraveyardFlag(_heroGuid: string) {
	// No known per-hero field to clear in persist.progression.json.
	// The visit_graveyard achievement tracks whether the graveyard has ever been
	// visited (campaign-wide) and should NOT be reset per revival.
	// This function is intentionally left as a no-op pending further research.
}

/** Revive a dead hero (basic: sets status to 0, HP to 1, stress to 0). */
export function reviveHero(guid: string) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw['roster.status'] = 0;
	raw['roster.before_on_start_town_visit_status'] = 0;
	raw.actor.current_hp = 1;
	raw.m_Stress = 0;
	markDirty('persist.roster.json');

	// Clear died flags in MissionEvent history in the campaign log.
	clearDiedFlags(guid);

	// Progression graveyard flag (no-op pending further research — see clearGraveyardFlag).
	clearGraveyardFlag(guid);

	// If a raid is active and this hero was in the raid party, mark raid dirty too
	if (raid) {
		const heroGuid = parseInt(guid, 10);
		if (raid.base_root.party.heroes.includes(heroGuid)) {
			// TODO: restore hero to raid party once raid party mutation is implemented
			markDirty('persist.raid.json');
		}
	}
}

/** Update the estate name in persist.game.json. */
export function setEstateName(name: string) {
	if (!game) return;
	game.base_root.estatename = name;
	markDirty('persist.game.json');
}

/** Dismiss a hero (remove from roster). */
export function dismissHero(guid: string) {
	if (!roster) return;
	delete roster.base_root.heroes[guid];
	roster.base_root.dismissed_hero_count += 1;
	markDirty('persist.roster.json');
}

// ── Town & Upgrade Helpers ──

/** Read actual activity and slot positions from town data. */
export function getTreatmentSlots(buildingName?: TreatmentBuildingName) {
	return readTreatmentSlots(town, buildingName);
}

/** Get all heroes occupying treatment slots, even if roster status is inconsistent. */
export function getHeroesInBuilding(buildingName: TreatmentBuildingName): TreatmentHero[] {
	const result: TreatmentHero[] = [];
	for (const { slot, activityType, slotIndex } of getTreatmentSlots(buildingName)) {
		if (slot.hero === 0) continue;
		const guid = String(slot.hero);
		const root = getHeroRawData(guid);
		if (!root) continue;
		result.push({
			guid,
			name: root.actor.name,
			heroClass: root.heroClass,
			classDisplayName: CLASS_DISPLAY_NAMES[root.heroClass] ?? localize('hero_class_name_' + root.heroClass),
			buildingName,
			activityType,
			slotIndex
		});
	}
	return result;
}

/** Cancel treatment in both files, including pending sanitarium actions. */
export function releaseHeroFromTreatment(guid: string) {
	if (!town) return;
	for (const treatment of getTreatmentSlots()) {
		if (String(treatment.slot.hero) === guid && treatment.slot.hero !== 0) {
			clearTreatmentSlot(treatment);
			markDirty('persist.town.json');
		}
	}
	const raw = getHeroRawData(guid);
	if (!raw) return;
	if (raw['roster.status'] === 2) raw['roster.status'] = 0;
	raw['roster.building_name'] = '';
	if (raw['roster.status'] === 0) raw['roster.before_on_start_town_visit_status'] = 0;
	markDirty('persist.roster.json');
}

/** Get all building upgrades grouped by building name. */
export function getBuildingUpgrades(): BuildingUpgradeGroup[] {
	if (!upgrades) return [];
	const groups: Record<string, UpgradePurchase[]> = {};

	for (const purchase of Object.values(upgrades.base_root.purchases)) {
		// Only building upgrades (instance_number === 0)
		if (purchase.instance_number !== 0) continue;
		const treeId = stripDsonPrefix(purchase.tree_id);
		const dotIndex = treeId.indexOf('.');
		if (dotIndex === -1) continue;
		const buildingName = treeId.substring(0, dotIndex);
		if (!BUILDING_UPGRADE_PREFIXES.includes(buildingName as (typeof BUILDING_UPGRADE_PREFIXES)[number]))
			continue;
		if (!groups[buildingName]) groups[buildingName] = [];
		groups[buildingName].push(purchase);
	}

	return Object.entries(groups)
		.map(([buildingName, upgrades]) => ({
			buildingName,
			displayName: BUILDING_DISPLAY_NAMES[buildingName] ?? buildingName,
			upgrades: upgrades.sort((a, b) => a.requirement_code.localeCompare(b.requirement_code)),
			purchasedCount: upgrades.filter((u) => u.is_purchased).length,
			totalCount: upgrades.length
		}))
		.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Toggle an upgrade purchase state with cascade logic. */
export function toggleUpgrade(purchase: UpgradePurchase) {
	if (!upgrades) return;
	const newState = !purchase.is_purchased;
	const treeId = stripDsonPrefix(purchase.tree_id);
	const dotIndex = treeId.indexOf('.');
	if (dotIndex === -1) return;
	const buildingName = treeId.substring(0, dotIndex);

	if (!newState) {
		// Turning OFF: cascade — also turn off all higher-tier upgrades in the same
		// building tree (same buildingName AND same upgradeKey) where the
		// requirement_code is >= the one being turned off.
		const upgradeKey = treeId.substring(dotIndex + 1);
		for (const p of Object.values(upgrades.base_root.purchases)) {
			if (p.instance_number !== 0) continue;
			const pTreeId = stripDsonPrefix(p.tree_id);
			const pDotIndex = pTreeId.indexOf('.');
			if (pDotIndex === -1) continue;
			const pBuildingName = pTreeId.substring(0, pDotIndex);
			const pUpgradeKey = pTreeId.substring(pDotIndex + 1);
			if (pBuildingName === buildingName && pUpgradeKey === upgradeKey) {
				if (p.requirement_code >= purchase.requirement_code) {
					p.is_purchased = false;
				}
			}
		}
	} else {
		purchase.is_purchased = true;
	}

	markDirty('persist.upgrades.json');
}

/**
 * Set the `built` flag for a Color of Madness district.
 *
 * Districts live in `persist.town.json → base_root.districts.buildings.<id>.built`.
 * If the `districts` key is absent (e.g. DLC not installed), this is a no-op.
 */
export function setDistrictBuilt(districtId: string, built: boolean) {
	if (!town) return;
	const districts = town.base_root.districts;
	if (!districts) return;
	if (!districts.buildings[districtId]) {
		districts.buildings[districtId] = { built };
	} else {
		districts.buildings[districtId].built = built;
	}
	markDirty('persist.town.json');
}

// stripDsonPrefix is imported at the top of this file and re-exported for
// consumers that still import it from the store module.

/**
 * Abandon the active raid.
 *
 * Sets inraid = false in persist.game.json and nulls the raid data in memory.
 * Marks both persist.game.json and persist.raid.json as dirty so they get saved.
 */
export function abandonRaid() {
	if (game) {
		game.base_root.inraid = false;
		markDirty('persist.game.json');
	}
	raid = null;
	raidSnapshot = null;
	gameInRaid = false;
	// The raid file should be deleted from disk, not overwritten with null.
	deletedFiles = new Set([...deletedFiles, 'persist.raid.json']);
	// Ensure the raid file is no longer in the dirty set.
	const remaining = new Set(dirtyFiles);
	remaining.delete('persist.raid.json');
	dirtyFiles = remaining;
}

/**
 * Swap two heroes in the party order by index.
 *
 * Both indices must be within bounds; if either is out of range the call is a no-op.
 */
export function swapPartyPositions(indexA: number, indexB: number) {
	if (!raid) return;
	const heroes = raid.base_root.party.heroes;
	if (indexA < 0 || indexB < 0 || indexA >= heroes.length || indexB >= heroes.length) return;
	const temp = heroes[indexA];
	heroes[indexA] = heroes[indexB];
	heroes[indexB] = temp;
	markDirty('persist.raid.json');
}

/**
 * Add a hero to the active raid party by GUID.
 *
 * The GUID string is converted to a number (as stored in party.heroes).
 * Only adds if a raid is active and the party has fewer than 4 members.
 * Marks persist.raid.json dirty.
 */
export function addHeroToRaidParty(heroGuid: string) {
	if (!raid) return;
	const heroes = raid.base_root.party.heroes;
	if (heroes.length >= 4) return;
	const guidNum = parseInt(heroGuid, 10);
	heroes.push(guidNum);
	markDirty('persist.raid.json');
}

// ── Load/Reset ──

/** Load roster data into the store. */
export function loadRoster(data: RosterData) {
	roster = data;
	rosterSnapshot = JSON.stringify(data);
}

/** Load estate data into the store. */
export function loadEstate(data: EstateData) {
	estate = data;
	estateSnapshot = JSON.stringify(data);
}

/** Load town data into the store. */
export function loadTown(data: TownData) {
	town = data;
	townSnapshot = JSON.stringify(data);
}

/** Load upgrades data into the store. */
export function loadUpgrades(data: UpgradesData) {
	upgrades = data;
	upgradesSnapshot = JSON.stringify(data);
}

/** Load raid data into the store. */
export function loadRaid(data: RaidData) {
	raid = data;
	raidSnapshot = JSON.stringify(data);
}

/** Load game data into the store. */
export function loadGame(data: GameData) {
	game = data;
	gameSnapshot = JSON.stringify(data);
}

/** Load campaign_log data into the store. */
export function loadCampaignLog(data: Record<string, unknown>) {
	campaignLog = data;
	campaignLogSnapshot = JSON.stringify(data);
}

/** Load progression data into the store. */
export function loadProgression(data: Record<string, unknown>) {
	progression = data;
	progressionSnapshot = JSON.stringify(data);
}

/** Set whether the game is currently in a raid (from persist.game.json). */
export function setGameInRaid(value: boolean) {
	gameInRaid = value;
}

/**
 * Load a full profile from the Rust backend.
 * Calls the `load_profile` command and distributes data to each sub-store.
 * The backend returns decoded file data and the name-table version used.
 */
export async function loadProfileFromBackend(profilePath: string): Promise<void> {
	const sequence = ++profileLoadSequence;
	const gamePath = getSettings().gamePath;
	isLoading = true;
	try {
		// Clear any stale data from a previously loaded profile before populating
		// the store with the new one.
		resetSaveData();

		await ensureNameTable(gamePath);
		if (sequence !== profileLoadSequence) return;
		const loaded = await loadProfile(profilePath);
		if (sequence !== profileLoadSequence) return;
		const data = loaded.data;
		nameTableVersion = loaded.name_table_version;

		if (data['persist.roster.json']) {
			loadRoster(data['persist.roster.json'] as RosterData);
		}
		if (data['persist.estate.json']) {
			loadEstate(data['persist.estate.json'] as EstateData);
		}
		if (data['persist.town.json']) {
			loadTown(data['persist.town.json'] as TownData);
		}
		if (data['persist.upgrades.json']) {
			loadUpgrades(data['persist.upgrades.json'] as UpgradesData);
		}
		if (data['persist.raid.json']) {
			loadRaid(data['persist.raid.json'] as RaidData);
		}
		// persist.game.json carries estate name, inraid flag, game mode, etc.
		if (data['persist.game.json']) {
			const gameData = data['persist.game.json'] as GameData;
			loadGame(gameData);
			setGameInRaid(gameData?.base_root?.inraid ?? false);
		}
		if (data['persist.campaign_log.json']) {
			loadCampaignLog(data['persist.campaign_log.json'] as Record<string, unknown>);
		}
		if (data['persist.progression.json']) {
			loadProgression(data['persist.progression.json'] as Record<string, unknown>);
		}
		// persist.novelty_tracker.json is intentionally not loaded into the store (v0.1.0).
		// Unmodified files are left on disk without being re-encoded.

		loadedProfilePath = profilePath;
		loadedGamePath = gamePath;
		isLoaded = true;
	} finally {
		if (sequence === profileLoadSequence) isLoading = false;
	}
}

/** Revert a single hero to on-disk state. */
export function revertHero(guid: string) {
	if (!rosterSnapshot || !roster) return;
	const snapshot = JSON.parse(rosterSnapshot) as RosterData;
	const original = snapshot.base_root.heroes[guid];
	if (!original) return;
	roster.base_root.heroes[guid] = JSON.parse(JSON.stringify(original));
}

/** Clear all dirty flags and update snapshots to current state (call after successful save). */
export function clearAllDirty() {
	dirtyFiles = new Set();
	deletedFiles = new Set();
	if (roster) rosterSnapshot = JSON.stringify(roster);
	if (estate) estateSnapshot = JSON.stringify(estate);
	if (town) townSnapshot = JSON.stringify(town);
	if (upgrades) upgradesSnapshot = JSON.stringify(upgrades);
	if (raid) raidSnapshot = JSON.stringify(raid);
	else raidSnapshot = null;
	if (game) gameSnapshot = JSON.stringify(game);
	if (campaignLog) campaignLogSnapshot = JSON.stringify(campaignLog);
	if (progression) progressionSnapshot = JSON.stringify(progression);
}

/**
 * Discard all in-memory changes by reverting every file to its disk snapshot.
 * Resets dirty state.
 */
export function discardAllChanges() {
	if (rosterSnapshot) roster = JSON.parse(rosterSnapshot) as RosterData;
	if (estateSnapshot) estate = JSON.parse(estateSnapshot) as EstateData;
	if (townSnapshot) town = JSON.parse(townSnapshot) as TownData;
	if (upgradesSnapshot) upgrades = JSON.parse(upgradesSnapshot) as UpgradesData;
	if (raidSnapshot) {
		raid = JSON.parse(raidSnapshot) as RaidData;
	} else {
		raid = null;
	}
	if (gameSnapshot) {
		game = JSON.parse(gameSnapshot) as GameData;
		gameInRaid = (game as GameData).base_root?.inraid ?? false;
	}
	if (campaignLogSnapshot) campaignLog = JSON.parse(campaignLogSnapshot) as Record<string, unknown>;
	else campaignLog = null;
	if (progressionSnapshot) progression = JSON.parse(progressionSnapshot) as Record<string, unknown>;
	else progression = null;
	dirtyFiles = new Set();
	deletedFiles = new Set();
}

/**
 * Get the current save data as a serializable object for the save command.
 * Only includes files that have been modified.
 */
export function getDirtyData(): Record<string, unknown> {
	const data: Record<string, unknown> = {};
	if (dirtyFiles.has('persist.roster.json') && roster) {
		data['persist.roster.json'] = roster;
	}
	if (dirtyFiles.has('persist.estate.json') && estate) {
		data['persist.estate.json'] = estate;
	}
	if (dirtyFiles.has('persist.town.json') && town) {
		data['persist.town.json'] = town;
	}
	if (dirtyFiles.has('persist.upgrades.json') && upgrades) {
		data['persist.upgrades.json'] = upgrades;
	}
	if (dirtyFiles.has('persist.raid.json') && raid) {
		data['persist.raid.json'] = raid;
	}
	if (dirtyFiles.has('persist.game.json') && game) {
		data['persist.game.json'] = game;
	}
	if (dirtyFiles.has('persist.campaign_log.json') && campaignLog) {
		data['persist.campaign_log.json'] = campaignLog;
	}
	if (dirtyFiles.has('persist.progression.json') && progression) {
		data['persist.progression.json'] = progression;
	}
	if (deletedFiles.size > 0) {
		data['_deleted'] = [...deletedFiles];
	}
	return data;
}

/** Reset all save data (e.g. on profile switch). */
export function resetSaveData() {
	roster = null;
	estate = null;
	town = null;
	upgrades = null;
	raid = null;
	game = null;
	campaignLog = null;
	progression = null;
	gameInRaid = false;
	isLoaded = false;
	nameTableVersion = 0;
	loadedProfilePath = '';
	loadedGamePath = '';
	dirtyFiles = new Set();
	deletedFiles = new Set();
	rosterSnapshot = null;
	estateSnapshot = null;
	townSnapshot = null;
	upgradesSnapshot = null;
	raidSnapshot = null;
	gameSnapshot = null;
	campaignLogSnapshot = null;
	progressionSnapshot = null;
}

// ── Mock Data for Development ──

/** Generate mock roster data for UI development. */
export function loadMockData() {
	loadRoster(createMockRoster());
	loadUpgrades(createMockUpgrades());
	loadEstate(createMockEstate());
	loadTown(createMockTown());
	isLoaded = true;
}

// Re-export stripDsonPrefix so consumers importing it from this module continue to work.
export { stripDsonPrefix };
