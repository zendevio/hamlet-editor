import { parseInteger, validTorchlight } from '#lib/input-validation.js';
import type { GameData, RaidData, RosterData, TownData } from '#lib/types/save-data.js';
import { readTreatmentSlots, clearTreatmentSlot } from '#lib/treatment.js';

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

/** Return living party members to town without reviving dead members. */
export function abandonRaidData(game: GameData, raid: RaidData, roster: RosterData, town: TownData): Set<string> {
	const changed = new Set<string>();
	const party = new Set(raid.base_root.party.heroes);
	for (const treatment of readTreatmentSlots(town)) {
		if (treatment.slot.hero !== 0 && party.has(treatment.slot.hero)) {
			clearTreatmentSlot(treatment);
			changed.add('persist.town.json');
		}
	}
	for (const guid of party) {
		const hero = roster.base_root.heroes[String(guid)]?.hero_file_data.raw_data.base_root;
		if (!hero || hero['roster.status'] === 3) continue;
		if (hero['roster.status'] !== 0 || hero['roster.before_on_start_town_visit_status'] !== 0 || hero['roster.building_name'] !== '') {
			hero['roster.status'] = 0;
			hero['roster.before_on_start_town_visit_status'] = 0;
			hero['roster.building_name'] = '';
			changed.add('persist.roster.json');
		}
	}
	if (game.base_root.inraid || game.base_root.raid_save !== '' || game.base_root.raiddungeon !== 'none') {
		game.base_root.inraid = false;
		game.base_root.raid_save = '';
		game.base_root.raiddungeon = 'none';
		changed.add('persist.game.json');
	}
	return changed;
}
