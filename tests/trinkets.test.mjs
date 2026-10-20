import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const server = await createServer({
	configFile: false,
	cacheDir: 'node_modules/.vite/trinkets-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false },
	appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const store = await server.ssrLoadModule('/src/lib/stores/save-data.svelte.ts');
const { equipTrinket, inventoryTrinkets, canEquipTrinket } = await server.ssrLoadModule('/src/lib/trinkets.ts');
const reference = {
	...JSON.parse(await readFile(new URL('./fixtures/safety-reference.json', import.meta.url), 'utf8')),
	...JSON.parse(await readFile(new URL('./fixtures/dismiss-reference.json', import.meta.url), 'utf8'))
};
reference.estate.base_root.trinkets.items = { '0': { id: 'lane_m_ring', type: 'trinket', amount: 3 } };
const item = (id, amount = 1) => ({ id, type: 'trinket', amount });
const hero = () => ({ heroClass: 'crusader', trinkets: { items: {} } });
const estate = (items = {}) => ({ base_root: { trinkets: { items } } });

beforeEach(() => {
	store.resetSaveData();
	for (const [name, value] of Object.entries(structuredClone(reference))) {
		const method = `load${name[0].toUpperCase()}${name.slice(1)}`;
		if (typeof store[method] === 'function') store[method](value);
	}
});

for (const amount of [1, 3]) {
	test(`inventory equip consumes one of ${amount} and preserves other keys`, () => {
		const h = hero();
		const e = estate({ '0': item('focus_ring', amount), '4': item('sun_ring') });
		assert.deepEqual(equipTrinket(h, e, '0', 'focus_ring', 'inventory'), { changed: true, estateChanged: true });
		assert.deepEqual(h.trinkets.items['0'], item('focus_ring'));
		assert.deepEqual(e.base_root.trinkets.items['4'], item('sun_ring'));
		if (amount === 1) assert.equal(e.base_root.trinkets.items['0'], undefined);
		else assert.equal(e.base_root.trinkets.items['0'].amount, amount - 1);
	});
}

test('catalogue equip creates a trinket without consuming inventory or requiring estate', () => {
	const h = hero();
	const e = estate({ '0': item('focus_ring', 2) });
	assert.deepEqual(equipTrinket(h, e, '0', 'focus_ring', 'catalogue'), { changed: true, estateChanged: false });
	assert.equal(e.base_root.trinkets.items['0'].amount, 2);
	assert.equal(equipTrinket(hero(), null, '0', 'sun_ring', 'catalogue').changed, true);
});

test('replacement and unequip return previous items using estate fields only', () => {
	for (const source of ['inventory', 'catalogue']) {
		const h = hero();
		h.trinkets.items['0'] = { ...item('old'), hero_only: 42 };
		const e = estate({ '3': item('new', 2) });
		assert.equal(equipTrinket(h, e, '0', 'new', source).estateChanged, true);
		assert.deepEqual(e.base_root.trinkets.items['4'], item('old'));
		assert.equal(e.base_root.trinkets.items['3'].amount, source === 'inventory' ? 1 : 2);
		assert.equal(equipTrinket(h, e, '0', '', 'inventory').changed, true);
		assert.equal(h.trinkets.items['0'], undefined);
		assert.deepEqual(e.base_root.trinkets.items['5'], item('new'));
	}
});

test('missing or malformed estate, exhausted inventory and class restrictions block the whole move', () => {
	for (const e of [null, {}, estate({ unexpected: item('new') }), estate()]) {
		const h = hero();
		h.trinkets.items['0'] = item('old');
		const original = structuredClone({ h, e });
		assert.ok(equipTrinket(h, e, '0', 'new', 'inventory').error);
		assert.deepEqual({ h, e }, original);
	}
	for (const id of ['new', '']) {
		const h = hero();
		h.trinkets.items['0'] = item('old');
		assert.match(equipTrinket(h, null, '0', id, 'catalogue').error, /estate file/);
		assert.equal(h.trinkets.items['0'].id, 'old');
	}
	const definitions = [{ id: 'restricted', class_restriction: 'vestal' }];
	assert.equal(canEquipTrinket('restricted', 'crusader', definitions), false);
	assert.equal(canEquipTrinket('restricted', 'vestal', definitions), true);
	assert.ok(equipTrinket(hero(), estate(), '0', 'restricted', 'catalogue', definitions).error);
});

test('selecting the equipped id is a no-op for either source even without estate', () => {
	for (const source of ['inventory', 'catalogue']) {
		const h = hero();
		h.trinkets.items['0'] = item('old');
		assert.deepEqual(equipTrinket(h, null, '0', 'old', source), { changed: false, estateChanged: false });
	}
});

test('inventory groups aggregate multiple entries and ignore unsupported items', () => {
	assert.deepEqual(inventoryTrinkets(estate({ '0': item('ring'), '3': item('ring', 2), '4': { id: 'bad' } })), [{ id: 'ring', amount: 3 }]);
});

test('real store dirties both files, Discard restores both, and single-hero revert cannot duplicate', () => {
	const raw = store.getHeroRawData('1');
	const current = raw.trinkets.items['0']?.id;
	const available = inventoryTrinkets(store.getSaveData().estate).find((entry) => entry.id !== current);
	assert.ok(available);
	const originalRoster = structuredClone(store.getSaveData().roster);
	const originalEstate = structuredClone(store.getSaveData().estate);
	assert.equal(store.setHeroTrinket('1', '0', available.id, 'inventory'), null);
	assert.ok('persist.roster.json' in store.getDirtyData());
	assert.ok('persist.estate.json' in store.getDirtyData());
	assert.match(store.revertHero('1'), /Discard All/);
	store.discardAllChanges();
	assert.deepEqual(store.getSaveData().roster, originalRoster);
	assert.deepEqual(store.getSaveData().estate, originalEstate);
	assert.equal(store.hasDirtyFiles(), false);
	const equipped = store.getHeroRawData('1').trinkets.items['0']?.id;
	if (equipped) {
		assert.equal(store.setHeroTrinket('1', '0', equipped, 'catalogue'), null);
		assert.equal(store.hasDirtyFiles(), false);
	}
});

test('catalogue store creation dirties only roster and missing estate blocks replacement atomically', () => {
	store.getHeroRawData('1').trinkets.items = {};
	store.clearAllDirty();
	assert.equal(store.setHeroTrinket('1', '0', 'lane_m_ring', 'catalogue'), null);
	assert.deepEqual(Object.keys(store.getDirtyData()), ['persist.roster.json']);
	const savedRoster = structuredClone(store.getSaveData().roster);
	store.resetSaveData();
	store.loadRoster(savedRoster);
	assert.match(store.setHeroTrinket('1', '0', 'other', 'catalogue'), /estate file/);
	assert.deepEqual(store.getSaveData().roster, savedRoster);
	assert.equal(store.hasDirtyFiles(), false);
});
