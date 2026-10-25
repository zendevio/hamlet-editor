import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const server = await createServer({
	configFile: false,
	cacheDir: 'node_modules/.vite/quirks-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false },
	appType: 'custom', logLevel: 'error'
});
after(() => server.close());

const data = await server.ssrLoadModule('/src/lib/stores/game-data.svelte.ts');
const quirks = await server.ssrLoadModule('/src/lib/data/quirks.ts');
beforeEach(() => data.resetGameData());

test('loaded game definitions classify base, DLC and disease quirks before fallback lists', () => {
	data.setQuirks([
		{ id: 'corvids_eye', is_positive: true, is_disease: false },
		{ id: 'resolution', is_positive: false, is_disease: false },
		{ id: 'dlc_quirk', is_positive: true, is_disease: false },
		{ id: 'tough', is_positive: false, is_disease: true }
	]);
	assert.equal(quirks.getQuirkCategory('corvids_eye'), 'positive');
	assert.equal(quirks.getQuirkCategory('resolution'), 'negative');
	assert.equal(quirks.getQuirkCategory('dlc_quirk'), 'positive');
	assert.equal(quirks.getQuirkCategory('tough'), 'disease');
	assert.equal(quirks.isPositiveQuirk('evasive'), true);
	assert.equal(quirks.getAllQuirks().find(q => q.id === 'dlc_quirk').category, 'positive');
});

test('missing game data retains fallback classification and corrected base quirks', () => {
	assert.equal(quirks.isPositiveQuirk('corvids_eye'), true);
	assert.equal(quirks.isPositiveQuirk('tough'), true);
	assert.equal(quirks.isDiseaseQuirk('rabies'), true);
	assert.equal(quirks.getQuirkCategory('resolution'), 'negative');
	assert.equal(quirks.getQuirkCategory('unknown_mod'), 'negative');
	assert.ok(quirks.getAllQuirks().some(q => q.id === 'resolution'));
});

test('localized names and descriptions fall back without leaking localization keys', () => {
	assert.equal(quirks.quirkName('unknown_mod'), 'Unknown Mod');
	assert.equal(quirks.quirkDescription('unknown_mod'), '');
	data.setNameTable({ str_quirk_name_resolution: '戒酒', str_quirk_description_resolution: '在城镇从不饮酒。' });
	assert.equal(quirks.quirkName('resolution'), '戒酒');
	assert.equal(quirks.quirkDescription('resolution'), '在城镇从不饮酒。');
	assert.equal(quirks.getAllQuirks().find(q => q.id === 'resolution').displayName, '戒酒');
});

test('hero quirk search matches CJK names and case-insensitive IDs', async () => {
	assert.equal(quirks.matchesQuirkSearch('resolution', '戒酒', '戒酒'), true);
	assert.equal(quirks.matchesQuirkSearch('resolution', '戒酒', ' RESOLUTION '), true);
	assert.equal(quirks.matchesQuirkSearch('corvids_eye', "Corvid's Eye", 'CORVID'), true);
	assert.equal(quirks.matchesQuirkSearch('resolution', '戒酒', 'tough'), false);

});


test('changing display strings updates hero class labels without mutating the roster', async () => {
	const store = await server.ssrLoadModule('/src/lib/stores/save-data.svelte.ts');
	const fixture = JSON.parse(await readFile(new URL('./fixtures/safety-reference.json', import.meta.url), 'utf8'));
	store.resetSaveData();
	store.loadRoster(structuredClone(fixture.roster));
	const before = JSON.stringify(store.getSaveData().roster);
	const hero = store.getHeroes()[0];
	const { heroClassName } = await server.ssrLoadModule('/src/lib/save-labels.ts');
	data.setNameTable({ [`hero_class_name_${hero.heroClass}`]: '测试职业' });
	assert.equal(heroClassName(hero.heroClass), '测试职业');
	assert.equal(JSON.stringify(store.getSaveData().roster), before);
	data.setNameTable({});
	assert.notEqual(heroClassName(hero.heroClass), '测试职业');
});


test('fallback catalogue exactly matches the base and DLC classification extract', async () => {
	const extract = JSON.parse(await readFile(new URL('./fixtures/quirk-classification.json', import.meta.url), 'utf8'));
	const expected = extract.map(q => ({ id: q.id, category: q.is_disease ? 'disease' : q.is_positive ? 'positive' : 'negative' }));
	const actual = quirks.getAllQuirks().map(({ id, category }) => ({ id, category })).sort((a, b) => a.id.localeCompare(b.id));
	assert.deepEqual(actual, expected.sort((a, b) => a.id.localeCompare(b.id)));
});
