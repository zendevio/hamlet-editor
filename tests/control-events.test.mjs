import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const server = await createServer({
	configFile: false,
	cacheDir: 'node_modules/.vite/control-events-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false },
	appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const store = await server.ssrLoadModule('/src/lib/stores/save-data.svelte.ts');
const { sliderControl, hpSliderMax, commitChangedValue } = await server.ssrLoadModule('/src/lib/control-events.ts');
const { createWindowCloseGuard } = await server.ssrLoadModule('/src/lib/save-workflow.ts');
const reference = {
	...JSON.parse(await readFile(new URL('./fixtures/safety-reference.json', import.meta.url), 'utf8')),
	...JSON.parse(await readFile(new URL('./fixtures/dismiss-reference.json', import.meta.url), 'utf8'))
};

beforeEach(() => {
	store.resetSaveData();
	for (const [name, value] of Object.entries(structuredClone(reference))) {
		const method = `load${name[0].toUpperCase()}${name.slice(1)}`;
		if (typeof store[method] === 'function') store[method](value);
	}
});

// Component-free equivalent of Bits UI's render/prop-change normalization:
// it reports a snapped value through onValueChange, never onValueCommit.
function normalizeSlider(control, min, max, step = 1) {
	const normalized = Math.min(max, Math.max(min, min + Math.round((control.value - min) / step) * step));
	if (normalized !== control.value) control.onValueChange?.(normalized);
}

function renderHeroControls(hpWrites = []) {
	for (const hero of store.getHeroes()) {
		const writeHp = (value) => {
			hpWrites.push({ guid: hero.guid, value });
			store.setHeroHp(hero.guid, value);
		};
		const hp = sliderControl(hero.currentHp, writeHp);
		const max = hpSliderMax(hero.maxHp, hero.currentHp);
		assert.ok(max >= hero.currentHp && max >= hero.maxHp && max >= 1);
		normalizeSlider(hp, hero.status === 3 ? 0 : 1, max);
		// Also exercise a changed class/armour bound below the saved value.
		normalizeSlider(hp, 1, 1);
		hp.onValueCommit(hero.currentHp); // an unchanged user commit is a no-op too
		normalizeSlider(sliderControl(hero.stress, (value) => store.setHeroStress(hero.guid, value)), 0, 200);
		for (const [current, commit] of [
			[hero.resolveLevel, (value) => store.setHeroLevel(hero.guid, value)],
			[hero.weaponRank, (value) => store.setHeroWeaponRank(hero.guid, value)],
			[hero.armourRank, (value) => store.setHeroArmourRank(hero.guid, value)],
			[hero.virtueTypeId || hero.afflictionTypeId || '', (value) => store.setHeroAffliction(hero.guid, value)],
			[hero.visitedDeathsDoor, (value) => store.setHeroDeathsDoor(hero.guid, value)]
		]) commitChangedValue(current, current, commit);
	}
}

test('viewing every real-fixture hero preserves fractional HP and every save field', () => {
	assert.equal(store.getHeroes().length, 29);
	assert.equal(store.getHeroRawData('1').actor.current_hp, 67.0999984741211);
	assert.equal(store.getMaxHp('crusader', store.getHeroRawData('1').armour_rank), 61);
	const writes = [];
	renderHeroControls(writes);
	assert.deepEqual(writes, []);
	assert.deepEqual(store.getSaveData().roster, reference.roster);
	assert.equal(store.hasDirtyFiles(), false);
});

test('unchanged store calls preserve resolve progress, affliction and flags for every hero', () => {
	for (const hero of store.getHeroes()) {
		store.setHeroLevel(hero.guid, hero.resolveLevel);
		store.setHeroAffliction(hero.guid, hero.virtueTypeId || hero.afflictionTypeId || '');
		store.setHeroDeathsDoor(hero.guid, hero.visitedDeathsDoor);
		store.setHeroWeaponRank(hero.guid, hero.weaponRank);
		store.setHeroArmourRank(hero.guid, hero.armourRank);
	}
	assert.deepEqual(store.getSaveData().roster, reference.roster);
	assert.equal(store.hasDirtyFiles(), false);
});

test('only a user slider commit can call setHeroHp with a lower HP value', () => {
	const writes = [];
	const original = store.getHeroRawData('1').actor.current_hp;
	const control = sliderControl(original, (value) => {
		writes.push(value);
		store.setHeroHp('1', value);
	});
	normalizeSlider(control, 1, 61);
	normalizeSlider(control, 1, hpSliderMax(61, original));
	assert.deepEqual(writes, []);
	assert.equal(store.hasDirtyFiles(), false);
	control.onValueCommit(60); // pointer release or keyboard activation
	assert.deepEqual(writes, [60]);
	assert.equal(store.getHeroRawData('1').actor.current_hp, 60);
	assert.equal(store.hasDirtyFiles(), true);
});

test('discard followed by render and prop normalization stays clean for every hero', async () => {
	for (let pass = 0; pass < 3; pass++) {
		sliderControl(store.getHeroRawData('1').actor.current_hp, (value) => store.setHeroHp('1', value)).onValueCommit(60);
		store.setHeroStress('1', 100);
		store.setWalletAmount('gold', 123);
		assert.equal(store.hasDirtyFiles(), true);
		store.discardAllChanges();
		const writes = [];
		renderHeroControls(writes);
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(writes, []);
		assert.equal(store.hasDirtyFiles(), false);
		assert.deepEqual(store.getDirtyData(), {});
		assert.deepEqual(store.getSaveData().roster, reference.roster);
		assert.deepEqual(store.getSaveData().estate, reference.estate);
	}
});

test('stress and torchlight normalization never writes until a user commits', () => {
	store.getHeroRawData('1').m_Stress = 12.25;
	store.getSaveData().raid.base_root.torchlight = 75.25;
	store.clearAllDirty();
	const stress = sliderControl(12.25, (value) => store.setHeroStress('1', value));
	const torch = sliderControl(75.25, store.setRaidTorchlight);
	normalizeSlider(stress, 0, 200);
	normalizeSlider(torch, 0, 100, 0.5);
	assert.equal(store.hasDirtyFiles(), false);
	assert.equal(store.getHeroRawData('1').m_Stress, 12.25);
	assert.equal(store.getSaveData().raid.base_root.torchlight, 75.25);
	stress.onValueCommit(12);
	torch.onValueCommit(75.5);
	assert.equal(store.getHeroRawData('1').m_Stress, 12);
	assert.equal(store.getSaveData().raid.base_root.torchlight, 75.5);
	store.discardAllChanges();
	assert.equal(store.hasDirtyFiles(), false);
});

test('healing preserves buffed fractional HP and only raises HP below the base max', () => {
	store.healHeroToMax('1');
	assert.equal(store.getHeroRawData('1').actor.current_hp, 67.0999984741211);
	assert.equal(store.hasDirtyFiles(), false);
	for (const hero of store.getHeroes()) {
		store.healHeroToMax(hero.guid);
		assert.equal(store.getHeroRawData(hero.guid).actor.current_hp, Math.max(hero.currentHp, Math.floor(hero.maxHp)));
	}
});

test('select, toggle and numeric input echoes do not call mutations, changed values do', () => {
	const writes = [];
	for (const value of ['4', '_none', true, false, 123]) {
		assert.equal(commitChangedValue(value, value, (next) => writes.push(next)), false);
	}
	assert.deepEqual(writes, []);
	for (const [current, next] of [['4', '3'], ['_none', 'courageous'], [false, true], [123, 124]]) {
		assert.equal(commitChangedValue(current, next, (value) => writes.push(value)), true);
	}
	assert.deepEqual(writes, ['3', 'courageous', true, 124]);
});

test('Discard and Close stays approved through re-rendering and the native close request', async () => {
	store.setHeroHp('1', 60);
	const guard = createWindowCloseGuard(store.hasDirtyFiles);
	assert.equal(guard.shouldConfirm(), true);
	let closed = 0;
	assert.equal(await guard.closeAfter(() => {
		store.discardAllChanges();
		return true;
	}, async () => {
		renderHeroControls();
		assert.equal(store.hasDirtyFiles(), false);
		// Even an unrelated late dirty callback cannot reopen an approved prompt.
		store.markDirty('persist.roster.json');
		assert.equal(guard.shouldConfirm(), false);
		closed++;
	}), true);
	assert.equal(closed, 1);
});

test('failed preparation or native close never leaves the close guard approved', async () => {
	const guard = createWindowCloseGuard(() => true);
	let closed = 0;
	assert.equal(await guard.closeAfter(() => false, async () => { closed++; }), false);
	assert.equal(closed, 0);
	assert.equal(guard.shouldConfirm(), true);
	await assert.rejects(guard.closeAfter(() => true, async () => { throw new Error('close failed'); }), /close failed/);
	assert.equal(guard.shouldConfirm(), true);
});
