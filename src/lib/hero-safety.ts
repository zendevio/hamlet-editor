import { readTreatmentSlots } from '#lib/treatment.js';
import type { EstateData, GameData, HeroBaseRoot, HeroQuirk, RaidData, RosterData, TownData, TrinketEntry, UpgradesData } from '#lib/types/save-data.js';

export const CURSE_STATES = ['disease_vampire_passive', 'disease_vampire_crave', 'disease_vampire_wasting', 'disease_vampire_blood_lust'] as const;
export const isCurseQuirk = (id: string) => id.startsWith('disease_vampire_');
export const canPickQuirk = (id: string) => !isCurseQuirk(id);

/** Changing one existing state preserves its metadata and cannot create a curse. */
export function changeCurseState(hero: HeroBaseRoot, id: string): boolean {
	const existing = Object.keys(hero.quirks).filter(isCurseQuirk);
	if (existing.length !== 1 || !CURSE_STATES.includes(id as typeof CURSE_STATES[number]) || existing[0] === id) return false;
	const quirk: HeroQuirk = hero.quirks[existing[0]];
	delete hero.quirks[existing[0]];
	hero.quirks[id] = quirk;
	return true;
}

export interface HeroReferences {
	roster: RosterData | null;
	town: TownData | null;
	upgrades: UpgradesData | null;
	game: GameData | null;
	raid: RaidData | null;
	estate: EstateData | null;
	inactiveRaidHeroGuids: readonly number[];
}

/** Preserve complete equipped entries, accepting only the verified trinket shape. */
export function equippedTrinkets(hero: HeroBaseRoot): TrinketEntry[] | null {
	const items = hero.trinkets?.items;
	if (!items || typeof items !== 'object' || Array.isArray(items)) return null;
	const entries = Object.values(items);
	if (!entries.every((item): item is TrinketEntry => {
		if (!item || typeof item !== 'object') return false;
		const trinket = item as TrinketEntry;
		return typeof trinket.id === 'string' && trinket.id.length > 0 && trinket.type === 'trinket'
			&& Number.isInteger(trinket.amount) && trinket.amount > 0 && trinket.amount <= 2147483647;
	})) return null;
	return entries;
}

export function dismissBlockReason(guid: string, data: HeroReferences): string | null {
	const hero = data.roster?.base_root.heroes[guid]?.hero_file_data.raw_data.base_root;
	if (!hero) return 'This hero is no longer in the roster.';
	if (Object.keys(data.roster!.base_root.heroes).length <= 1) return 'You need at least 1 hero to venture on. Recruit another hero before dismissing this one.';
	if (hero['roster.status'] === 2 || hero['roster.building_name'] || readTreatmentSlots(data.town).some(({ slot }) => String(slot.hero) === guid)) {
		return 'Release this hero from treatment before dismissing them.';
	}
	if (data.raid?.base_root.party.heroes.includes(Number(guid)) || hero['roster.status'] === 1) {
		return 'This hero is in the raid party. Return to town before dismissing them.';
	}
	if (data.game?.base_root.inraid) return 'Dismissal is unavailable during a raid.';
	if (data.inactiveRaidHeroGuids.includes(Number(guid))) {
		return 'This hero is referenced by the saved inactive raid. Complete that expedition in the game before dismissing them.';
	}
	if (!data.town || !data.upgrades || !data.game) {
		return 'Dismissal is blocked because reference data is missing. Reload the complete profile.';
	}
	const trinkets = equippedTrinkets(hero);
	const storage = data.estate?.base_root.trinkets?.items;
	if (!trinkets || (trinkets.length > 0 && (!storage || Array.isArray(storage)
		|| Object.keys(storage).some((key) => !/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(Number(key)))
		|| Object.keys(storage).some((key) => Number(key) >= 2147483647)))) {
		return 'Unequip trinkets first: their estate storage cannot be updated safely.';
	}
	// Keep the game's four party slots; -1 marks an empty position.
	const lastParty = data.roster?.base_root.last_party?.last_party_guids;
	if (!Array.isArray(lastParty) || lastParty.length !== 4 || !lastParty.every((id) => Number.isInteger(id))) {
		return 'Dismissal is blocked because the last party list has an unsupported shape.';
	}
	return null;
}

/** The available sample has no dead roster hero or verified revival transition. */
export function revivalBlockReason(isRaidActive: boolean): string {
	return isRaidActive
		? 'Revival is blocked during a raid because restoring combat and party state is unverified. Return to town first.'
		: 'Revival is unavailable: the reference saves do not verify how to restore dead heroes across roster, progression and campaign history. Revive through an in-game town event.';
}
