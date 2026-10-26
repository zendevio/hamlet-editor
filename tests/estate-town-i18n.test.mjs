import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Explicitly incomplete target catalogs preserve the English wording/fallback
// oracles independently of how many production translations P3 ships. Editor
// locale still controls numbers, collation and lists; mounted E2E tests use the
// complete production catalogs.
const fallbackCatalogFixture = {
	name: 'partial-catalog-fallback-fixture', enforce: 'pre',
	load(id) {
		if (id === fileURLToPath(new URL('../src/lib/i18n/catalogs.ts', import.meta.url))) {
			return `import en from ${JSON.stringify(fileURLToPath(new URL('../src/lib/i18n/catalogs/en.json', import.meta.url)))};
				export const runtimeCatalogs = { en, de: {}, ru: {}, ja: {} };`;
		}
	}
};

const server = await createServer({
	configFile: false, cacheDir: 'node_modules/.vite/estate-town-i18n-tests',
	plugins: [fallbackCatalogFixture, svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const load = (name) => server.ssrLoadModule(`/src/lib/${name}.ts`);
const labels = await load('save-labels');
const constants = await load('data/constants');
const store = await load('stores/save-data.svelte');
const game = await load('stores/game-data.svelte');
const { setEditorLocale, describeMessage, t, tWithLocaleParams } = await load('i18n/index.svelte');
const { formatList, formatNumber, compareNames } = await load('i18n/intl');
const { createTranslator } = await load('i18n/core');
const en = JSON.parse(await readFile(new URL('../src/lib/i18n/catalogs/en.json', import.meta.url), 'utf8'));
beforeEach(() => { store.resetSaveData(); game.resetGameData(); setEditorLocale('en'); });

const tables = () => [
	[constants.BUILDING_DISPLAY_NAMES, labels.buildingDisplayName, (id) => `town_name_${id}`],
	[constants.ACTIVITY_DISPLAY_NAMES, labels.activityDisplayName, (id) => `town_activity_name_${id}`],
	[constants.DISTRICT_DISPLAY_NAMES, labels.districtName, (id) => `str_${id}_title`],
	[constants.CURRENCY_DISPLAY_NAMES, labels.currencyName, (id) => id === 'blueprint' ? 'tutorial_popup_blueprints_title' : `str_inventory_title_${['gold', 'shard'].includes(id) ? '' : 'heirloom'}${id}`],
	[constants.ESTATE_ITEM_DISPLAY_NAMES, labels.estateItemName, (id) => `str_inventory_title_${id.startsWith('crimson_court_invitation_') ? 'estate_currency' : 'estate'}${id}`],
	[constants.UPGRADE_TREE_DISPLAY_NAMES, labels.upgradeTreeName, (id) => `upgrade_tree_name_${id}`],
	[constants.DLC_DISPLAY_NAMES, labels.dlcName, (id) => `str_dlc_title_${id}`]
];

test('estate and town use every corrected fallback only when its verified game key is missing or blank', () => {
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		for (const [fallbacks, label, key] of tables()) {
			for (const [id, expected] of Object.entries(fallbacks)) {
				game.setNameTable({}, 'english');
				assert.equal(label(id), expected);
				game.setNameTable({ [key(id)]: '   ' }, 'russian');
				assert.equal(label(id), expected);
				game.setNameTable({ [key(id)]: `display:${id}` }, 'japanese');
				assert.equal(label(id), label === labels.currencyName && ['bust', 'portrait', 'deed', 'crest'].includes(id) ? expected : `display:${id}`);
				assert.equal(labels.gameTextLocale(), 'ja');
			}
		}
	}
	assert.equal(labels.buildingDisplayName('camping_trainer'), 'Survivalist');
	assert.equal(labels.activityDisplayName('prayer'), 'Transept');
	assert.equal(labels.districtName('buskers_corner'), 'Puppet Theatre');
	assert.equal(labels.districtName('theater'), 'Performance Hall');
	assert.equal(labels.districtName('spire_of_hope'), 'The Red Hook');
	assert.equal(labels.districtName('illuminators_guild'), "Cartographer's Camp");
	assert.equal(labels.currencyName('shard'), 'Comet Shards');
	assert.equal(labels.currencyName('memory'), 'Memory');
	for (const [id, caption] of [['bust', 'Busts'], ['portrait', 'Portraits'], ['deed', 'Deeds'], ['crest', 'Crests']]) {
		game.setNameTable({ [`str_inventory_title_heirloom${id}`]: 'singular item title' }, 'japanese');
		assert.equal(labels.currencyName(id), caption);
	}
	game.setNameTable({}, 'english');
	assert.equal(labels.currencyName('blueprint'), 'Blueprints');
	game.setNameTable({ tutorial_popup_blueprints_title: '設計図' }, 'japanese');
	assert.equal(labels.currencyName('blueprint'), '設計図');
	assert.equal(labels.upgradeTreeName('###stage_coach.rostersize'), 'Hero Barracks');
	for (const label of [labels.buildingDisplayName, labels.activityDisplayName, labels.districtName, labels.currencyName, labels.estateItemName, labels.dlcName, labels.trinketName]) {
		assert.equal(label('unknown_mod_id'), 'Unknown Mod Id');
	}
	assert.equal(labels.upgradeTreeName('###blacksmith.unknown_mod_id'), 'Unknown Mod Id');
});

test('cached town purchase groups, dirty estate data and descriptors retain ids while labels and game ordering change', () => {
	store.loadMockData();
	store.loadGame({ base_root: { estatename: 'User estate', inraid: false, game_mode: 'normal' } });
	store.setWalletAmount('gold', 1234567);
	store.setEstateItemAmount('crimson_court_invitation_A', 12);
	const before = JSON.stringify(store.getDirtyData());
	const groups = store.getBuildingUpgrades();
	const original = JSON.stringify(groups);
	assert.equal('displayName' in groups[0], false);
	const table = { town_name_abbey: 'Zulu', town_name_blacksmith: 'Alpha', str_inventory_title_gold: 'Gold A' };
	game.setNameTable(table, 'english');
	assert.ok(store.getBuildingUpgrades().findIndex((g) => g.buildingName === 'blacksmith') < store.getBuildingUpgrades().findIndex((g) => g.buildingName === 'abbey'));
	const descriptor = store.setEstateName('bad\u0000name');
	assert.equal(typeof descriptor, 'object');
	assert.equal(descriptor.id, 'input.control');
	const savedDescriptor = JSON.stringify(descriptor);
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		game.setNameTable({ town_name_abbey: 'Alpha', town_name_blacksmith: 'Zulu', str_inventory_title_gold: '金' }, 'japanese');
		assert.ok(store.getBuildingUpgrades().findIndex((g) => g.buildingName === 'abbey') < store.getBuildingUpgrades().findIndex((g) => g.buildingName === 'blacksmith'));
		assert.equal(labels.buildingDisplayName(groups.find((g) => g.buildingName === 'abbey').buildingName), 'Alpha');
		assert.equal(labels.currencyName('gold'), '金');
		assert.ok(describeMessage(descriptor).trim());
		assert.equal(JSON.stringify(store.getDirtyData()), before);
		assert.equal(JSON.stringify(groups), original);
		assert.equal(JSON.stringify(descriptor), savedDescriptor);
	}
	game.setNameTable({ town_name_abbey: 'Same', town_name_blacksmith: 'Same' }, 'russian');
	assert.equal(labels.compareBuildingNames({ buildingName: 'abbey' }, { buildingName: 'blacksmith' }), -1);
	assert.equal(compareNames('Same', 'bank', 'Same', 'granary', labels.gameTextLocale()), -1);
});

test('estate and town count messages and cascade singular/plural stay whole in en and ru fallback', () => {
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		for (const count of [0, 1, 2, 5, 11, 21, 1000]) {
			const countText = formatNumber(count);
			assert.equal(t('estate.equipped', { count, countText }), `${countText} equipped`);
			assert.equal(t('town.inTreatment', { count, countText }), `${countText} in treatment`);
			assert.equal(t('town.treatmentCount', { count, countText }), `${countText} heroes in treatment`);
			assert.equal(t('town.cascade', { count, tiers: 'b', requiredTier: 'a' }), `Also turned off ${count === 1 ? 'tier' : 'tiers'} b, which need tier a.`);
		}
		const descriptor = { id: 'town.upgradeProgress', params: { purchasedText: 1000, totalText: 2000 } };
		assert.equal(describeMessage(descriptor), `Upgrades: ${formatNumber(1000)}/${formatNumber(2000)}`);
		assert.equal(t('town.unknownUpgrade', { tree: '-123456789', instance: '1000', tier: 'opaque', purchased: 'yes' }), `-123456789 · Hero / instance 1000 · Tier opaque · Purchased`);
		assert.match(t('town.unknownUpgrade', { tree: 'raw', instance: '0', tier: 'a', purchased: 'no' }), /Not purchased$/);
	}
});

test('Russian one/few/many cascade contracts work in an independent fixture', () => {
	// Independent plural-rule fixture, separate from the complete shipped catalog.
	const translator = createTranslator({ en, ru: {
		'town.cascade': 'Отключены {count, plural, one {уровень} few {уровня} many {уровней} other {уровня}} {tiers}, нужен уровень {requiredTier}.'
	} });
	for (const [count, form] of [[1, 'уровень'], [2, 'уровня'], [5, 'уровней'], [11, 'уровней'], [21, 'уровень']]) {
		assert.equal(translator.text('ru', 'town.cascade', { count, tiers: 'b', requiredTier: 'a' }), `Отключены ${form} b, нужен уровень a.`);
	}
});

test('cascade lists follow the resolved catalog locale while numeric amounts follow the editor', () => {
	game.setNameTable({ town_name_abbey: 'ゲーム' }, 'japanese');
	for (const locale of ['en', 'ru', 'ja']) {
		setEditorLocale(locale);
		for (const tiers of [[], ['b'], ['b', 'c'], ['b', 'c', 'd']]) {
			assert.equal(formatList(tiers), new Intl.ListFormat(locale).format(tiers));
			assert.equal(tWithLocaleParams('town.cascade', (candidate) => ({ count: tiers.length, tiers: formatList(tiers, {}, candidate), requiredTier: 'a' })), `Also turned off ${tiers.length === 1 ? 'tier' : 'tiers'} ${new Intl.ListFormat('en').format(tiers)}, which need tier a.`);
		}
		assert.equal(formatNumber(1234567), new Intl.NumberFormat(locale).format(1234567));
		assert.equal(labels.buildingDisplayName('abbey'), 'ゲーム');
		assert.equal(labels.gameTextLocale(), 'ja');
	}
});


test('locale-sensitive slots use a translation locale and retry English for missing, blank and broken translations', () => {
	const translated = 'Ausgeschaltet: {tiers}.';
	for (const source of [translated, undefined, '', '{broken', '{missing}']) {
		const translator = createTranslator({ en, de: { 'town.cascade': source } });
		const candidates = [];
		const actual = translator.text('de', 'town.cascade', (candidate) => {
			candidates.push(candidate);
			return { count: 2, tiers: formatList(['b', 'c'], {}, candidate), requiredTier: 'a' };
		});
		assert.equal(actual, source === translated ? 'Ausgeschaltet: b und c.' : 'Also turned off tiers b and c, which need tier a.');
		assert.equal(candidates.at(-1), source === translated ? 'de' : 'en');
	}
});

test('list formatting safely falls back for absent, throwing constructors and throwing formatters', () => {
	const original = Object.getOwnPropertyDescriptor(Intl, 'ListFormat');
	try {
		for (const value of [undefined, class { constructor() { throw new Error('unsupported'); } }, class { format() { throw new Error('unsupported format'); } }]) {
			Object.defineProperty(Intl, 'ListFormat', { ...original, value });
			// Fresh locale/options avoid a cached working formatter.
			assert.equal(formatList(['b', 'c'].values(), { type: 'disjunction', style: 'narrow' }, 'cs'), 'b, c');
			assert.equal(formatList([], { type: 'disjunction', style: 'narrow' }, 'cs'), '');
			assert.equal(formatList(['b'], { type: 'disjunction', style: 'narrow' }, 'cs'), 'b');
		}
	} finally {
		Object.defineProperty(Intl, 'ListFormat', original);
	}
});
