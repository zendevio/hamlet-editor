import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const server = await createServer({
	configFile: false, cacheDir: 'node_modules/.vite/death-abandon-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const store = await server.ssrLoadModule('/src/lib/stores/save-data.svelte.ts');
const gameData = await server.ssrLoadModule('/src/lib/stores/game-data.svelte.ts');
const safety = await server.ssrLoadModule('/src/lib/hero-safety.ts');
const raid = await server.ssrLoadModule('/src/lib/raid.ts');
const trinkets = await server.ssrLoadModule('/src/lib/trinkets.ts');
const rules = JSON.parse(await readFile(new URL('./fixtures/roster-capacity-rules.json', import.meta.url)));
const snapshots = await Promise.all([3, 4].map(async (n) => JSON.parse(await readFile(new URL(`./fixtures/run7-snap-${n}.json`, import.meta.url)))));
const dismiss = JSON.parse(await readFile(new URL('./fixtures/dismiss-reference.json', import.meta.url)));
function load(n) {
	store.resetSaveData();
	gameData.setRosterCapacityRules(structuredClone(rules));
	for (const [name, value] of Object.entries(structuredClone(snapshots[n - 3]))) {
		store[`load${name[0].toUpperCase()}${name.slice(1)}`](value);
	}
	store.setGameInRaid(store.getSaveData().game.base_root.inraid);
	return store.getSaveData();
}
const snapshot = (data) => structuredClone(Object.fromEntries(['roster', 'game', 'raid', 'estate', 'upgrades', 'campaignLog', 'progression', 'town'].map((key) => [key, data[key]])));
function assertCombatCleared(hero) {
	assert.deepEqual(hero.actor.buff_group, {});
	for (const key of ['performing_turn', 'check_round_ranks', 'rounds_in_ranks']) assert.equal(hero.actor[key], 0);
	assert.equal(hero.actor.combat_ready, false);
}

test('Town Bonel revival resets only roster town fields and Discard restores the death', () => {
	const data = load(4);
	store.loadCampaignLog(structuredClone(dismiss.campaignLog));
	store.loadProgression(structuredClone(dismiss.progression));
	const before = snapshot(data);
	const dead = structuredClone(store.getHeroRawData('58'));
	assert.equal(safety.livingHeroCount(data.roster), 28);
	assert.equal(safety.rosterCapacity(data.game, data.upgrades, rules), 29);
	assert.equal(store.getRevivalBlockReason(), null);
	assert.equal(store.reviveHeroes(['58']), null);
	const hero = store.getHeroRawData('58');
	const expected = structuredClone(dead);
	expected['roster.status'] = 0;
	expected['roster.before_on_start_town_visit_status'] = 0;
	expected.actor.current_hp = store.getMaxHp(dead.heroClass, dead.armour_rank);
	Object.assign(expected.actor, { buff_group: {}, performing_turn: 0, combat_ready: false, check_round_ranks: 0, rounds_in_ranks: 0 });
	expected.visited_deaths_door = false;
	assert.deepEqual(hero, expected);
	assert.ok(hero.actor.current_hp > 0);
	assertCombatCleared(hero);
	assert.deepEqual(Object.keys(store.getDirtyData()), ['persist.roster.json']);
	for (const key of ['upgrades', 'game', 'campaignLog', 'progression']) assert.deepEqual(data[key], before[key]);
	store.discardAllChanges();
	assert.deepEqual(snapshot(data), before);
	assert.equal(store.hasDirtyFiles(), false);
});

test('In-raid revival, capacity exhaustion and unknown capacity fail atomically', () => {
	for (const mode of ['raid', 'full', 'unknown']) {
		const data = load(mode === 'raid' ? 3 : 4);
		if (mode === 'full') data.roster.base_root.heroes['999'] = structuredClone(data.roster.base_root.heroes['96']);
		if (mode === 'unknown') gameData.setRosterCapacityRules(null);
		const before = snapshot(data);
		assert.match(store.reviveHeroes(['58']), mode === 'raid' ? /during a raid/ : mode === 'full' ? /free roster slot/ : /capacity is unknown/);
		assert.deepEqual(snapshot(data), before);
		assert.equal(store.hasDirtyFiles(), false);
	}
});

test('batch revival validates every hero and enough slots before writing; generic death transitions stay refused', () => {
	const data = load(4);
	assert.ok(store.reviveHeroes(['58', 'missing']));
	assert.equal(store.getHeroRawData('58')['roster.status'], 3);
	assert.ok(store.reviveHeroes(['96']));
	store.setHeroStatus('58', 0);
	store.setHeroStatus('96', 3);
	assert.equal(store.getHeroRawData('58')['roster.status'], 3);
	assert.equal(store.getHeroRawData('96')['roster.status'], 1);
	assert.equal(store.hasDirtyFiles(), false);
	store.getHeroRawData('96')['roster.status'] = 3;
	assert.equal(store.reviveHeroes(['58', '96']), null);
	assert.equal(safety.livingHeroCount(data.roster), 29);
	assert.deepEqual(Object.keys(store.getDirtyData()), ['persist.roster.json']);
});

test('capacity follows current Stage Coach purchases, mode and enabled Shieldbreaker bonus', () => {
	const data = load(4);
	assert.equal(safety.rosterCapacity(data.game, data.upgrades, rules), 29);
	assert.equal(safety.rosterCapacity(data.game, data.upgrades, { ...rules, shieldbreaker_bonus: null }), null);
	data.game.base_root.game_mode = 'radiant';
	assert.equal(safety.rosterCapacity(data.game, data.upgrades, rules), 31);
	data.game.base_root.dlc = {};
	assert.equal(safety.rosterCapacity(data.game, data.upgrades, rules), 30);
	assert.equal(safety.rosterCapacity(data.game, data.upgrades, { ...rules, shieldbreaker_bonus: null }), 30);
	const purchase = Object.values(data.upgrades.base_root.purchases).find((p) => p.tree_id === '###stage_coach.rostersize' && p.requirement_code === 'e');
	purchase.is_purchased = false;
	assert.equal(safety.rosterCapacity(data.game, data.upgrades, rules), 25);
	purchase.requirement_code = 'unknown'; purchase.is_purchased = true;
	assert.equal(safety.rosterCapacity(data.game, data.upgrades, rules), null);
	data.game.base_root.game_mode = 'modded';
	assert.equal(safety.rosterCapacity(data.game, data.upgrades, rules), null);
});

test('Captured Courtyard abandon matches minimal town return, retains raid_save and raid data, and Discard restores', () => {
	const data = load(3);
	store.loadTown(structuredClone(dismiss.town));
	store.loadCampaignLog(structuredClone(dismiss.campaignLog));
	store.loadProgression(structuredClone(dismiss.progression));
	const before = snapshot(data);
	assert.equal(store.abandonRaid(), null);
	const expected = structuredClone(before);
	expected.game.base_root.inraid = false;
	expected.game.base_root.raiddungeon = 'none';
	const survivor = expected.roster.base_root.heroes['96'].hero_file_data.raw_data.base_root;
	survivor['roster.status'] = 0;
	survivor['roster.before_on_start_town_visit_status'] = 1;
	Object.assign(survivor.actor, { buff_group: {}, performing_turn: 0, combat_ready: false, check_round_ranks: 0, rounds_in_ranks: 0 });
	expected.roster.base_root.heroes['58'].hero_file_data.raw_data.base_root['roster.before_on_start_town_visit_status'] = 3;
	expected.roster.base_root.last_party.last_party_guids = [-1, -1, 96, -1];
	assert.deepEqual(snapshot(data), expected);
	assert.deepEqual(Object.keys(store.getDirtyData()).sort(), ['persist.game.json', 'persist.roster.json']);
	assert.equal(data.game.base_root.raid_save, 'plot_crimson_court_2/');
	assert.equal(data.gameInRaid, false);
	assertCombatCleared(store.getHeroRawData('96'));
	assert.equal(store.getHeroRawData('58')['roster.status'], 3);
	store.discardAllChanges();
	assert.deepEqual(snapshot(data), before);
	assert.equal(data.gameInRaid, true);
	assert.equal(store.hasDirtyFiles(), false);
});

test('regular raids also abandon and keep their empty raid path', () => {
	const data = load(3);
	data.game.base_root.raid_save = '';
	data.game.base_root.raiddungeon = 'ruins';
	data.raid.base_root.raid_instance.is_plot_quest = false;
	assert.equal(store.abandonRaid(), null);
	assert.equal(data.game.base_root.raid_save, '');
	assert.equal(data.game.base_root.inraid, false);
	assert.ok(data.raid);
});

test('abandon returns inventory trinkets once, reports loss counts and Discard restores both inventories', () => {
	const data = load(3);
	data.raid.base_root.party.inventory.items['7'] = { id: 'focus_ring', type: 'trinket', amount: 2, added_buffs: 3, hero_name: 'Bonel', previous_trinket_id: 'old', did_transform: true, trinkets_gained_count: 2 };
	data.raid.base_root.loot.owned_items.items['0'] = { id: 'gold', type: 'gold', amount: 500 };
	store.loadRaid(structuredClone(data.raid));
	const before = snapshot(data);
	const counts = raid.abandonRaidInventory(data.raid);
	assert.equal(counts.returnedTrinkets, 2);
	assert.deepEqual(counts.lost, [{ id: 'medicinal_herbs', type: 'supply', amount: 1 }, { id: 'gold', type: 'gold', amount: 500 }]);
	assert.equal(store.abandonRaid(), null);
	const oldCount = trinkets.inventoryTrinkets(before.estate).find((item) => item.id === 'focus_ring')?.amount ?? 0;
	assert.equal(trinkets.inventoryTrinkets(data.estate).find((item) => item.id === 'focus_ring').amount, oldCount + 2);
	assert.equal(data.raid.base_root.party.inventory.items['7'], undefined);
	assert.deepEqual(Object.values(data.estate.base_root.trinkets.items).at(-1), before.raid.base_root.party.inventory.items['7']);
	assert.deepEqual(Object.keys(store.getDirtyData()).sort(), ['persist.estate.json', 'persist.game.json', 'persist.raid.json', 'persist.roster.json']);
	assert.match(store.abandonRaid(), /no active raid/);
	store.discardAllChanges();
	assert.deepEqual(snapshot(data), before);
});

test('missing raid/roster references and unavailable trinket storage block abandon without writes', () => {
	for (const mode of ['raid', 'hero', 'lastParty', 'inventory', 'estate']) {
		const data = load(3);
		if (mode === 'raid') { store.resetSaveData(); store.loadGame(structuredClone(snapshots[0].game)); }
		if (mode === 'hero') delete data.roster.base_root.heroes['96'];
		if (mode === 'lastParty') data.roster.base_root.last_party.last_party_guids = [];
		if (mode === 'inventory') data.raid.base_root.party.inventory.items['0'].amount = NaN;
		if (mode === 'estate') {
			data.raid.base_root.party.inventory.items['7'] = { id: 'ring', type: 'trinket', amount: 1 };
			data.estate.base_root.trinkets.items = { unsupported: {} };
		}
		const before = snapshot(data);
		assert.ok(store.abandonRaid());
		assert.deepEqual(snapshot(data), before);
		assert.equal(store.hasDirtyFiles(), false);
	}
});

test('town status 1 and stale raid heroes can be dismissed; the dead grave and last living hero cannot', () => {
	let data = load(4);
	store.loadTown(structuredClone(dismiss.town));
	assert.equal(store.getHeroRawData('96')['roster.status'], 1);
	assert.equal(store.dismissHero('96'), null);
	data = load(4); store.loadTown(structuredClone(dismiss.town));
	store.loadRaid(structuredClone(snapshots[0].raid));
	assert.equal(store.dismissHero('96'), null);
	data = load(4); store.loadTown(structuredClone(dismiss.town));
	const before = snapshot(data);
	assert.match(store.dismissHero('58'), /Dead heroes cannot be dismissed/);
	assert.deepEqual(snapshot(data), before);
	data.roster.base_root.heroes = { 58: data.roster.base_root.heroes['58'], 96: data.roster.base_root.heroes['96'] };
	assert.match(store.dismissHero('96'), /at least 1 hero/);
	assert.equal(store.hasDirtyFiles(), false);
	data = load(3); store.loadTown(structuredClone(dismiss.town));
	assert.match(store.dismissHero('96'), /raid party/);
});

test('dead heroes cannot equip, replace or unequip trinkets through helpers or store', () => {
	const data = load(3);
	const dead = store.getHeroRawData('58');
	dead.trinkets.items = { 0: { id: 'old', type: 'trinket', amount: 1 } };
	for (const source of ['catalogue', 'inventory']) {
		for (const id of ['', 'focus_ring', 'old']) {
			const before = snapshot(data);
			assert.match(trinkets.equipTrinket(dead, data.estate, '0', id, source).error, /dead hero/);
			assert.match(store.setHeroTrinket('58', '0', id, source), /dead hero/);
			assert.deepEqual(snapshot(data), before);
		}
	}
	assert.equal(store.hasDirtyFiles(), false);
	assert.equal(store.STATUS_MAP[1].label, 'In party');
	assert.equal(store.STATUS_MAP[4].label, 'Missing');
});


test('revival uses the installed class maximum shared with the HP slider', () => {
	load(4);
	gameData.setClassStats([{ class_id: 'flagellant', hp_by_rank: [22, 26.5, 30, 34, 38] }]);
	assert.equal(store.reviveHeroes(['58']), null);
	assert.equal(store.getHeroRawData('58').actor.current_hp, 26.5);
	gameData.setClassStats([]);
});

test('enabled campaign mods block capacity and revival without any mutation', () => {
	const data = load(4);
	data.game.base_root.persistent_ugcs = { 12345: { name: 'Custom Stage Coach' } };
	assert.equal(safety.rosterCapacity(data.game, data.upgrades, rules), null);
	const before = snapshot(data);
	assert.match(store.getRevivalBlockReason(), /mods/);
	assert.match(store.reviveHeroes(['58']), /mods/);
	assert.deepEqual(snapshot(data), before);
	assert.equal(store.hasDirtyFiles(), false);
});

test('unknown class maximum HP blocks the entire revival batch', () => {
	const data = load(4);
	const hero = store.getHeroRawData('96');
	hero['roster.status'] = 3;
	hero.heroClass = 'unknown_mod_class';
	gameData.setClassStats([]);
	const before = snapshot(data);
	assert.match(store.reviveHeroes(['58', '96']), /class maximum HP unknown/);
	assert.deepEqual(snapshot(data), before);
	assert.equal(store.hasDirtyFiles(), false);
});

test('dismissal preserves equipped trinket metadata', () => {
	const data = load(4);
	store.loadEstate(structuredClone(snapshots[0].estate));
	store.loadTown(structuredClone(dismiss.town));
	const item = { id: 'focus_ring', type: 'trinket', amount: 1, added_buffs: 3, hero_name: 'Brereton', previous_trinket_id: 'old', did_transform: true, trinkets_gained_count: 2 };
	store.getHeroRawData('96').trinkets.items = { 0: structuredClone(item) };
	assert.equal(store.dismissHero('96'), null);
	assert.deepEqual(Object.values(data.estate.base_root.trinkets.items).at(-1), item);
});

test('lost item labels localize supplies and empty-id gold, with readable fallback', () => {
	gameData.setNameTable({ str_inventory_title_gold: 'Gold', str_inventory_title_supplymedicinal_herbs: 'Medicinal Herbs' });
	assert.equal(raid.raidItemLabel({ id: '', type: 'gold', amount: 1250 }), 'Gold');
	assert.equal(raid.raidItemLabel({ id: 'medicinal_herbs', type: 'supply', amount: 1 }), 'Medicinal Herbs');
	assert.equal(raid.raidItemLabel({ id: 'unknown_item', type: 'supply', amount: 1 }), 'Unknown Item');
	assert.equal(raid.raidItemLabel({ id: '', type: 'provision', amount: 1 }), 'Provision');
});
