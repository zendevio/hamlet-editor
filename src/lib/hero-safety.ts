import type { MessageDescriptor } from '#lib/i18n/messages.generated.js';
import { readTreatmentSlots } from '#lib/treatment.js';
import type { RosterCapacityRules } from '#lib/api/gamedata.js';
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
}

/** Validate equipment before transferring complete items on dismissal. */
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

export function dismissBlockReason(guid: string, data: HeroReferences): MessageDescriptor | null {
	const hero = data.roster?.base_root.heroes[guid]?.hero_file_data.raw_data.base_root;
	if (!hero) return { id: 'store.heroMissing' };
	if (hero['roster.status'] === 3) return { id: 'hero.safety.dismissDead' };
	if (livingHeroCount(data.roster!) <= 1) return { id: 'hero.safety.dismissLastHero' };
	if (hero['roster.status'] === 2 || hero['roster.building_name'] || readTreatmentSlots(data.town).some(({ slot }) => String(slot.hero) === guid)) {
		return { id: 'hero.safety.dismissTreatment' };
	}
	if (data.game?.base_root.inraid && (data.raid?.base_root.party.heroes.includes(Number(guid)) || hero['roster.status'] === 1)) {
		return { id: 'hero.safety.dismissParty' };
	}
	if (data.game?.base_root.inraid) return { id: 'hero.safety.dismissRaid' };
	if (!data.town || !data.upgrades || !data.game) {
		return { id: 'hero.safety.dismissReferences' };
	}
	const trinkets = equippedTrinkets(hero);
	const storage = data.estate?.base_root.trinkets?.items;
	if (!trinkets || (trinkets.length > 0 && (!storage || Array.isArray(storage)
		|| Object.keys(storage).some((key) => !/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(Number(key)))
		|| Object.keys(storage).some((key) => Number(key) >= 2147483647)))) {
		return { id: 'hero.safety.dismissTrinkets' };
	}
	// Keep the game's four party slots; -1 marks an empty position.
	const lastParty = data.roster?.base_root.last_party?.last_party_guids;
	if (!Array.isArray(lastParty) || lastParty.length !== 4 || !lastParty.every((id) => Number.isInteger(id))) {
		return { id: 'hero.safety.dismissPartyShape' };
	}
	return null;
}

export function livingHeroCount(roster: RosterData): number {
	return Object.values(roster.base_root.heroes).filter((entry) => entry.hero_file_data.raw_data.base_root['roster.status'] !== 3).length;
}

/** Resolve the installed Stage Coach rules against the current save purchases. */
export function rosterCapacity(game: GameData | null, upgrades: UpgradesData | null, rules: RosterCapacityRules | null): number | null {
	if (!game || !upgrades || !rules || Object.keys(game.base_root.persistent_ugcs ?? {}).length > 0) return null;
	const levels = rules.by_mode[game.base_root.game_mode];
	const dlc = game.base_root.dlc as Record<string, { name?: string; source?: string }> | undefined;
	if (!levels || !dlc || Object.values(dlc).some((entry) => entry.source !== 'dlc')) return null;
	const shieldbreaker = Object.values(dlc).some((entry) => entry.name === 'shieldbreaker');
	if (shieldbreaker && rules.shieldbreaker_bonus === null) return null;
	const purchases = Object.values(upgrades.base_root.purchases).filter((p) => p.instance_number === 0 && p.is_purchased && (p.tree_id === '###stage_coach.rostersize' || p.tree_id === 'stage_coach.rostersize'));
	if (purchases.some((p) => !levels.some((level) => level.upgrade_requirement_code === p.requirement_code))) return null;
	const amounts = levels.filter((level) => !level.upgrade_requirement_code || purchases.some((p) => p.requirement_code === level.upgrade_requirement_code)).map((level) => level.amount);
	const capacity = Math.max(...amounts) + (shieldbreaker ? rules.shieldbreaker_bonus! : 0);
	return Number.isInteger(capacity) && capacity > 0 ? capacity : null;
}

export function revivalBlockReason(game: GameData | null, roster: RosterData | null, capacity: number | null, count = 1): MessageDescriptor | null {
	if (game?.base_root.inraid) return { id: 'hero.safety.reviveRaid' };
	if (!game || !roster) return { id: 'hero.safety.reviveData' };
	if (Object.keys(game.base_root.persistent_ugcs ?? {}).length > 0) return { id: 'hero.safety.reviveMods' };
	if (capacity === null) return { id: 'hero.safety.reviveCapacity' };
	if (livingHeroCount(roster) + count > capacity) return { id: 'hero.safety.capacity', params: { count, countText: count, livingText: livingHeroCount(roster), capacityText: capacity } };
	return null;
}

export function clearHeroCombatState(hero: HeroBaseRoot): void {
	hero.actor.buff_group = {};
	hero.actor.performing_turn = 0;
	hero.actor.combat_ready = false;
	hero.actor.check_round_ranks = 0;
	hero.actor.rounds_in_ranks = 0;
}
