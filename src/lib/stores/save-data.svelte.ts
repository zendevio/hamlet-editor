/**
 * Central store for all loaded save data.
 *
 * Holds the in-memory representations of every save file for the active profile.
 * Uses Svelte 5 runes for reactive state. All mutation flows through exported
 * functions so we can track dirty state and support per-entity revert.
 */

// ── Types ──

export interface HeroQuirk {
	is_locked: boolean;
	is_new: boolean;
	mission_count: number;
	replaces_quirk: number;
	replaces_quirk_viewed: boolean;
	evolution_duration_remaining: number;
}

export interface HeroActor {
	name: string;
	current_hp: number;
	colour_variation: number;
	stunned: number;
	combat_ready: boolean;
	damage_source_data: string;
	buff_group: Record<string, unknown>;
	buff_group_next_guid: number;
	actor_dot: Record<string, unknown>;
}

export interface HeroBaseRoot {
	'roster.status': number;
	'roster.before_on_start_town_visit_status': number;
	'roster.building_name': string;
	actor: HeroActor;
	heroClass: string;
	resolveXp: number;
	m_Stress: number;
	visited_deaths_door: boolean;
	is_death_heart_attack_completed: boolean;
	has_had_heart_attack: boolean;
	deaths_door_enter_effect_round_cooldown: number;
	weapon_rank: number;
	armour_rank: number;
	affliction_type_id: string;
	affliction_severity: number;
	virtue_type_id: string;
	backer_hero: boolean;
	enemies_killed: number;
	steps_taken: number;
	provisions_consumed: number;
	dd_test_survived: number;
	number_of_successful_darkest_dungeon_quests: number;
	is_from_town_event: boolean;
	quirks: Record<string, HeroQuirk>;
	skills: {
		selected_combat_skills: Record<string, unknown>;
		selected_camping_skills: Record<string, unknown>;
	};
	trinkets: { items: Record<string, unknown> };
	dungeon_history: unknown[];
}

export interface HeroEntry {
	hero_file_data: {
		raw_data: {
			base_root: HeroBaseRoot;
		};
	};
}

export interface RosterData {
	base_root: {
		version: number;
		nextGuid: number;
		dismissed_hero_count: number;
		last_party: {
			last_party_guids: number[];
		};
		heroes: Record<string, HeroEntry>;
	};
}

export interface EstateData {
	base_root: {
		wallet: Record<string, { amount: number; type: string }>;
		trinkets: { items: Record<string, unknown> };
		estate_items: { items: Record<string, unknown> };
		endless_wave_highscore: number;
		tampering: Record<string, unknown>;
		darkest_dungeon_trinket_unlocks: Record<string, unknown>;
	};
}

// ── Town & Upgrade Types ──

export interface UpgradePurchase {
	instance_number: number;
	tree_id: string;
	requirement_code: string;
	is_purchased: boolean;
}

export interface UpgradesData {
	base_root: {
		purchases: Record<string, UpgradePurchase>;
	};
}

export interface TownBuildingSlot {
	hero_guid: number;
	activity_type: string;
}

export interface TownBuilding {
	slots: Record<string, TownBuildingSlot>;
}

export interface TownData {
	base_root: {
		buildings: Record<string, TownBuilding>;
	};
}

// ── Building Constants ──

export const TREATMENT_BUILDINGS = ['abbey', 'tavern', 'sanitarium'] as const;
export type TreatmentBuildingName = (typeof TREATMENT_BUILDINGS)[number];

export const BUILDING_ACTIVITIES: Record<TreatmentBuildingName, string[]> = {
	abbey: ['meditation', 'prayer', 'flagellation'],
	tavern: ['bar', 'gambling', 'brothel'],
	sanitarium: ['disease_treatment', 'quirk_treatment']
};

export const BUILDING_DISPLAY_NAMES: Record<string, string> = {
	sanitarium: 'Sanitarium',
	tavern: 'Tavern',
	abbey: 'Abbey',
	blacksmith: 'Blacksmith',
	guild: 'Guild',
	stage_coach: 'Stage Coach',
	survivalist: 'Survivalist',
	barracks: 'Barracks',
	nomad_wagon: 'Nomad Wagon'
};

export const ACTIVITY_DISPLAY_NAMES: Record<string, string> = {
	meditation: 'Meditation',
	prayer: 'Prayer',
	flagellation: 'Flagellation',
	bar: 'Bar',
	gambling: 'Gambling',
	brothel: 'Brothel',
	disease_treatment: 'Disease Treatment',
	quirk_treatment: 'Quirk Treatment'
};

/** Known district IDs (Color of Madness DLC). */
export const DISTRICT_IDS = [
	'district_bank',
	'district_granary',
	'district_inn',
	'district_puppet_theatre',
	'district_training_ring',
	'district_cartographers_camp',
	'district_sanguine_vintners',
	'district_abbey_addition',
	'district_tavern_addition',
	'district_sanitarium_addition'
] as const;

export const DISTRICT_DISPLAY_NAMES: Record<string, string> = {
	district_bank: 'Bank',
	district_granary: 'Granary',
	district_inn: 'Inn',
	district_puppet_theatre: 'Puppet Theatre',
	district_training_ring: 'Training Ring',
	district_cartographers_camp: "Cartographer's Camp",
	district_sanguine_vintners: 'Sanguine Vintners',
	district_abbey_addition: 'Abbey Addition',
	district_tavern_addition: 'Tavern Addition',
	district_sanitarium_addition: 'Sanitarium Addition'
};

/** Known building name prefixes for upgrade tree_ids. */
export const BUILDING_UPGRADE_PREFIXES = [
	'sanitarium',
	'tavern',
	'abbey',
	'blacksmith',
	'guild',
	'stage_coach',
	'survivalist',
	'barracks',
	'nomad_wagon'
] as const;

/** Resolve level thresholds: index = level, value = min XP. */
export const RESOLVE_XP_THRESHOLDS = [0, 2, 8, 14, 24, 36, 48];

/** Level title names. */
export const RESOLVE_LEVEL_NAMES = [
	'Novice',
	'Apprentice',
	'Journeyman',
	'Veteran',
	'Champion',
	'Champion',
	'Legend'
];

/** Status code labels and colors. */
export const STATUS_MAP: Record<number, { label: string; color: string; dotClass: string }> = {
	0: { label: 'Available', color: 'green', dotClass: 'bg-green-500' },
	1: { label: 'In Squad', color: 'teal', dotClass: 'bg-teal-500' },
	2: { label: 'In Treatment', color: 'blue', dotClass: 'bg-blue-500' },
	3: { label: 'Dead', color: 'red', dotClass: 'bg-red-500' },
	4: { label: 'In Raid', color: 'orange', dotClass: 'bg-orange-500' }
};

/** HP table: class -> armour_rank -> max HP. */
export const HP_TABLE: Record<string, number[]> = {
	plague_doctor: [22, 26, 30, 34, 38],
	occultist: [20, 23, 27, 30, 34],
	vestal: [25, 29, 33, 38, 42],
	hellion: [27, 31, 36, 40, 45],
	houndmaster: [22, 25, 29, 32, 36],
	bounty_hunter: [26, 30, 34, 38, 43],
	man_at_arms: [33, 37, 42, 47, 52],
	highwayman: [24, 28, 31, 35, 39],
	jester: [20, 23, 26, 29, 33],
	crusader: [36, 40, 47, 54, 61],
	arbalest: [28, 32, 36, 40, 45],
	musketeer: [28, 32, 36, 40, 45],
	grave_robber: [20, 24, 28, 32, 36],
	leper: [35, 42, 49, 56, 63],
	abomination: [27, 31, 36, 41, 46],
	antiquarian: [17, 20, 23, 26, 29],
	shieldbreaker: [21, 24, 28, 31, 35],
	flagellant: [22, 26, 30, 33, 37]
};

/** Human-readable class names. */
export const CLASS_DISPLAY_NAMES: Record<string, string> = {
	plague_doctor: 'Plague Doctor',
	occultist: 'Occultist',
	vestal: 'Vestal',
	hellion: 'Hellion',
	houndmaster: 'Hound Master',
	bounty_hunter: 'Bounty Hunter',
	man_at_arms: 'Man-at-Arms',
	highwayman: 'Highwayman',
	jester: 'Jester',
	crusader: 'Crusader',
	arbalest: 'Arbalest',
	musketeer: 'Musketeer',
	grave_robber: 'Grave Robber',
	leper: 'Leper',
	abomination: 'Abomination',
	antiquarian: 'Antiquarian',
	shieldbreaker: 'Shieldbreaker',
	flagellant: 'Flagellant'
};

// ── Reactive State ──

let roster = $state<RosterData | null>(null);
let estate = $state<EstateData | null>(null);
let town = $state<TownData | null>(null);
let upgrades = $state<UpgradesData | null>(null);
let dirtyFiles = $state<Set<string>>(new Set());
let diskSnapshot = $state<string | null>(null); // JSON snapshot for revert

// ── Derived Helpers ──

/** Flat list of heroes with their GUIDs for easy iteration. */
export interface HeroSummary {
	guid: string;
	name: string;
	heroClass: string;
	classDisplayName: string;
	resolveLevel: number;
	resolveXp: number;
	currentHp: number;
	maxHp: number;
	stress: number;
	status: number;
	statusLabel: string;
	statusDotClass: string;
	weaponRank: number;
	armourRank: number;
	afflictionTypeId: string;
	virtueTypeId: string;
	visitedDeathsDoor: boolean;
	buildingName: string;
	quirks: Record<string, HeroQuirk>;
}

/** Convert resolveXp to a resolve level (0-6). */
export function xpToLevel(xp: number): number {
	for (let i = RESOLVE_XP_THRESHOLDS.length - 1; i >= 0; i--) {
		if (xp >= RESOLVE_XP_THRESHOLDS[i]) return i;
	}
	return 0;
}

/** Get max HP for a hero class at a given armour rank. Falls back to 1 for unknowns. */
export function getMaxHp(heroClass: string, armourRank: number): number {
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
		classDisplayName: CLASS_DISPLAY_NAMES[root.heroClass] ?? root.heroClass,
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
		quirks: root.quirks
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
		get dirtyFiles() {
			return dirtyFiles;
		},
		get isLoaded() {
			return roster !== null;
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
export function markDirty(filename: string) {
	dirtyFiles = new Set([...dirtyFiles, filename]);
}

/** Clear dirty state for a file (e.g. after save). */
export function clearDirty(filename: string) {
	const next = new Set(dirtyFiles);
	next.delete(filename);
	dirtyFiles = next;
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

/** Update a hero's affliction. */
export function setHeroAffliction(guid: string, afflictionId: string) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw.affliction_type_id = afflictionId;
	raw.affliction_severity = afflictionId ? 1 : 0;
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

/** Heal a hero to max HP. */
export function healHeroToMax(guid: string) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	const maxHp = getMaxHp(raw.heroClass, raw.armour_rank);
	raw.actor.current_hp = maxHp;
	markDirty('persist.roster.json');
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
	// Note: full revival also requires campaign_log and progression edits
}

/** Dismiss a hero (remove from roster). */
export function dismissHero(guid: string) {
	if (!roster) return;
	delete roster.base_root.heroes[guid];
	roster.base_root.dismissed_hero_count += 1;
	markDirty('persist.roster.json');
}

// ── Town & Upgrade Helpers ──

/** Get heroes currently in treatment (status 2) with their building/activity info. */
export interface TreatmentHero {
	guid: string;
	name: string;
	heroClass: string;
	classDisplayName: string;
	buildingName: string;
	activityType: string;
}

/** Get all heroes currently in treatment for a specific building. */
export function getHeroesInBuilding(buildingName: TreatmentBuildingName): TreatmentHero[] {
	if (!roster) return [];
	const result: TreatmentHero[] = [];
	for (const [guid, entry] of Object.entries(roster.base_root.heroes)) {
		const root = entry.hero_file_data.raw_data.base_root;
		if (root['roster.status'] === 2 && root['roster.building_name'] === buildingName) {
			result.push({
				guid,
				name: root.actor.name,
				heroClass: root.heroClass,
				classDisplayName: CLASS_DISPLAY_NAMES[root.heroClass] ?? root.heroClass,
				buildingName: root['roster.building_name'],
				activityType: '' // Activity type is stored in town data slots
			});
		}
	}
	return result;
}

/** Release a hero from treatment: clear building status in roster. */
export function releaseHeroFromTreatment(guid: string) {
	const raw = getHeroRawData(guid);
	if (!raw) return;
	raw['roster.status'] = 0;
	raw['roster.building_name'] = '';
	raw['roster.before_on_start_town_visit_status'] = 0;
	markDirty('persist.roster.json');
	// Also mark town dirty since the slot reference should be removed
	markDirty('persist.town.json');
}

/** Get all building upgrades grouped by building name. */
export interface BuildingUpgradeGroup {
	buildingName: string;
	displayName: string;
	upgrades: UpgradePurchase[];
	purchasedCount: number;
	totalCount: number;
}

export function getBuildingUpgrades(): BuildingUpgradeGroup[] {
	if (!upgrades) return [];
	const groups: Record<string, UpgradePurchase[]> = {};

	for (const purchase of Object.values(upgrades.base_root.purchases)) {
		// Only building upgrades (instance_number === 0)
		if (purchase.instance_number !== 0) continue;
		const treeId = purchase.tree_id.replace(/^###/, '');
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
	const treeId = purchase.tree_id.replace(/^###/, '');
	const dotIndex = treeId.indexOf('.');
	if (dotIndex === -1) return;
	const buildingName = treeId.substring(0, dotIndex);

	if (!newState) {
		// Turning OFF: cascade — also turn off all higher-tier upgrades in same tree
		for (const p of Object.values(upgrades.base_root.purchases)) {
			if (p.instance_number !== 0) continue;
			const pTreeId = p.tree_id.replace(/^###/, '');
			const pDotIndex = pTreeId.indexOf('.');
			if (pDotIndex === -1) continue;
			const pBuildingName = pTreeId.substring(0, pDotIndex);
			const pUpgradeKey = pTreeId.substring(pDotIndex + 1);
			const upgradeKey = treeId.substring(dotIndex + 1);
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

/** Strip the ### prefix from a tree_id for display. */
export function formatTreeId(treeId: string): string {
	return treeId.replace(/^###/, '');
}

// ── Load/Reset ──

/** Load roster data into the store. */
export function loadRoster(data: RosterData) {
	roster = data;
	diskSnapshot = JSON.stringify(data);
}

/** Load estate data into the store. */
export function loadEstate(data: EstateData) {
	estate = data;
}

/** Load town data into the store. */
export function loadTown(data: TownData) {
	town = data;
}

/** Load upgrades data into the store. */
export function loadUpgrades(data: UpgradesData) {
	upgrades = data;
}

/** Revert a single hero to on-disk state. */
export function revertHero(guid: string) {
	if (!diskSnapshot || !roster) return;
	const snapshot = JSON.parse(diskSnapshot) as RosterData;
	const original = snapshot.base_root.heroes[guid];
	if (!original) return;
	roster.base_root.heroes[guid] = JSON.parse(JSON.stringify(original));
}

/** Clear all dirty flags (e.g. after successful save). */
export function clearAllDirty() {
	dirtyFiles = new Set();
	// Update disk snapshot to current state after save
	if (roster) diskSnapshot = JSON.stringify(roster);
}

/**
 * Discard all in-memory changes by reverting to the disk snapshot.
 * Reloads roster from the snapshot; resets dirty state.
 */
export function discardAllChanges() {
	if (diskSnapshot) {
		roster = JSON.parse(diskSnapshot) as RosterData;
	}
	// For estate/town/upgrades we don't have snapshots yet,
	// so we just clear dirty flags. Full reload from disk
	// would be done by the caller via the Tauri reload command.
	dirtyFiles = new Set();
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
	return data;
}

/** Reset all save data (e.g. on profile switch). */
export function resetSaveData() {
	roster = null;
	estate = null;
	town = null;
	upgrades = null;
	dirtyFiles = new Set();
	diskSnapshot = null;
}

// ── Mock Data for Development ──

/** Generate mock roster data for UI development. */
export function loadMockData() {
	const mockRoster: RosterData = {
		base_root: {
			version: 513,
			nextGuid: 110,
			dismissed_hero_count: 1,
			last_party: { last_party_guids: [96, 42, 7, 55] },
			heroes: {
				'96': createMockHero('Reynauld', 'crusader', 0, 4, 47, 54, 12, 3, 3),
				'42': createMockHero('Dismas', 'highwayman', 0, 3, 35, 35, 45, 2, 2),
				'7': createMockHero('Junia', 'vestal', 1, 5, 42, 42, 0, 4, 4),
				'55': createMockHero('Sarmenti', 'jester', 2, 2, 15, 26, 120, 2, 2, 'tavern'),
				'12': createMockHero('Barristan', 'man_at_arms', 2, 3, 42, 47, 30, 3, 3, 'abbey'),
				'23': createMockHero('Paracelsus', 'plague_doctor', 0, 4, 34, 34, 5, 3, 3),
				'34': createMockHero('Audrey', 'grave_robber', 2, 1, 24, 24, 67, 1, 1, 'sanitarium'),
				'45': createMockHero('Bigby', 'bounty_hunter', 3, 6, 0, 43, 0, 4, 4),
				'56': createMockHero('Boudica', 'hellion', 0, 3, 36, 36, 88, 2, 2),
				'67': createMockHero('Tardif', 'bounty_hunter', 0, 0, 26, 26, 0, 0, 0),
				'78': createMockHero('Damian', 'leper', 4, 2, 0, 49, 0, 2, 2),
				'89': createMockHero('Missandei', 'occultist', 2, 4, 30, 30, 15, 3, 3, 'abbey')
			}
		}
	};
	loadRoster(mockRoster);

	const mockUpgrades: UpgradesData = {
		base_root: {
			purchases: {
				'0': { instance_number: 0, tree_id: '###sanitarium.cost', requirement_code: 'a', is_purchased: true },
				'1': { instance_number: 0, tree_id: '###sanitarium.slot', requirement_code: 'a', is_purchased: true },
				'2': { instance_number: 0, tree_id: '###sanitarium.slot', requirement_code: 'b', is_purchased: false },
				'3': { instance_number: 0, tree_id: '###tavern.cost', requirement_code: 'a', is_purchased: true },
				'4': { instance_number: 0, tree_id: '###tavern.cost', requirement_code: 'b', is_purchased: true },
				'5': { instance_number: 0, tree_id: '###tavern.slot', requirement_code: 'a', is_purchased: true },
				'6': { instance_number: 0, tree_id: '###abbey.cost', requirement_code: 'a', is_purchased: true },
				'7': { instance_number: 0, tree_id: '###abbey.slot', requirement_code: 'a', is_purchased: false },
				'8': { instance_number: 0, tree_id: '###blacksmith.cost', requirement_code: 'a', is_purchased: true },
				'9': { instance_number: 0, tree_id: '###blacksmith.cost', requirement_code: 'b', is_purchased: true },
				'10': { instance_number: 0, tree_id: '###blacksmith.cost', requirement_code: 'c', is_purchased: false },
				'11': { instance_number: 0, tree_id: '###guild.cost', requirement_code: 'a', is_purchased: true },
				'12': { instance_number: 0, tree_id: '###guild.cost', requirement_code: 'b', is_purchased: false },
				'13': { instance_number: 0, tree_id: '###stage_coach.size', requirement_code: 'a', is_purchased: true },
				'14': { instance_number: 0, tree_id: '###stage_coach.size', requirement_code: 'b', is_purchased: true },
				'15': { instance_number: 0, tree_id: '###stage_coach.roster_size', requirement_code: 'a', is_purchased: true },
				'16': { instance_number: 0, tree_id: '###survivalist.cost', requirement_code: 'a', is_purchased: true },
				'17': { instance_number: 0, tree_id: '###nomad_wagon.cost', requirement_code: 'a', is_purchased: true },
				'18': { instance_number: 0, tree_id: '###nomad_wagon.cost', requirement_code: 'b', is_purchased: false },
				'19': { instance_number: 96, tree_id: '###crusader.smite', requirement_code: '1', is_purchased: true },
				'20': { instance_number: 96, tree_id: '###crusader.stand_tall', requirement_code: '1', is_purchased: true }
			}
		}
	};
	loadUpgrades(mockUpgrades);
}

function createMockHero(
	name: string,
	heroClass: string,
	status: number,
	level: number,
	currentHp: number,
	_maxHpOverride: number,
	stress: number,
	weaponRank: number,
	armourRank: number,
	buildingName: string = ''
): HeroEntry {
	const quirks: Record<string, HeroQuirk> = {};
	// Add some example quirks
	const positiveQuirks = ['quick_reflexes', 'natural_swing', 'tough', 'eagle_eye', 'hard_skinned'];
	const negativeQuirks = ['nervous', 'fear_of_beast', 'kleptomaniac', 'thin_blooded', 'slow_reflexes'];
	const numPositive = Math.floor(Math.random() * 4) + 1;
	const numNegative = Math.floor(Math.random() * 3) + 1;

	for (let i = 0; i < numPositive; i++) {
		quirks[positiveQuirks[i]] = {
			is_locked: i === 0, // lock first one
			is_new: false,
			mission_count: Math.floor(Math.random() * 10),
			replaces_quirk: 0,
			replaces_quirk_viewed: false,
			evolution_duration_remaining: 0
		};
	}
	for (let i = 0; i < numNegative; i++) {
		quirks[negativeQuirks[i]] = {
			is_locked: false,
			is_new: false,
			mission_count: Math.floor(Math.random() * 10),
			replaces_quirk: 0,
			replaces_quirk_viewed: false,
			evolution_duration_remaining: 0
		};
	}

	return {
		hero_file_data: {
			raw_data: {
				base_root: {
					'roster.status': status,
					'roster.before_on_start_town_visit_status': status === 2 ? 0 : status,
					'roster.building_name': buildingName,
					actor: {
						name,
						current_hp: currentHp,
						colour_variation: 0,
						stunned: 0,
						combat_ready: false,
						damage_source_data: '###none',
						buff_group: {},
						buff_group_next_guid: 0,
						actor_dot: {}
					},
					heroClass,
					resolveXp: RESOLVE_XP_THRESHOLDS[level],
					m_Stress: stress,
					visited_deaths_door: status === 3,
					is_death_heart_attack_completed: false,
					has_had_heart_attack: false,
					deaths_door_enter_effect_round_cooldown: 0,
					weapon_rank: weaponRank,
					armour_rank: armourRank,
					affliction_type_id: stress >= 100 ? 'paranoid' : '',
					affliction_severity: stress >= 100 ? 1 : 0,
					virtue_type_id: '',
					backer_hero: false,
					enemies_killed: Math.floor(Math.random() * 50),
					steps_taken: Math.floor(Math.random() * 200),
					provisions_consumed: Math.floor(Math.random() * 100),
					dd_test_survived: 0,
					number_of_successful_darkest_dungeon_quests: 0,
					is_from_town_event: false,
					quirks,
					skills: {
						selected_combat_skills: {},
						selected_camping_skills: {}
					},
					trinkets: { items: {} },
					dungeon_history: []
				}
			}
		}
	};
}
