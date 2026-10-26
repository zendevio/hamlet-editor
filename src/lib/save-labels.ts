import { snakeToTitle, stripDsonPrefix } from '#lib/utils.js';
import { CLASS_DISPLAY_NAMES, BUILDING_DISPLAY_NAMES, ACTIVITY_DISPLAY_NAMES, RESOLVE_LEVEL_NAMES, DISTRICT_DISPLAY_NAMES, CURRENCY_DISPLAY_NAMES, ESTATE_ITEM_DISPLAY_NAMES, DLC_DISPLAY_NAMES, UPGRADE_TREE_DISPLAY_NAMES } from '#lib/data/constants.js';
import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';
import { getGameData, localize, localizeEnglish } from '#lib/stores/game-data.svelte.js';
import { getEditorLocale, t } from '#lib/i18n/index.svelte.js';
import { CURSE_STATES } from '#lib/hero-safety.js';
import { compareNames } from '#lib/i18n/intl.js';

export function gameTextLocale(): string {
	return GAME_TEXT_LOCALES[getGameData().displayLanguage];
}

/** Call during render, never cache translated labels in a save summary. */
export function heroClassName(id: string): string {
	return localize('hero_class_name_' + id, CLASS_DISPLAY_NAMES[id] ?? id);
}

export function heroStatusLabel(status: number): string {
	switch (status) {
		case 0: return t('hero.status.available');
		case 1: return t('hero.status.party');
		case 2: return t('hero.status.treatment');
		case 3: return t('hero.status.dead');
		case 4: return t('hero.status.missing');
		default: return t('hero.status.unknown', { status: String(status) });
	}
}

export function buildingDisplayName(id: string): string {
	return localize('town_name_' + id, BUILDING_DISPLAY_NAMES[id] ?? snakeToTitle(id));
}

export function compareBuildingNames(a: { buildingName: string }, b: { buildingName: string }): number {
	return compareNames(buildingDisplayName(a.buildingName), a.buildingName,
		buildingDisplayName(b.buildingName), b.buildingName, gameTextLocale());
}


export function heroClassEnglishName(id: string): string {
	// Search aliases: hero_class_name_, str_inventory_title_trinket, str_quirk_name_.
	// Keep in sync with SEARCH_ALIAS_PREFIXES in src-tauri/src/commands/names.rs and quirks.ts.
	return localizeEnglish('hero_class_name_' + id, CLASS_DISPLAY_NAMES[id] ?? id);
}

export function resolveTitle(level: number): string {
	return localize(`str_resolve_${level}`, RESOLVE_LEVEL_NAMES[level] ?? String(level));
}

export function combatSkillName(heroClass: string, id: string): string {
	return localize(`combat_skill_name_${heroClass}_${id}`, snakeToTitle(id));
}

export function campingSkillName(id: string): string {
	return localize(`camping_skill_name_${id}`, snakeToTitle(id));
}

export function trinketName(id: string): string {
	return localize(`str_inventory_title_trinket${id}`, snakeToTitle(id));
}

export function trinketEnglishName(id: string): string {
	return localizeEnglish(`str_inventory_title_trinket${id}`, snakeToTitle(id));
}

const AFFLICTIONS: Record<string, string> = { depressed: 'Hopeless', berserk: 'Rapturous', color_madness: 'Refracted' };
export const VIRTUES = ['courageous', 'focused', 'powerful', 'vigorous', 'stalwart'];
export function afflictionName(id: string): string {
	return localize(`${VIRTUES.includes(id) ? 'str_virtue_name_' : 'str_affliction_name_'}${id}`, AFFLICTIONS[id] ?? snakeToTitle(id));
}

export function vampireStateName(id: string): string {
	// An unrecognized state (for example from a mod) keeps its raw id visible.
	return CURSE_STATES.includes(id as (typeof CURSE_STATES)[number]) ? t('heroes.curseState', { state: id }) : id;
}

export function activityDisplayName(id: string): string {
	return localize('town_activity_name_' + id, ACTIVITY_DISPLAY_NAMES[id] ?? snakeToTitle(id));
}

export function districtName(id: string): string {
	return localize(`str_${id}_title`, DISTRICT_DISPLAY_NAMES[id] ?? snakeToTitle(id));
}

// The game has plural heirloom names only inside format strings (excluded in v1),
// so these count captions are editor catalog text in the editor language.
const HEIRLOOM_CAPTIONS = ['bust', 'portrait', 'deed', 'crest'];

/** Language tag for currencyName(id): editor locale for catalog captions, else game text. */
export function currencyNameLang(id: string): string {
	return HEIRLOOM_CAPTIONS.includes(id) ? getEditorLocale() : gameTextLocale();
}

export function currencyName(id: string): string {
	if (HEIRLOOM_CAPTIONS.includes(id)) return t('estate.heirloomCaption', { kind: id });
	if (id === 'blueprint') return localize('tutorial_popup_blueprints_title', CURRENCY_DISPLAY_NAMES[id]);
	const prefix = ['gold', 'shard'].includes(id) ? '' : 'heirloom';
	return localize(`str_inventory_title_${prefix}${id}`, CURRENCY_DISPLAY_NAMES[id] ?? snakeToTitle(id));
}

export function estateItemName(id: string): string {
	const prefix = id.startsWith('crimson_court_invitation_') ? 'estate_currency' : 'estate';
	return localize(`str_inventory_title_${prefix}${id}`, ESTATE_ITEM_DISPLAY_NAMES[id] ?? snakeToTitle(id));
}

export function dlcName(id: string): string {
	return localize(`str_dlc_title_${id}`, DLC_DISPLAY_NAMES[id] ?? snakeToTitle(id));
}

export function upgradeTreeName(id: string): string {
	const tree = stripDsonPrefix(id);
	const key = tree.includes('.') ? tree.substring(tree.indexOf('.') + 1) : tree;
	return localize(`upgrade_tree_name_${tree}`, UPGRADE_TREE_DISPLAY_NAMES[tree] ?? snakeToTitle(key));
}
