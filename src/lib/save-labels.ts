import { CLASS_DISPLAY_NAMES, BUILDING_DISPLAY_NAMES } from '#lib/data/constants.js';
import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';
import { getGameData, localize } from '#lib/stores/game-data.svelte.js';
import { t } from '#lib/i18n/index.svelte.js';
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

/** Compatibility with validation.ts categories until its S3 descriptor migration. */
export function validationCategory(category: string): string {
	switch (category) {
		case 'Gear Rank': return t('validation.category.gear');
		case 'Treatment': return t('validation.category.treatment');
		case 'DLC': return t('validation.category.dlc');
		default: return category;
	}
}
