import { localize } from '#lib/stores/game-data.svelte.js';
import { snakeToTitle } from '#lib/utils.js';
import { parseInteger, validTorchlight } from '#lib/input-validation.js';
import type { EstateData, GameData, InventoryItem, RaidData, RosterData } from '#lib/types/save-data.js';
import { clearHeroCombatState } from '#lib/hero-safety.js';
import { returnTrinkets, storageItems } from '#lib/trinkets.js';
import type { MessageDescriptor } from '#lib/i18n/index.svelte.js';

export function updateTorchlight(raid: RaidData, value: unknown): boolean {
	if (!validTorchlight(value) || raid.base_root.torchlight === value) return false;
	raid.base_root.torchlight = value;
	return true;
}

export function updateHungerBuffer(raid: RaidData, input: unknown): boolean {
	const parsed = parseInteger(input);
	if (parsed.error !== undefined || raid.base_root.party.hunger_room_buffer === parsed.value) return false;
	raid.base_root.party.hunger_room_buffer = parsed.value;
	return true;
}

export function updateRaidAmount(raid: RaidData, key: string, input: unknown): boolean {
	const parsed = parseInteger(input);
	const item = raid.base_root.party.inventory.items[key];
	if (parsed.error !== undefined || !item || item.amount === parsed.value) return false;
	item.amount = parsed.value;
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Validate every reference and inventory transfer before changing any file. */
export function abandonRaidBlockReason(game: GameData | null, raid: RaidData | null, roster: RosterData | null, estate: EstateData | null): MessageDescriptor | null {
	if (!game || !raid || !roster) return { id: 'raid.block.loaded' };
	if (!game.base_root.inraid) return { id: 'raid.block.inactive' };
	const party = raid.base_root?.party;
	const heroes = roster.base_root?.heroes;
	const lastParty = roster.base_root?.last_party?.last_party_guids;
	if (!Array.isArray(party?.heroes) || party.heroes.length > 4 || !isRecord(heroes)
		|| !party.heroes.every((guid) => Number.isInteger(guid) && heroes[String(guid)])
		|| !Array.isArray(lastParty) || lastParty.length !== 4 || !lastParty.every(Number.isInteger)
		|| !isRecord(party.inventory?.items)) return { id: 'raid.block.party' };
	for (const guid of new Set([...party.heroes, ...lastParty.filter((guid) => guid !== -1)])) {
		const hero = heroes[String(guid)]?.hero_file_data?.raw_data?.base_root;
		if (!hero || !isRecord(hero.actor) || !Number.isInteger(hero['roster.status'])) return { id: 'raid.block.hero' };
	}
	const items = Object.values(party.inventory.items);
	if (!items.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.type === 'string'
		&& Number.isInteger(item.amount) && item.amount >= 0 && item.amount <= 2147483647)) return { id: 'raid.block.inventory' };
	const trinkets = items.filter((item) => item.type === 'trinket');
	const storage = storageItems(estate);
	if (trinkets.length && (!storage || trinkets.some((item) => !item.id || item.amount < 1)
		|| Math.max(-1, ...Object.keys(storage).map(Number)) + trinkets.length >= 2147483647)) {
		return { id: 'raid.block.estate' };
	}
	return null;
}

/** Inventory trinkets return to the estate; all other supplies and loot are lost. */
export function abandonRaidInventory(raid: RaidData | null): { returnedTrinkets: number; lost: InventoryItem[] } {
	const lost = new Map<string, InventoryItem>();
	let returnedTrinkets = 0;
	function add(item: InventoryItem) {
		const key = `${item.type}:${item.id}`;
		const previous = lost.get(key);
		lost.set(key, { id: item.id, type: item.type, amount: (previous?.amount ?? 0) + item.amount });
	}
	for (const item of Object.values(raid?.base_root.party.inventory.items ?? {})) {
		if (item.type === 'trinket') returnedTrinkets += item.amount;
		else add(item);
	}
	function visit(value: unknown) {
		if (Array.isArray(value)) { value.forEach(visit); return; }
		if (!isRecord(value)) return;
		if (typeof value.id === 'string' && typeof value.type === 'string' && typeof value.amount === 'number') {
			add(value as unknown as InventoryItem);
		} else {
			for (const child of Object.values(value)) visit(child);
		}
	}
	visit(raid?.base_root.loot);
	return { returnedTrinkets, lost: [...lost.values()] };
}

/** Minimal town return, without the game's week tick or expedition results. */
export function abandonRaidData(game: GameData, raid: RaidData, roster: RosterData, estate: EstateData | null): Set<string> {
	const changed = new Set<string>();
	if (abandonRaidBlockReason(game, raid, roster, estate)) return changed;
	const party = new Set(raid.base_root.party.heroes);
	const lastParty = roster.base_root.last_party.last_party_guids;
	for (const guid of new Set([...party, ...lastParty])) {
		const hero = roster.base_root.heroes[String(guid)]?.hero_file_data.raw_data.base_root;
		if (!hero) continue;
		if (hero['roster.status'] === 3) hero['roster.before_on_start_town_visit_status'] = 3;
		else if (party.has(guid) && hero['roster.status'] === 1) {
			hero['roster.status'] = 0;
			hero['roster.before_on_start_town_visit_status'] = 1;
			clearHeroCombatState(hero);
		}
	}
	roster.base_root.last_party.last_party_guids = lastParty.map((guid) => party.has(guid)
		&& roster.base_root.heroes[String(guid)].hero_file_data.raw_data.base_root['roster.status'] !== 3 ? guid : -1);
	const trinkets = Object.entries(raid.base_root.party.inventory.items).filter(([, item]) => item.type === 'trinket');
	if (trinkets.length) {
		returnTrinkets(storageItems(estate)!, trinkets.map(([, item]) => item));
		for (const [key] of trinkets) delete raid.base_root.party.inventory.items[key];
		changed.add('persist.estate.json');
		changed.add('persist.raid.json');
	}
	game.base_root.inraid = false;
	game.base_root.raiddungeon = 'none';
	changed.add('persist.roster.json');
	changed.add('persist.game.json');
	return changed;
}

/** Inventory localization keys concatenate the type and optional ID. */
export function raidItemLabel(item: InventoryItem): string {
	const key = `str_inventory_title_${item.type}${item.id}`;
	return localize(key, snakeToTitle(item.id || item.type));
}
