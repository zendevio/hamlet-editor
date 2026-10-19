import { readTreatmentSlots } from '#lib/treatment.js';
import type { GameData, HeroBaseRoot, HeroQuirk, RaidData, RosterData, TownData, UpgradesData } from '#lib/types/save-data.js';

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
}

export function dismissBlockReason(guid: string, data: HeroReferences): string | null {
	const hero = data.roster?.base_root.heroes[guid]?.hero_file_data.raw_data.base_root;
	if (!hero) return 'This hero is no longer in the roster.';
	if (hero['roster.status'] === 2 || hero['roster.building_name'] || readTreatmentSlots(data.town).some(({ slot }) => String(slot.hero) === guid)) {
		return 'Release this hero from treatment before dismissing them.';
	}
	if (data.raid?.base_root.party.heroes.includes(Number(guid)) || hero['roster.status'] === 1) {
		return 'This hero is in the raid party. Return to town before dismissing them.';
	}
	if (data.game?.base_root.inraid) return 'Dismissal is unavailable during a raid.';
	if (!data.town || !data.upgrades || !data.game) {
		return 'Dismissal is blocked because reference data is missing. Reload the complete profile.';
	}
	// The real fixture uses a variable-length IntVector, with -1 as an empty
	// position. Removing a GUID is representable without inventing another hero.
	const lastParty = data.roster?.base_root.last_party?.last_party_guids;
	if (!Array.isArray(lastParty) || !lastParty.every((id) => Number.isInteger(id))) {
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
