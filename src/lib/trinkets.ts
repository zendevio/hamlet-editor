import type { TrinketDef } from '#lib/api/gamedata.js';
import type { EstateData, HeroBaseRoot, TrinketEntry } from '#lib/types/save-data.js';
import { equippedTrinkets } from '#lib/hero-safety.js';

export type TrinketSource = 'inventory' | 'catalogue';

export function canEquipTrinket(id: string, heroClass: string, definitions: readonly TrinketDef[]): boolean {
	const restriction = definitions.find((entry) => entry.id === id)?.class_restriction;
	return !restriction || restriction === heroClass;
}

export function storageItems(estate: EstateData | null): Record<string, unknown> | null {
	const items = estate?.base_root?.trinkets?.items;
	if (!items || typeof items !== 'object' || Array.isArray(items)) return null;
	if (Object.keys(items).some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= 2147483647)) return null;
	return items;
}

function isTrinket(item: unknown): item is TrinketEntry {
	if (!item || typeof item !== 'object') return false;
	const entry = item as TrinketEntry;
	return typeof entry.id === 'string' && !!entry.id && entry.type === 'trinket'
		&& Number.isInteger(entry.amount) && entry.amount > 0 && entry.amount <= 2147483647;
}

export function inventoryTrinkets(estate: EstateData | null): { id: string; amount: number }[] {
	const counts = new Map<string, number>();
	for (const item of Object.values(storageItems(estate) ?? {})) {
		if (isTrinket(item)) counts.set(item.id, (counts.get(item.id) ?? 0) + item.amount);
	}
	return [...counts].map(([id, amount]) => ({ id, amount }));
}

/** Match dismissal: append numbered entries, copying only estate item fields. */
export function returnTrinkets(items: Record<string, unknown>, trinkets: readonly TrinketEntry[]): void {
	let nextKey = Math.max(-1, ...Object.keys(items).map(Number)) + 1;
	for (const { id, amount } of trinkets) items[String(nextKey++)] = { id, type: 'trinket', amount };
}

/** Validate the whole move before mutating either file. */
export function equipTrinket(
	hero: HeroBaseRoot,
	estate: EstateData | null,
	slot: '0' | '1',
	id: string,
	source: TrinketSource,
	definitions: readonly TrinketDef[] = []
): { changed: boolean; estateChanged: boolean; error?: string } {
	const unchanged = { changed: false, estateChanged: false };
	if (hero['roster.status'] === 3) return { ...unchanged, error: 'Trinkets cannot be equipped or unequipped on a dead hero. Revive them in town first.' };
	const entries = equippedTrinkets(hero);
	if (!entries) return { ...unchanged, error: 'This hero has unsupported trinket data.' };
	const previous = hero.trinkets.items[slot] as TrinketEntry | undefined;
	if ((previous?.id ?? '') === id) return unchanged;
	if (id && !canEquipTrinket(id, hero.heroClass, definitions)) {
		return { ...unchanged, error: 'This trinket is restricted to another hero class.' };
	}
	const needsEstate = !!previous || (!!id && source === 'inventory');
	const items = storageItems(estate);
	if (needsEstate && !items) {
		return { ...unchanged, error: 'Load a valid estate file before moving trinkets to or from inventory.' };
	}
	const match = id && source === 'inventory'
		? Object.entries(items!).find(([, item]) => isTrinket(item) && item.id === id)
		: undefined;
	if (id && source === 'inventory' && !match) {
		return { ...unchanged, error: 'This trinket is no longer in your inventory.' };
	}
	if (match) {
		const [key, entry] = match as [string, TrinketEntry];
		if (entry.amount > 1) entry.amount--;
		else delete items![key];
	}
	if (previous) returnTrinkets(items!, [previous]);
	if (id) hero.trinkets.items[slot] = { id, type: 'trinket', amount: 1 };
	else delete hero.trinkets.items[slot];
	return { changed: true, estateChanged: needsEstate };
}
