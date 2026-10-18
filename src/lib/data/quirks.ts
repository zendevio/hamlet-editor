/**
 * Quirk ID categorization for the hero detail panel.
 *
 * Derived from docs/save-files.md and docs/game-data.md.
 * Used to separate positive vs negative vs disease quirks,
 * and to populate the "Add Quirk" combobox.
 */

import { snakeToTitle } from '#lib/utils.js';

export type QuirkCategory = 'positive' | 'negative' | 'disease';

export interface QuirkInfo {
	id: string;
	displayName: string;
	category: QuirkCategory;
}

const POSITIVE_QUIRK_IDS = [
	'tough',
	'hard_skinned',
	'quick_reflexes',
	'natural_swing',
	'natural_eye',
	'evasive',
	'slugger',
	'unerring',
	'accurate',
	'precision_striker',
	'eagle_eye',
	'steady',
	'resilient',
	'thick_blooded',
	'clotter',
	'fated',
	'hard_noggin',
	'fast_healer',
	'second_wind',
	'clutch_hitter',
	'on_guard',
	'early_riser',
	'warrior_of_light',
	// Color of Madness
	'luminous',
	'hippocratic',
	'hot_to_trot',
	'musical',
	'spiritual',
	'gifted',
	'daredevil',
	'natural',
	// Prismatic (unique per roster)
	'alien_speed',
	'alien_eye',
	'alien_force',
	'alien_precision',
	'alien_calm',
	'alien_purity',
	'alien_healing',
	'alien_solidity'
];

const NEGATIVE_QUIRK_IDS = [
	// Stat penalty
	'fragile',
	'soft',
	'slow_reflexes',
	'slowdraw',
	'the_yips',
	'lazy_eye',
	'clumsy',
	'torn_rotator_cuff',
	'scattering',
	'inaccurate',
	'weak_grip',
	'flawed_release',
	'nervous',
	'ruminator',
	'thin_blooded',
	'anemic',
	'sickly',
	'mercurial',
	'winded',
	'tuckered_out',
	'off_guard',
	'dud_hitter',
	'stress_eater',
	'stress_faster',
	'night_blindness',
	'sensitive_to_light',
	'diurnal',
	'nocturnal',
	'shocker',
	'suicidal',
	'last_gasp',
	'double_vision',
	'stomach_cramp',
	'disorganized',
	'bulimic',
	'irrepressible',
	'unyielding',
	'too_boastful',
	'cruelty_conscious',
	// Phobias
	'fear_of_beast',
	'fear_of_eldritch',
	'fear_of_man',
	'fear_of_unholy',
	'zoophobia',
	'automatonophobia',
	'claustrophobia',
	'lygophobia',
	'phengophobia',
	'satanophobia',
	'thanatophobia',
	'autophobia',
	'necrophobia',
	'lurker',
	// Dungeon phobias
	'ruins_phobe',
	'warren_phobe',
	'weald_phobe',
	'cove_phobe',
	'darkest_dungeon_phobe',
	// Dungeon scroungers
	'ruins_scrounger',
	'warren_scrounger',
	'weald_scrounger',
	'cove_scrounger',
	'darkest_dungeon_scrounger',
	// Hatred
	'hatred_of_eldritch',
	'hatred_of_unholy',
	'hatred_of_man',
	'hatred_of_beast',
	// Compulsions
	'kleptomaniac',
	'curious',
	'bloodthirsty',
	'guilty_conscience',
	'hieromania',
	'necromania',
	'ablutomania',
	'dacnomania',
	'egomania',
	'hylomania',
	'nymphomania',
	'sitiomania',
	'photomania',
	'plutomania',
	'dipsomania',
	'paranormania',
	'demonomania',
	'compulsive',
	'hagiomania',
	'dark_temptation',
	// Town activity
	'deviant_tastes',
	'known_cheat',
	'unquiet_mind',
	'witness',
	'faithless',
	'alcoholism',
	'gambler',
	'bad_gambler',
	'love_interest',
	'tither',
	'flagellant',
	// Crimson Court
	'corvid_blindness',
	'corvid_appetite',
	'corvid_curiosity',
	// Color of Madness
	'shard_mercenary'
];

const DISEASE_IDS = [
	'bad_humours',
	'creeping_cough',
	'hemophilia',
	'the_runs',
	'lethargy',
	'wasting_sickness',
	'tetanus',
	'rabies',
	'syphilis',
	'spotted_fever',
	'vertigo',
	'vampiric_spirits',
	'ennui',
	'the_ague',
	'hysterical_blindness',
	'scurvy',
	'the_worries',
	'the_fits',
	'tapeworm',
	'the_red_plague',
	'the_black_plague',
	// Crimson Curse states
	'disease_vampire_passive',
	'disease_vampire_crave',
	'disease_vampire_wasting',
	'disease_vampire_blood_lust'
];

const positiveSet = new Set(POSITIVE_QUIRK_IDS);
const negativeSet = new Set(NEGATIVE_QUIRK_IDS);
const diseaseSet = new Set(DISEASE_IDS);

/** Classify a quirk ID. Unknown quirks default to negative. */
export function getQuirkCategory(quirkId: string): QuirkCategory {
	if (diseaseSet.has(quirkId)) return 'disease';
	if (positiveSet.has(quirkId)) return 'positive';
	if (negativeSet.has(quirkId)) return 'negative';
	// Unknown quirks: default to negative
	return 'negative';
}

/** Get all known quirks as QuirkInfo[], grouped by category. */
export function getAllQuirks(): QuirkInfo[] {
	const all: QuirkInfo[] = [];

	for (const id of POSITIVE_QUIRK_IDS) {
		all.push({ id, displayName: snakeToTitle(id), category: 'positive' });
	}
	for (const id of NEGATIVE_QUIRK_IDS) {
		all.push({ id, displayName: snakeToTitle(id), category: 'negative' });
	}
	for (const id of DISEASE_IDS) {
		all.push({ id, displayName: snakeToTitle(id), category: 'disease' });
	}

	return all;
}

/** Check if a quirk is positive. */
export function isPositiveQuirk(quirkId: string): boolean {
	return getQuirkCategory(quirkId) === 'positive';
}

/** Check if a quirk is a disease. */
export function isDiseaseQuirk(quirkId: string): boolean {
	return getQuirkCategory(quirkId) === 'disease';
}
