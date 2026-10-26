import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const server = await createServer({
	configFile: false, cacheDir: 'node_modules/.vite/raid-setup-i18n-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const load = (name) => server.ssrLoadModule(`/src/lib/${name}.ts`);
const raid = await load('raid');
const labels = await load('save-labels');
const constants = await load('data/constants');
const game = await load('stores/game-data.svelte');
const store = await load('stores/save-data.svelte');
const { setEditorLocale, t, describeMessage, richMessage } = await load('i18n/index.svelte');
const { formatList, formatNumber } = await load('i18n/intl');
const { createTranslator } = await load('i18n/core');
const { stripDsonPrefix } = await load('utils');
const en = JSON.parse(await readFile(new URL('../src/lib/i18n/catalogs/en.json', import.meta.url), 'utf8'));
const fixture = JSON.parse(await readFile(new URL('./fixtures/run7-snap-3.json', import.meta.url), 'utf8'));
beforeEach(() => { store.resetSaveData(); game.resetGameData(); setEditorLocale('en'); });

test('raid difficulty language follows the table, English fallback or editor unknown message', () => {
	setEditorLocale('de');
	game.setNameTable({}, 'japanese');
	assert.equal(labels.raidDifficultyLang(2), 'de');
	assert.equal(labels.raidDifficultyLang(1), 'en');
	game.setNameTable({ town_quest_difficulty_2: '日本語' }, 'japanese');
	assert.equal(labels.raidDifficultyLang(2), 'ja');
	game.setNameTable({ town_quest_difficulty_2: ' ' }, 'japanese');
	assert.equal(labels.raidDifficultyLang(2), 'de');
});

test('dungeon and length language tags follow table, aliases, blank and English fallbacks', () => {
	setEditorLocale('de');
	game.setNameTable({}, 'japanese');
	for (const id of ['crypts', 'ruins', 'farmstead', 'unknown_mod_dungeon']) assert.equal(labels.dungeonNameLang(id), 'en');
	for (const length of [1, 2, 9]) assert.equal(labels.raidLengthLang(length), 'en');
	game.setNameTable({ dungeon_name_crypts: '遺跡', dungeon_name_farm: '農場', town_quest_length_2: '中' }, 'japanese');
	for (const id of ['crypts', 'ruins', 'farmstead']) assert.equal(labels.dungeonNameLang(id), 'ja');
	assert.equal(labels.raidLengthLang(2), 'ja');
	game.setNameTable({ dungeon_name_crypts: ' ', town_quest_length_2: ' ' }, 'japanese');
	assert.equal(labels.dungeonNameLang('ruins'), 'en');
	assert.equal(labels.raidLengthLang(2), 'en');
});

const block = (d) => raid.abandonRaidBlockReason(d.game, d.raid, d.roster, d.estate);
test('all raid refusals are retained complete-message descriptors and never mutate payloads', () => {
	const ids = new Set();
	for (const [id, change] of [
		['loaded', (d) => d.raid = null],
		['inactive', (d) => d.game.base_root.inraid = false],
		['party', (d) => d.roster.base_root.last_party.last_party_guids = []],
		['hero', (d) => delete d.roster.base_root.heroes['96'].hero_file_data.raw_data.base_root.actor],
		['inventory', (d) => d.raid.base_root.party.inventory.items['0'].amount = -1],
		['estate', (d) => { d.raid.base_root.party.inventory.items['7'] = { id: 'focus_ring', type: 'trinket', amount: 1 }; d.estate = null; }]
	]) {
		const data = structuredClone(fixture); change(data);
		const before = JSON.stringify(data);
		const descriptor = block(data);
		assert.deepEqual(descriptor, { id: `raid.block.${id}` });
		ids.add(descriptor.id);
		for (const locale of ['en', 'ru', 'de']) {
			setEditorLocale(locale);
			assert.equal(describeMessage(descriptor), en[descriptor.id]);
			assert.deepEqual(descriptor, { id: `raid.block.${id}` });
			assert.deepEqual([...raid.abandonRaidData(data.game, data.raid, data.roster, data.estate)], []);
			assert.equal(JSON.stringify(data), before);
		}
	}
	assert.equal(block(structuredClone(fixture)), null);
	assert.deepEqual([...ids].sort(), Object.keys(en).filter((key) => key.startsWith('raid.block.')).sort());
});

test('raid names use complete verified game labels with corrected fallbacks and readable unknown ids', () => {
	for (const [fallbacks, label, key] of [
		[constants.RAID_DIFFICULTY_NAMES, labels.raidDifficultyName, (id) => `town_quest_difficulty_${id}`],
		[constants.RAID_LENGTH_NAMES, labels.raidLengthName, (id) => `town_quest_length_${id}`],
		[constants.DUNGEON_DISPLAY_NAMES, labels.dungeonName, (id) => `dungeon_name_${id}`]
	]) {
		for (const [id, expected] of Object.entries(fallbacks)) {
			const input = label === labels.dungeonName ? id : Number(id);
			game.setNameTable({}, 'english'); assert.equal(label(input), expected);
			game.setNameTable({ [key(id)]: ' ' }, 'russian'); assert.equal(label(input), expected);
			game.setNameTable({ [key(id)]: `game:${id}` }, 'german'); assert.equal(label(input), `game:${id}`);
		}
	}
	game.resetGameData();
	assert.equal(labels.raidDifficultyName(1), 'Apprentice (Lvl 1)');
	assert.equal(labels.raidDifficultyName(2), 'Unknown (2)');
	assert.equal(labels.raidLengthName(9), '9');
	assert.equal(labels.dungeonName('unknown_mod_dungeon'), 'Unknown Mod Dungeon');
	game.setNameTable({ dungeon_name_crypts: 'crypts name', dungeon_name_farm: 'farm name' }, 'japanese');
	assert.equal(labels.dungeonName('ruins'), 'crypts name');
	assert.equal(labels.dungeonName('farmstead'), 'farm name');
});

test('raid item labels never expose the localization namespace and dirty data survives both locale changes', () => {
	for (const [key, value] of Object.entries(structuredClone(fixture))) store[`load${key[0].toUpperCase()}${key.slice(1)}`](value);
	store.setGameInRaid(true);
	store.setRaidHungerBuffer(1234);
	const before = JSON.stringify(store.getDirtyData());
	const item = { id: 'unknown_mod_item', type: 'supply', amount: 2 };
	for (const locale of ['en', 'ru', 'de']) {
		setEditorLocale(locale);
		game.setNameTable({ str_inventory_title_supplyunknown_mod_item: '   ' }, 'japanese');
		assert.equal(raid.raidItemLabel(item), 'Unknown Mod Item');
		game.setNameTable({ str_inventory_title_supplyunknown_mod_item: '<literal item>' }, 'german');
		assert.equal(raid.raidItemLabel(item), '<literal item>');
		assert.equal(raid.raidItemLabel({ id: '', type: 'gold', amount: 1 }), 'Gold');
		assert.equal(JSON.stringify(store.getDirtyData()), before);
	}
});

test('raid item and trinket counts retain exact English wording in en and ru fallback', () => {
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		for (const count of [0, 1, 2, 5, 11, 21, 22, 1000]) {
			const countText = formatNumber(count);
			assert.equal(t('raid.itemCount', { count, countText }), `${countText} item${count === 1 ? '' : 's'}`);
			assert.equal(t('raid.returnedTrinkets', { count, countText }), `${countText} party inventory trinket(s) will return to estate storage. Other supplies and loot will be lost:`);
		}
	}
});

test('test-only Russian translations exercise one/few/many for both raid counts', () => {
	const translator = createTranslator({ en, ru: {
		'raid.itemCount': '{count, plural, one {{countText} предмет} few {{countText} предмета} many {{countText} предметов} other {{countText} предмета}}',
		'raid.returnedTrinkets': '{count, plural, one {{countText} аксессуар вернётся.} few {{countText} аксессуара вернутся.} many {{countText} аксессуаров вернутся.} other {{countText} аксессуара вернутся.}}'
	} });
	for (const [count, item, trinket] of [[0, 'предметов', 'аксессуаров вернутся.'], [1, 'предмет', 'аксессуар вернётся.'], [2, 'предмета', 'аксессуара вернутся.'], [5, 'предметов', 'аксессуаров вернутся.'], [11, 'предметов', 'аксессуаров вернутся.'], [21, 'предмет', 'аксессуар вернётся.'], [22, 'предмета', 'аксессуара вернутся.']]) {
		const params = { count, countText: String(count) };
		assert.equal(translator.text('ru', 'raid.itemCount', params), `${count} ${item}`);
		assert.equal(translator.text('ru', 'raid.returnedTrinkets', params), `${count} ${trinket}`);
	}
});

test('raw goal ids use editor ListFormat independently of game text and preserve the source array', () => {
	const ids = ['###goal_a', '###goal_b', 'mod_goal'];
	game.setNameTable({ dungeon_name_crypts: 'ゲーム' }, 'japanese');
	for (const locale of ['en', 'ru', 'de']) {
		setEditorLocale(locale);
		for (const values of [[], ids.slice(0, 1), ids.slice(0, 2), ids]) {
			assert.equal(formatList(values.map(stripDsonPrefix)), new Intl.ListFormat(locale).format(values.map(stripDsonPrefix)));
		}
	}
	assert.deepEqual(ids, ['###goal_a', '###goal_b', 'mod_goal']);
});

test('setup DLC and source fallbacks render fully without any game data in en and de, then follow available game keys', () => {
	for (const locale of ['en', 'de']) {
		setEditorLocale(locale); game.resetGameData();
		for (const [id, expected] of Object.entries(constants.DLC_DISPLAY_NAMES)) {
			const fallback = () => t('setup.dlcName', { dlc: id });
			assert.equal(labels.dlcName(id, fallback()), expected);
			assert.equal(labels.dlcNameLang(id), locale);
			game.setNameTable({ [`str_dlc_title_${id}`]: ' ' }, 'japanese');
			assert.equal(labels.dlcName(id, fallback()), expected);
			assert.equal(labels.dlcNameLang(id), locale);
			game.setNameTable({ [`str_dlc_title_${id}`]: `game:${id}` }, 'japanese');
			assert.equal(labels.dlcName(id, fallback()), `game:${id}`);
			assert.equal(labels.dlcNameLang(id), 'ja');
			game.resetGameData();
		}
		for (const id of Object.keys(en).filter((key) => key.startsWith('setup.') && !['setup.source', 'setup.dlcName'].includes(key))) assert.equal(t(id), en[id]);
		for (const [source, expected] of [['Steam', 'Steam'], ['Gog', 'GOG'], ['Epic', 'Epic'], ['Manual', 'Manual'], ['unknown', 'Manual']]) assert.equal(t('setup.source', { source }), expected);
	}
});

test('inconsistent-raid warning keeps the code content in one approved rich slot', () => {
	for (const locale of ['en', 'de', 'ru']) {
		setEditorLocale(locale);
		const parts = richMessage('raid.inconsistent', {});
		assert.deepEqual(parts.filter((part) => typeof part !== 'string'), [{ tag: 'code', children: ['inraid: true'] }]);
		assert.equal(describeMessage({ id: 'raid.inconsistent' }), 'persist.game.json reports inraid: true but persist.raid.json was not found. Backup recommended before editing.');
	}
});
