/**
 * Quirk ID categorization for the hero detail panel.
 *
 * Fallback IDs come from the installed base and DLC quirk libraries.
 * Used to separate positive vs negative vs disease quirks,
 * and to populate the inline "Add Quirk" picker.
 */

import { snakeToTitle } from '#lib/utils.js';
import { getGameData, localize } from '#lib/stores/game-data.svelte.js';

export type QuirkCategory = 'positive' | 'negative' | 'disease';

export interface QuirkInfo {
	id: string;
	displayName: string;
	description: string;
	category: QuirkCategory;
}

// Generated from the base, Crimson Court and Color of Madness quirk libraries.
// The committed classification extract in tests/fixtures guards this fallback.
const POSITIVE_QUIRK_IDS = [
	'accurate',
	'alien_calm',
	'alien_eye',
	'alien_force',
	'alien_healing',
	'alien_isolation',
	'alien_precision',
	'alien_purity',
	'alien_solidity',
	'alien_speed',
	'alien_stability',
	'armor_haggler',
	'back_tracker',
	'clotter',
	'clutch_hitter',
	'corvids_eye',
	'corvids_grace',
	'corvids_resilience',
	'cove_adventurer',
	'cove_explorer',
	'cove_scrounger',
	'cove_tactician',
	'daredevil',
	'eagle_eye',
	'early_riser',
	'evasive',
	'fairweather_fighter',
	'fast_healer',
	'fated',
	'gift_of_the_healer',
	'gifted',
	'gothic',
	'hard_noggin',
	'hard_skinned',
	'hatred_of_beast',
	'hatred_of_eldritch',
	'hatred_of_man',
	'hatred_of_unholy',
	'hippocratic',
	'hot_to_trot',
	'husk_slayer',
	'improved_balance',
	'irrepressible',
	'last_gasp',
	'luminous',
	'lurker',
	'meditator',
	'musical',
	'natural',
	'natural_eye',
	'natural_swing',
	'night_owl',
	'nymphomania',
	'on_guard',
	'photomania',
	'precision_striker',
	'quick_reflexes',
	'quickdraw',
	'resilient',
	'robust',
	'ruins_adventurer',
	'ruins_explorer',
	'ruins_scrounger',
	'ruins_tactician',
	'scythemaster',
	'second_wind',
	'skilled_gambler',
	'slayer_of_beast',
	'slayer_of_eldritch',
	'slayer_of_man',
	'slayer_of_unholy',
	'slugger',
	'spiritual',
	'steady',
	'stout',
	'stress_faster',
	'thick_blooded',
	'tough',
	'twilight_dreamer',
	'unerring',
	'unyielding',
	'warren_adventurer',
	'warren_explorer',
	'warren_scrounger',
	'warren_tactician',
	'warrior_of_light',
	'weald_adventurer',
	'weald_explorer',
	'weald_scrounger',
	'weald_tactician',
	'weapons_haggler'
];

const NEGATIVE_QUIRK_IDS = [
	'ablutomania',
	'alcoholism',
	'anemic',
	'antsy',
	'ascetic',
	'ashen',
	'automatonophobia',
	'bad_gambler',
	'bad_healer',
	'bloodthirsty',
	'calm',
	'claustrophobia',
	'clumsy',
	'compulsive',
	'corvids_appetite',
	'corvids_blindness',
	'corvids_curiosity',
	'cove_phobe',
	'curious',
	'dacnomania',
	'dark_temptation',
	'demonomania',
	'deviant_tastes',
	'dipsomania',
	'diurnal',
	'dud_hitter',
	'egomania',
	'enlightened',
	'fading',
	'faithless',
	'fear_of_beast',
	'fear_of_eldritch',
	'fear_of_man',
	'fear_of_unholy',
	'flagellant',
	'flawed_release',
	'fragile',
	'gambler',
	'germophobe',
	'god_fearing',
	'guilty_conscience',
	'hagiomania',
	'hieromania',
	'hylomania',
	'imposter_syndrome',
	'inaccurate',
	'infirm',
	'kleptomaniac',
	'known_cheat',
	'lazy_eye',
	'love_interest',
	'lygophobia',
	'mercurial',
	'necromania',
	'nervous',
	'nervous_bleeder',
	'night_blindness',
	'nocturnal',
	'off_guard',
	'paranormania',
	'perfectionist',
	'phengophobia',
	'plutomania',
	'resolution',
	'risktaker',
	'ruins_phobe',
	'ruminator',
	'satanophobia',
	'scattering',
	'scientific',
	'sensitive_to_light',
	'shard_hungry',
	'shocker',
	'sickly',
	'sitiomania',
	'slow_reflexes',
	'slowdraw',
	'soft',
	'stress_eater',
	'suicidal',
	'thanatophobia',
	'the_yips',
	'thin_blooded',
	'tone_deaf',
	'torn_rotator_cuff',
	'tuckered_out',
	'unquiet_mind',
	'warren_phobe',
	'weak_grip',
	'weald_phobe',
	'winded',
	'witness',
	'zoophobia'
];

const DISEASE_IDS = [
	'bad_humours',
	'bulimic',
	'creeping_cough',
	'disease_vampire_blood_lust',
	'disease_vampire_crave',
	'disease_vampire_passive',
	'disease_vampire_wasting',
	'ennui',
	'grey_rot',
	'hemophilia',
	'hysterical_blindness',
	'lethargy',
	'rabies',
	'scurvy',
	'sky_taint',
	'spotted_fever',
	'stomach_cramp',
	'syphilis',
	'tapeworm',
	'tetanus',
	'the_ague',
	'the_black_plague',
	'the_fits',
	'the_red_plague',
	'the_runs',
	'the_worries',
	'vampiric_spirits',
	'vertigo',
	'wasting_sickness'
];

const positiveSet = new Set(POSITIVE_QUIRK_IDS);
const negativeSet = new Set(NEGATIVE_QUIRK_IDS);
const diseaseSet = new Set(DISEASE_IDS);

/** Classify a quirk ID. Unknown quirks default to negative. */
export function getQuirkCategory(quirkId: string): QuirkCategory {
	const def = getGameData().quirks.find((q) => q.id === quirkId);
	if (def) return def.is_disease ? 'disease' : def.is_positive ? 'positive' : 'negative';
	if (diseaseSet.has(quirkId)) return 'disease';
	if (positiveSet.has(quirkId)) return 'positive';
	if (negativeSet.has(quirkId)) return 'negative';
	// Unknown quirks: default to negative
	return 'negative';
}

/** Get all known quirks as QuirkInfo[], grouped by category. */
export function getAllQuirks(): QuirkInfo[] {
	const defs = getGameData().quirks;
	const ids = defs.length
		? defs.map((q) => q.id)
		: [...POSITIVE_QUIRK_IDS, ...NEGATIVE_QUIRK_IDS, ...DISEASE_IDS];
	return ids.map((id) => ({
		id,
		displayName: quirkName(id),
		description: quirkDescription(id),
		category: getQuirkCategory(id)
	}));
}

/** Check if a quirk is positive. */
export function isPositiveQuirk(quirkId: string): boolean {
	return getQuirkCategory(quirkId) === 'positive';
}

/** Check if a quirk is a disease. */
export function isDiseaseQuirk(quirkId: string): boolean {
	return getQuirkCategory(quirkId) === 'disease';
}

export function quirkName(id: string): string {
	return localize(`str_quirk_name_${id}`, snakeToTitle(id));
}

export function quirkDescription(id: string): string {
	return localize(`str_quirk_description_${id}`, '');
}

export function matchesQuirkSearch(id: string, name: string, search: string): boolean {
	const query = search.trim().toLowerCase();
	return id.toLowerCase().includes(query) || name.toLowerCase().includes(query);
}
