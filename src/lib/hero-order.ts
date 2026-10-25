import type { HeroSummary } from '#lib/types/save-data.js';
import { compareNames, compareIds } from '#lib/i18n/intl.js';
import { heroClassName, gameTextLocale } from '#lib/save-labels.js';

/** Preserve selection by raw guid while sorting a fresh display-only array. */
export function sortHeroes(heroes: readonly HeroSummary[], sort: string): HeroSummary[] {
	const userName = (a: HeroSummary, b: HeroSummary) => compareNames(a.name, a.guid, b.name, b.guid);
	const statusOrder: Record<number, number> = { 0: 0, 1: 1, 2: 2, 4: 3, 3: 4 };
	return [...heroes].sort((a, b) => {
		switch (sort) {
			case 'name': return userName(a, b);
			case 'class': return compareNames(heroClassName(a.heroClass), a.guid, heroClassName(b.heroClass), b.guid, gameTextLocale());
			case 'level': return b.resolveLevel - a.resolveLevel || userName(a, b);
			case 'hp': return a.currentHp / a.maxHp - b.currentHp / b.maxHp || compareIds(a.guid, b.guid);
			case 'stress': return b.stress - a.stress || userName(a, b);
			default: return (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5) || b.resolveLevel - a.resolveLevel || userName(a, b);
		}
	});
}
