import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { IntlMessageFormat } from 'intl-messageformat';

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
	configFile: false, cacheDir: 'node_modules/.vite/heroes-i18n-tests',
	plugins: [fallbackCatalogFixture, svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const load = (name) => server.ssrLoadModule(`/src/lib/${name}.ts`);
const safety = await load('hero-safety');
const inputs = await load('input-validation');
const trinkets = await load('trinkets');
const validation = await load('validation');
const { describeValidationIssue } = await load('validation-messages');
const store = await load('stores/save-data.svelte');
const game = await load('stores/game-data.svelte');
const labels = await load('save-labels');
const { setEditorLocale, describeMessage, t } = await load('i18n/index.svelte');
const { compareNames, formatNumber } = await load('i18n/intl');
const { normalizeSearch, matchesSearch } = await load('search');
const { sortHeroes } = await load('hero-order');
const quirks = await load('data/quirks');
const en = JSON.parse(await readFile(new URL('../src/lib/i18n/catalogs/en.json', import.meta.url), 'utf8'));
const reference = JSON.parse(await readFile(new URL('./fixtures/safety-reference.json', import.meta.url), 'utf8'));
beforeEach(() => { store.resetSaveData(); game.resetGameData(); setEditorLocale('en'); });
const hero = () => ({ heroClass: 'crusader', 'roster.status': 0, 'roster.building_name': '', actor: { name: 'User name' }, quirks: {}, trinkets: { items: {} } });
const refs = () => ({
	roster: { base_root: { heroes: Object.fromEntries(['1', '2'].map((id) => [id, { hero_file_data: { raw_data: { base_root: hero() } } }])), last_party: { last_party_guids: [-1, -1, -1, -1] } } },
	town: { base_root: { buildings: {} } }, upgrades: { base_root: { purchases: {} } },
	game: { base_root: { inraid: false } }, raid: { base_root: { party: { heroes: [] } } }, estate: { base_root: { trinkets: { items: {} } } }
});
const raw = (data) => data.roster.base_root.heroes['1'].hero_file_data.raw_data.base_root;
function render(descriptor) {
	assert.equal(typeof descriptor, 'object');
	const original = JSON.stringify(descriptor);
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		const text = describeMessage(descriptor);
		const params = Object.fromEntries(Object.entries(descriptor.params ?? {}).map(([key, value]) =>
			[key, key.endsWith('Text') && typeof value === 'number' ? formatNumber(value) : value]));
		const plain = (chunks) => chunks.join('');
		const expected = new IntlMessageFormat(en[descriptor.id], 'en').format({ ...params, emphasis: plain, code: plain, link: plain });
		assert.equal(text, Array.isArray(expected) ? expected.join('') : expected);
		assert.doesNotMatch(text, /\[object Object\]/);
	}
	assert.equal(JSON.stringify(descriptor), original);
	return descriptor.id;
}

test('every dismissal and revival refusal returns a retained complete-message descriptor in en and ru fallback', () => {
	const ids = new Set();
	const cases = [
		['store.heroMissing', (d) => delete d.roster.base_root.heroes['1']],
		['hero.safety.dismissDead', (d) => raw(d)['roster.status'] = 3],
		['hero.safety.dismissLastHero', (d) => delete d.roster.base_root.heroes['2']],
		['hero.safety.dismissTreatment', (d) => raw(d)['roster.status'] = 2],
		['hero.safety.dismissTreatment', (d) => d.town.base_root.buildings.abbey = { activities: { prayer: { 0: { hero: 1 } } } }],
		['hero.safety.dismissParty', (d) => { d.game.base_root.inraid = true; d.raid.base_root.party.heroes = [1]; }],
		['hero.safety.dismissRaid', (d) => d.game.base_root.inraid = true],
		['hero.safety.dismissReferences', (d) => d.upgrades = null],
		['hero.safety.dismissTrinkets', (d) => raw(d).trinkets.items = []],
		['hero.safety.dismissPartyShape', (d) => d.roster.base_root.last_party.last_party_guids = []]
	];
	for (const [id, mutate] of cases) {
		const data = refs(); mutate(data);
		const before = JSON.stringify(data);
		const descriptor = safety.dismissBlockReason('1', data);
		assert.equal(render(descriptor), id); ids.add(id);
		assert.equal(JSON.stringify(data), before);
	}
	assert.equal(safety.dismissBlockReason('1', refs()), null);
	const data = refs();
	for (const [id, gameData, roster, capacity] of [
		['hero.safety.reviveRaid', { base_root: { inraid: true } }, data.roster, 4],
		['hero.safety.reviveData', null, data.roster, 4],
		['hero.safety.reviveData', data.game, null, 4],
		['hero.safety.reviveMods', { base_root: { persistent_ugcs: { mod: {} } } }, data.roster, 4],
		['hero.safety.reviveCapacity', data.game, data.roster, null]
	]) { const descriptor = safety.revivalBlockReason(gameData, roster, capacity); assert.equal(render(descriptor), id); ids.add(id); }
	for (const count of [1, 2, 5, 21]) {
		const descriptor = safety.revivalBlockReason(data.game, data.roster, 2, count);
		ids.add(render(descriptor));
		for (const locale of ['en', 'ru']) {
			setEditorLocale(locale);
			assert.equal(describeMessage(descriptor), `Revival needs ${formatNumber(count)} free roster slot${count === 1 ? '' : 's'}. The living roster is 2/2.`);
		}
	}
	assert.equal(safety.revivalBlockReason(data.game, data.roster, 3), null);
	assert.deepEqual([...ids].filter((id) => id.startsWith('hero.safety.')).sort(), Object.keys(en).filter((id) => id.startsWith('hero.safety.')).sort());
});

test('every integer and name descriptor renders its exact English wording in en and ru fallback', () => {
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		for (const input of ['', '1.5', 101, Infinity]) {
			const descriptor = inputs.parseInteger(input, 0, 100).error;
			assert.equal(describeMessage(descriptor), 'Enter a whole number from 0 to 100.');
		}
		assert.equal(describeMessage(inputs.validateHeroName('bad\nname').error), 'Names cannot contain control or invisible formatting characters.');
		assert.equal(describeMessage(inputs.validateHeroName('###name').error), 'Names cannot start with ### because it is reserved for save identifiers.');
		assert.equal(describeMessage(inputs.validateHeroName('').error), 'Enter a name from 1 to 32 characters.');
		assert.equal(describeMessage(inputs.parseInteger(-1, 0, 10000).error), `Enter a whole number from 0 to ${formatNumber(10000)}.`);
		// Both ICU length branches remain grammatical even if the limit changes.
		for (const count of [1, 2, 5, 21]) assert.equal(describeMessage({ id: 'input.nameLength', params: { count, countText: count } }), `Enter a name from 1 to ${count} character${count === 1 ? '' : 's'}.`);
	}
});

test('every trinket guard descriptor and both per-hero limit branches render without mutating items', () => {
	const ids = new Set();
	for (const [id, setup, incoming = 'ring', source = 'catalogue', definitions = []] of [
		['hero.trinket.dead', (h) => h['roster.status'] = 3],
		['hero.trinket.shape', (h) => h.trinkets.items = []],
		['hero.trinket.estate', () => {}, 'ring', 'inventory'],
		['hero.trinket.inventory', () => {}, 'ring', 'inventory'],
		['hero.trinket.definition', () => {}, 'other', 'catalogue', [{ id: 'ring' }]],
		['hero.trinket.class', () => {}, 'ring', 'catalogue', [{ id: 'ring', class_restriction: 'vestal' }]]
	]) {
		const h = hero(), estate = id === 'hero.trinket.estate' ? null : refs().estate;
		setup(h); const before = JSON.stringify([h, estate]);
		const result = trinkets.equipTrinket(h, estate, '0', incoming, source, definitions);
		assert.equal(render(result.error), id); ids.add(id);
		assert.equal(result.changed, false); assert.equal(JSON.stringify([h, estate]), before);
	}
	for (const count of [1, 2, 5, 21]) {
		const descriptor = trinkets.trinketEquipBlockReason('ring', 'crusader', [{ id: 'ring', limit: count }], Array(count).fill('ring'));
		ids.add(render(descriptor));
		for (const locale of ['en', 'ru']) { setEditorLocale(locale); assert.equal(describeMessage(descriptor), `This trinket is limited to ${count} per hero.`); }
	}
	assert.deepEqual([...ids].sort(), Object.keys(en).filter((id) => id.startsWith('hero.trinket.')).sort());
});

test('all validation issues and category badges retain raw ids and re-resolve names at render', () => {
	for (const [name, data] of Object.entries(structuredClone(reference))) store[`load${name[0].toUpperCase()}${name.slice(1)}`]?.(data);
	store.getHeroRawData('34').weapon_rank = 5;
	store.getHeroRawData('34').armour_rank = -1;
	store.getSaveData().town.base_root.buildings.abbey.activities.prayer[9] = { hero: 999 };
	const issues = validation.runPreSaveValidation();
	const gear = issues.filter((issue) => issue.message.id === 'validation.gearRank');
	assert.equal(gear.length, 2);
	const orphan = issues.find((issue) => issue.message.id === 'validation.missingHero');
	assert.ok(orphan);
	const dlc = validation.checkDlcFieldInjection({
		'persist.roster.json': { base_root: { heroes: { 1: { hero_file_data: { raw_data: { base_root: { actor: { name: 'User <name>' }, quirks: { disease_vampire_crave: {} } } } } } } } },
		'persist.estate.json': { base_root: { wallet: { 0: { type: 'shard', amount: 10000 } } } }
	}, { has_crimson_court: false, has_color_of_madness: false });
	assert.equal(dlc.length, 2);
	assert.match(describeValidationIssue(dlc[0]), /Disease Vampire Crave" \(disease_vampire_crave\)/);
	assert.equal(dlc[0].message.params.quirkId, 'disease_vampire_crave');
	const before = JSON.stringify(store.getSaveData().roster);
	const descriptors = JSON.stringify([...issues, ...dlc]);
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		for (const issue of [...issues, ...dlc]) {
			assert.ok(describeValidationIssue(issue).trim());
			assert.ok(['Gear Rank', 'Treatment', 'DLC'].includes(describeMessage(issue.category)));
		}
		assert.match(describeValidationIssue(gear[0]), /weapon rank 5/);
		assert.match(describeValidationIssue(gear[1]), /armour rank -1/);
		assert.match(describeValidationIssue(dlc[1]), new RegExp(formatNumber(10000)));
	}
	game.setNameTable({ hero_class_name_grave_robber: 'Класс', town_name_abbey: 'Здание', town_activity_name_prayer: 'Действие', str_quirk_name_disease_vampire_crave: 'Проклятие' }, 'russian');
	assert.match(describeValidationIssue(gear[0]), /\(Класс\)/);
	assert.match(describeValidationIssue(orphan), /Здание Действие slot 10/);
	assert.match(describeValidationIssue(dlc[0]), /User <name>.*Проклятие/);
	assert.match(describeValidationIssue(dlc[0]), /Проклятие" \(disease_vampire_crave\)/);
	const unnamed = structuredClone(dlc[0]);
	unnamed.message.params.name = '';
	assert.match(describeValidationIssue(unnamed), /^Hero "Unnamed hero"/);
	assert.equal(JSON.stringify([...issues, ...dlc]), descriptors);
	assert.equal(JSON.stringify(store.getSaveData().roster), before);
	store.getHeroRawData('34')['roster.status'] = 0;
	const mismatch = validation.runPreSaveValidation().find((issue) => issue.message.id === 'validation.treatmentMismatch');
	assert.equal(render(mismatch.message), 'validation.treatmentMismatch');
	store.getHeroRawData('34')['roster.status'] = 2;
	const roster = structuredClone(store.getSaveData().roster);
	store.resetSaveData();
	store.loadRoster(roster);
	const missing = validation.runPreSaveValidation().find((issue) => issue.message.id === 'validation.townMissing');
	assert.equal(render(missing.message), 'validation.townMissing');
	const seen = new Set([...issues, ...dlc, missing, mismatch].map((issue) => issue.message.id));
	assert.deepEqual([...seen].sort(), ['validation.curseDlc', 'validation.gearRank', 'validation.missingHero', 'validation.shardDlc', 'validation.townMissing', 'validation.treatmentMismatch'].sort());
});

test('one normalized search matches accents, full width, case folding, displayed names, English aliases and raw ids', () => {
	for (const [query, value] of [['reynauld', 'Réynauld'], ['ＲＥＹ', 'Reynauld'], ['cafe', 'Ｃａｆé'], ['strasse', 'Straße'], ['οσ', 'ΟΣ'], ['カタカナ', 'ｶﾀｶﾅ']]) assert.equal(matchesSearch(query, value), true);
	assert.equal(normalizeSearch(' ＣＡＦÉ '), 'cafe');
	assert.equal(matchesSearch('raw_mod_id', '別名', 'English name', 'raw_mod_id'), true);
	assert.equal(matchesSearch('unrelated', 'Name', 'raw_mod_id'), false);
	for (const [query, value] of [['lodz', 'Łódź'], ['o', 'ø'], ['d', 'đ'], ['елка', 'Ёлка'], ['バ', 'ﾊﾞ'], ['パ', 'ﾊﾟ']]) assert.equal(matchesSearch(query, value), true);
	for (const [query, value] of [['バ', 'ハ'], ['パ', 'ハ'], ['バ', 'パ'], ['Мой', 'Мои'], ['и', 'й']]) assert.equal(matchesSearch(query, value), false);
	game.setNameTable({ str_quirk_name_opaque_id: '表示名' }, 'japanese', '/game', { str_quirk_name_opaque_id: 'Élan Vital' });
	assert.equal(quirks.matchesQuirkSearch('opaque_id', '表示名', 'elan'), true);
	assert.equal(quirks.matchesQuirkSearch('opaque_id', '表示名', 'ＯＰＡＱＵＥ＿ＩＤ'), true);
	assert.equal(quirks.matchesQuirkSearch('opaque_id', '表示名', '表示'), true);
});

test('hero ordering uses editor locale for user names, game locale for entities and id ties for every sort', () => {
	const heroes = ['z', 'a'].map((guid) => ({ guid, name: 'Same', heroClass: guid, resolveLevel: 1, currentHp: 10, maxHp: 20, stress: 0, status: 0 }));
	const before = JSON.stringify(heroes);
	game.setNameTable({ hero_class_name_z: '同じ', hero_class_name_a: '同じ' }, 'japanese');
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		for (const sort of ['name', 'class', 'level', 'hp', 'stress', 'status']) assert.deepEqual(sortHeroes(heroes, sort).map((h) => h.guid), ['a', 'z']);
		assert.equal(JSON.stringify(heroes), before);
	}
	heroes[0].name = 'Яна'; heroes[1].name = 'Zoe';
	setEditorLocale('ru');
	const userExpected = Math.sign(new Intl.Collator('ru').compare('Яна', 'Zoe'));
	assert.equal(Math.sign(compareNames('Яна', 'z', 'Zoe', 'a')), userExpected);
	assert.equal(sortHeroes(heroes, 'name')[0].guid, userExpected < 0 ? 'z' : 'a');
	game.setNameTable({ hero_class_name_z: 'Яна', hero_class_name_a: 'Zoe' }, 'japanese');
	const gameExpected = new Intl.Collator('ja').compare('Яна', 'Zoe');
	assert.equal(sortHeroes(heroes, 'class')[0].guid, gameExpected < 0 ? 'z' : 'a');
});

test('game entity helpers use verified namespaces and per-key corrected fallbacks', () => {
	assert.deepEqual(Array.from({ length: 7 }, (_, i) => labels.resolveTitle(i)), ['Seeker', 'Apprentice', 'Adventurer', 'Veteran', 'Master', 'Champion', 'Legend']);
	assert.equal(labels.heroClassName('houndmaster'), 'Houndmaster');
	game.setNameTable({
		str_resolve_0: '称号', combat_skill_name_crusader_smite: '戦闘', camping_skill_name_encourage: '野営',
		str_inventory_title_trinketring: '装身具', str_affliction_name_depressed: '状態', str_virtue_name_stalwart: '美徳'
	}, 'japanese', '/game', { str_inventory_title_trinketring: 'English ring', hero_class_name_crusader: 'English class' });
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		assert.equal(labels.resolveTitle(0), '称号'); assert.equal(labels.combatSkillName('crusader', 'smite'), '戦闘');
		assert.equal(labels.campingSkillName('encourage'), '野営'); assert.equal(labels.trinketName('ring'), '装身具');
		assert.equal(labels.afflictionName('depressed'), '状態'); assert.equal(labels.afflictionName('stalwart'), '美徳');
		for (const [state, name] of [['passive', 'Sated'], ['crave', 'Craving'], ['wasting', 'Wasting'], ['blood_lust', 'Blood Lust']]) {
			assert.equal(labels.vampireStateName(`disease_vampire_${state}`), name);
		}
		// An unrecognized state keeps its raw id, so a modded save stays diagnosable.
		assert.equal(labels.vampireStateName('disease_vampire_feral'), 'disease_vampire_feral');
		assert.equal(labels.gameTextLocale(), 'ja');
		assert.equal(labels.trinketEnglishName('ring'), 'English ring'); assert.equal(labels.heroClassEnglishName('crusader'), 'English class');
		assert.equal(labels.combatSkillName('mod', 'raw_mod_skill'), 'Raw Mod Skill');
	}
});

test('revival name branch requires exactly one hero under Russian and French plural rules', () => {
	for (const locale of ['ru', 'fr']) {
		const formatter = new IntlMessageFormat(en['heroes.reviveTitle'], locale);
		for (const count of [0, 1, 2, 21, 31, 41, 101]) {
			assert.equal(formatter.format({ count, countText: String(count), name: 'Literal Name' }), `Revive ${count === 1 ? 'Literal Name' : count + ' heroes'}`);
		}
	}
});

test('hero count and name messages keep each plural/select branch complete in en and ru fallback', () => {
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		for (const count of [0, 1, 2, 5, 21]) {
			const countText = formatNumber(count);
			assert.equal(t('heroes.batchSelected', { count, countText }), `${countText} hero${count === 1 ? '' : 'es'} selected`);
			assert.equal(t('heroes.reviveTitle', { count, countText, name: 'Literal Name' }), `Revive ${count === 1 ? 'Literal Name' : countText + ' heroes'}`);
		}
		assert.equal(t('heroes.sort', { sort: 'hp' }), 'Sort: HP');
		assert.equal(t('heroes.addQuirk', { category: 'positive' }), 'Add Positive Quirk');
		assert.equal(t('heroes.addQuirk', { category: 'negative' }), 'Add Negative/Disease Quirk');
		for (const selected of ['yes', 'no']) assert.equal(t('heroes.skillAction', { selected, name: 'Skill' }), `${selected === 'yes' ? 'Deselect' : 'Select'} Skill`);
	}
});
