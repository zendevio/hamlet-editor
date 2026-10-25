import { snakeToTitle } from '#lib/utils.js';
import { CLASS_DISPLAY_NAMES, BUILDING_DISPLAY_NAMES, ACTIVITY_DISPLAY_NAMES, RESOLVE_LEVEL_NAMES } from '#lib/data/constants.js';
import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';
import { getGameData, localize, localizeEnglish } from '#lib/stores/game-data.svelte.js';
import { t } from '#lib/i18n/index.svelte.js';
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
	return localize('town_name_' + id, BUILDING_DISPLAY_NAMES[id] ?? id);
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
