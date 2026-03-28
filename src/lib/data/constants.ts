/**
 * Game constants for Darkest Dungeon save editing.
 *
 * Extracted from save-data.svelte.ts to keep the store focused on state
 * and mutation logic.
 */

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

// ── Resolve Constants ──

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

// ── Status Constants ──

/** Status code labels and colors. */
export const STATUS_MAP: Record<number, { label: string; color: string; dotClass: string }> = {
	0: { label: 'Available', color: 'green', dotClass: 'bg-green-500' },
	1: { label: 'In Squad', color: 'teal', dotClass: 'bg-teal-500' },
	2: { label: 'In Treatment', color: 'blue', dotClass: 'bg-blue-500' },
	3: { label: 'Dead', color: 'red', dotClass: 'bg-red-500' },
	4: { label: 'In Raid', color: 'orange', dotClass: 'bg-orange-500' }
};

// ── HP Table ──

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

// ── Class Display Names ──

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
