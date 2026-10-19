import type { TownData } from '#lib/types/save-data.js';

export function readDistricts(town: TownData | null) {
	return Object.entries(town?.base_root.districts?.buildings ?? {})
		.filter(([, district]) => typeof district.built === 'boolean')
		.map(([id, district]) => ({ id, built: district.built }));
}

/** Only edit an existing entry so its saved buffs and counters are preserved. */
export function updateDistrict(town: TownData, id: string, built: boolean): boolean {
	const district = town.base_root.districts?.buildings[id];
	if (!district || typeof built !== 'boolean' || district.built === built) return false;
	district.built = built;
	return true;
}
