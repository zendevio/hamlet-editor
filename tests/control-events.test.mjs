import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { normalizeSteps, snapValueToCustomSteps, getAdjacentStepValue, getThumbStyles } from '../node_modules/bits-ui/dist/bits/slider/helpers.js';

import { linearScale } from '../node_modules/bits-ui/dist/internal/math.js';

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
const { alignedSliderRange, sliderControl, sliderValueLabel, sliderNumberLabel, hpSliderMax, commitChangedValue } = await server.ssrLoadModule('/src/lib/control-events.ts');
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

// Installed Bits UI helpers supply the exact payloads from its watch,
// applyPosition/updateValue, pointer-up and horizontal keyboard paths.
function bitsSlider(control) {
	const steps = normalizeSteps(control.step, control.min, control.max);
	let value = snapValueToCustomSteps(control.value, steps);
	const resync = () => { value = control.restoreValue(); };
	const position = (next) => {
		value = snapValueToCustomSteps(Math.min(control.max, Math.max(control.min, next)), steps);
		control.onValueChange(value);
	};
	return {
		get value() { return value; },
		click(next = value) {
			control.onpointerdowncapture({ button: 0 });
			position(next);
			control.onValueCommit(value);
			resync();
		},
		drag(...positions) {
			control.onpointerdowncapture({ button: 0 });
			positions.forEach(position);
			control.onValueCommit(value);
			resync();
		},
		key(direction) {
			control.onkeydowncapture();
			value = direction === 'End' ? steps[steps.length - 1]
				: snapValueToCustomSteps(getAdjacentStepValue(value, steps, direction), steps);
			control.onValueChange(value);
			control.onValueCommit(value);
			resync();
		}
	};
}

function renderHeroControls(hpWrites = []) {
	for (const hero of store.getHeroes()) {
		const writeHp = (value) => {
			hpWrites.push({ guid: hero.guid, value });
			store.setHeroHp(hero.guid, value);
		};
		const max = hpSliderMax(hero.maxHp, hero.currentHp);
		const hp = sliderControl(hero.currentHp, { min: hero.status === 3 ? 0 : 1, max, step: 1 }, writeHp);
		assert.ok(max >= hero.currentHp && max >= hero.maxHp && max >= 1);
		bitsSlider(hp).click();
		// Also exercise a changed class/armour bound below the saved value.
		bitsSlider(sliderControl(hero.currentHp, { min: 1, max: 1, step: 1 }, writeHp)).click();
		bitsSlider(sliderControl(hero.stress, { min: 0, max: 200, step: 1 }, (value) => store.setHeroStress(hero.guid, value))).click();
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
	const control = sliderControl(original, { min: 1, max: hpSliderMax(61, original), step: 1 }, (value) => {
		writes.push(value);
		store.setHeroHp('1', value);
	});
	const slider = bitsSlider(control);
	assert.equal(slider.value, 67);
	slider.click();
	assert.deepEqual(writes, []);
	assert.equal(store.hasDirtyFiles(), false);
	slider.click(60);
	assert.deepEqual(writes, [60]);
	assert.equal(store.getHeroRawData('1').actor.current_hp, 60);
	assert.equal(store.hasDirtyFiles(), true);
});

test('discard followed by render and prop normalization stays clean for every hero', async () => {
	for (let pass = 0; pass < 3; pass++) {
		const hp = store.getHeroRawData('1').actor.current_hp;
		bitsSlider(sliderControl(hp, { min: 1, max: hpSliderMax(61, hp), step: 1 }, (value) => store.setHeroHp('1', value))).click(60);
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

test('stress and torchlight clicks preserve fractions while keyboard steps commit changes', () => {
	store.getHeroRawData('1').m_Stress = 12.25;
	store.getSaveData().raid.base_root.torchlight = 75.25;
	store.clearAllDirty();
	const stress = bitsSlider(sliderControl(12.25, { min: 0, max: 200, step: 1 }, (value) => store.setHeroStress('1', value)));
	const torch = bitsSlider(sliderControl(75.25, { min: 0, max: 100, step: 0.5 }, store.setRaidTorchlight));
	assert.equal(stress.value, 12);
	assert.equal(torch.value, 75);
	stress.click();
	torch.click();
	assert.equal(store.hasDirtyFiles(), false);
	assert.equal(store.getHeroRawData('1').m_Stress, 12.25);
	assert.equal(store.getSaveData().raid.base_root.torchlight, 75.25);
	stress.key('next');
	torch.key('next');
	assert.equal(store.getHeroRawData('1').m_Stress, 13);
	assert.equal(store.getSaveData().raid.base_root.torchlight, 75.5);
	store.discardAllChanges();
	assert.equal(store.hasDirtyFiles(), false);
});

test('fractional HP clicks, keyboard bounds and drags use the actual Bits UI snapped steps', () => {
	for (const guid of ['1', '34']) {
		const hero = store.getHeroes().find((hero) => hero.guid === guid);
		const writes = [];
		const max = hpSliderMax(hero.maxHp, hero.currentHp);
		const slider = bitsSlider(sliderControl(hero.currentHp, { min: 1, max, step: 1 }, (value) => {
			writes.push(value);
			store.setHeroHp(guid, value);
		}));
		const start = slider.value;
		assert.equal(start, guid === '1' ? 67 : 39);
		slider.click(); // pointerdown and pointerup with no movement
		slider.drag(start - 2, start); // pointermove away and back before pointerup
		assert.deepEqual(writes, []);
		assert.equal(store.hasDirtyFiles(), false);
		slider.key('next'); // an outlying step preserves the unchanged saved fraction
		assert.deepEqual(writes, []);
		assert.equal(store.getHeroRawData(guid).actor.current_hp, hero.currentHp);

		slider.key('prev');
		assert.deepEqual(writes, [guid === '1' ? 66 : 38]);
		assert.ok(writes.every((value) => value >= 1 && value <= max));
		store.discardAllChanges();
	}
});

for (const [guid, lowered, expected] of [['1', 50, 67], ['34', 20, 39]]) {
	for (const gesture of ['drag', 'End']) {
		test(`${guid}: ${gesture} to an outlying upper step writes integer HP through the real store`, () => {
			const savedHp = store.getSavedHeroHp(guid);
			store.setHeroHp(guid, lowered);
			const hero = store.getHeroes().find((hero) => hero.guid === guid);
			const writes = [];
			const slider = bitsSlider(sliderControl(hero.currentHp, {
				min: 1, max: hpSliderMax(hero.maxHp, hero.currentHp, savedHp), step: 1
			}, (next) => {
				writes.push(next);
				store.setHeroHp(guid, next);
			}));
			if (gesture === 'drag') slider.drag(Infinity);
			else slider.key('End');
			assert.deepEqual(writes, [expected]);
			assert.equal(slider.value, expected);
			assert.equal(store.getHeroRawData(guid).actor.current_hp, expected);
			assert.equal(store.hasDirtyFiles(), true);
			assert.ok('persist.roster.json' in store.getDirtyData());
		});

		test(`${guid}: unchanged HP at the ${gesture} endpoint preserves its saved fraction`, () => {
			const hero = store.getHeroes().find((hero) => hero.guid === guid);
			const writes = [];
			const slider = bitsSlider(sliderControl(hero.currentHp, {
				min: 1, max: hpSliderMax(hero.maxHp, hero.currentHp), step: 1
			}, (next) => {
				writes.push(next);
				store.setHeroHp(guid, next);
			}));
			if (gesture === 'drag') slider.drag(Infinity);
			else slider.key('End');
			assert.deepEqual(writes, []);
			assert.equal(slider.value, Math.floor(hero.currentHp));
			slider.key('next'); // ArrowRight must resync again without writing the saved fraction.
			assert.equal(slider.value, Math.floor(hero.currentHp));
			assert.deepEqual(writes, []);
			assert.equal(store.getHeroRawData(guid).actor.current_hp, hero.currentHp);
			assert.equal(store.hasDirtyFiles(), false);
		});
	}
}

test('outlying commits stay on the grid inside fractional lower and half-step bounds', () => {
	for (const [value, range, direction, expected] of [
		[4, { min: 2.4, max: 6.2, step: 1 }, 'prev', 3],
		[75, { min: 0, max: 75.6, step: 0.5 }, 'End', 75.5],
		[2, { min: 1.2, max: 5, step: 0.5 }, 'prev', 1.5]
	]) {
		const writes = [];
		const slider = bitsSlider(sliderControl(value, range, (next) => writes.push(next)));
		if (direction === 'prev') slider.drag(-Infinity);
		else slider.key(direction);
		assert.deepEqual(writes, [expected]);
		assert.ok(writes.every((next) => next >= range.min && next <= range.max));
	}
});

test('snapped starting commits match installed Bits UI for ties, decimal and exponential steps', () => {
	for (const range of [
		{ min: 0, max: 100, step: 0.5 },
		{ min: 1, max: 67.0999984741211, step: 1 },
		{ min: 0.2, max: 0.81, step: 0.1 },
		{ min: 0, max: 0.000001, step: 1e-7 }
	]) {
		for (const value of [range.min, range.max, range.min + range.step / 2, (range.min + range.max) / 2, NaN, undefined, Infinity, -Infinity, null, -0]) {
			const writes = [];
			const control = sliderControl(value, range, (next) => writes.push(next));
			control.onValueCommit(bitsSlider(control).value);
			assert.deepEqual(writes, [], JSON.stringify({ value, range }));
		}
	}
});

test('slider labels match Bits UI steps and explain off-grid saved values', () => {
	for (const [value, range, expected] of [
		[67.0999984741211, { min: 1, max: 67.0999984741211, step: 1 }, '67 (saved: 67.1)'],
		[39.5999984741211, { min: 1, max: 39.5999984741211, step: 1 }, '39.6'],
		[0, { min: 1, max: 61, step: 1 }, '1 (saved: 0)'],
		[12.25, { min: 0, max: 200, step: 1 }, '12 (saved: 12.3)'],
		[75.25, { min: 0, max: 100, step: 0.5 }, '75 (saved: 75.3)'],
		[75.5, { min: 0, max: 100, step: 0.5 }, '75.5']
	]) assert.equal(sliderValueLabel(value, range), expected);
});

test('deterministic fuzz snapping matches Bits UI including non-finite inputs', () => {
	let seed = 421;
	const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
	const special = [NaN, undefined, Infinity, -Infinity, null, -0];
	for (let i = 0; i < 5000; i++) {
		const step = [1, 0.5, 0.1, 0.25, 2, 5, 0.05, 3, 0.3][i % 9];
		const min = [0, 1, 0.2, 2.4, -3][i % 5];
		const max = min + Math.round(random() * 20000) / 100;
		const range = { min, max, step };
		for (const value of [Math.fround(random() * (max - min + 4) + min - 2), ...special]) {
			const aligned = alignedSliderRange(range);
			const snapped = snapValueToCustomSteps(value, normalizeSteps(step, aligned.min, aligned.max));
			const expected = snapped > range.max || snapped < range.min ? sliderNumberLabel(value)
				: snapped === value ? String(snapped) : `${snapped} (saved: ${sliderNumberLabel(value)})`;
			assert.equal(sliderValueLabel(value, range), expected);
			const writes = [];
			sliderControl(value, range, (next) => writes.push(next)).onValueCommit(snapped);
			assert.deepEqual(writes, []);
		}
	}
});

// Mirror getPositionFromValue/getThumbScale and applyPosition, including the
// default half-thumb containment that the previous value-only harness omitted.
function pointerValueAtThumb(control, width, thumbWidth = 12) {
	const steps = normalizeSteps(control.step, control.min, control.max);
	const shown = snapValueToCustomSteps(control.value, steps);
	const padding = control.thumbPositioning === 'exact' ? 0 : thumbWidth / width * 50;
	const percent = linearScale([control.min, control.max], [padding, 100 - padding])(shown);
	const style = getThumbStyles('lr', percent);
	const clientX = parseFloat(style.left) / 100 * width;
	const mapped = clientX / width * (control.max - control.min) + control.min;
	return snapValueToCustomSteps(mapped, steps);
}

test('thumb-center pointer mapping preserves fractional saves at actual rendered positions', () => {
	for (const [value, range] of [
		[67.0999984741211, { min: 1, max: 67.0999984741211, step: 1 }],
		[39.5999984741211, { min: 1, max: 39.5999984741211, step: 1 }],
		[0, { min: 1, max: 61, step: 1 }],
		[75.25, { min: 0, max: 100, step: 0.5 }],
		[3.4, { min: 2.4, max: 6.2, step: 1 }],
		[0.35, { min: 0.21, max: 0.81, step: 0.1 }]
	]) {
		for (const width of [100, 300, 800]) {
			const writes = [];
			const control = sliderControl(value, range, (next) => writes.push(next));
			const slider = bitsSlider(control);
			const mapped = pointerValueAtThumb(control, width);
			assert.equal(mapped, slider.value, JSON.stringify({ value, width }));
			// Verify mapping itself without relying on the pointer gesture guard.
			control.onValueCommit(mapped);
			slider.click(mapped);
			slider.drag(slider.value - 2 * range.step, mapped);
			assert.deepEqual(writes, []);
		}
	}
});

test('old contained thumb geometry reproduces the real-cursor HP loss', () => {
	for (const [value, expected] of [[67.0999984741211, 66], [39.5999984741211, 39]]) {
		const range = { min: 1, max: value, step: 1 };
		assert.equal(pointerValueAtThumb({ value, ...range }, 300), expected);
		// Aligned endpoints alone still leave the padded/full-track scale mismatch.
		assert.notEqual(pointerValueAtThumb({ value, ...alignedSliderRange(range) }, 300), snapValueToCustomSteps(value, normalizeSteps(1, 1, Math.ceil(value))));
	}
});

test('pointer guard uses the shown value at gesture start and keeps one-step changes', () => {
	const writes = [];
	const control = sliderControl(10.25, { min: 0, max: 100, step: 1 }, (next) => writes.push(next));
	const slider = bitsSlider(control);
	slider.key('next');
	assert.deepEqual(writes, [11]);
	slider.drag(9, 11); // shown start differs from the initial saved step
	slider.click();
	assert.deepEqual(writes, [11]);
	slider.drag(12);
	assert.deepEqual(writes, [11, 12]);
	control.onpointerdowncapture({ button: 0 });
	slider.key('next'); // keyboard clears pointer state and commits normally
	assert.deepEqual(writes, [11, 12, 13]);
});

test('HP range retains saved buffs through edits, hero switches, discard and save', () => {
	const original = store.getSavedHeroHp('1');
	assert.equal(original, 67.0999984741211);
	store.setHeroHp('1', 66);
	assert.equal(hpSliderMax(61, 66, store.getSavedHeroHp('1')), original);
	assert.equal(hpSliderMax(61, 80, store.getSavedHeroHp('1')), 80);
	assert.equal(store.getSavedHeroHp('missing'), undefined);
	assert.equal(hpSliderMax(1, 0, 0), 1);
	const other = store.getHeroes().find((hero) => hero.guid === '34');
	assert.equal(store.getSavedHeroHp(other.guid), other.currentHp);
	assert.equal(store.getSavedHeroHp('1'), original);
	store.discardAllChanges();
	assert.equal(store.getHeroRawData('1').actor.current_hp, original);
	store.setHeroHp('1', 66);
	store.clearAllDirty();
	assert.equal(store.getSavedHeroHp('1'), 66);
	assert.equal(hpSliderMax(61, 65, store.getSavedHeroHp('1')), 66);
	store.resetSaveData();
	assert.equal(store.getSavedHeroHp('1'), undefined);
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

test('adjusted and ignored commits restore valid HP, stress and torchlight steps', () => {
	for (const [initial, range, expected] of [
		[67.0999984741211, { min: 1, max: 67.0999984741211, step: 1 }, 67],
		[39.5999984741211, { min: 1, max: 39.5999984741211, step: 1 }, 39],
		[12.25, { min: 0, max: 200, step: 1 }, 12],
		[75.25, { min: 0, max: 100, step: 0.5 }, 75]
	]) {
		const writes = [];
		const slider = bitsSlider(sliderControl(initial, range, (next) => writes.push(next)));
		slider.click();
		assert.equal(slider.value, expected);
		assert.deepEqual(writes, []);
	}
	assert.equal(sliderNumberLabel(67.0999984741211), '67.1');
	assert.equal(sliderNumberLabel(39.5999984741211), '39.6');
});

test('initial slider value, restore and rerender use the same bounded step without writes', () => {
	for (const [value, range, expected] of [
		[39.5999984741211, { min: 1, max: 39.5999984741211, step: 1 }, 39],
		[67.0999984741211, { min: 1, max: 67.0999984741211, step: 1 }, 67],
		[0.21, { min: 0.21, max: 0.81, step: 0.1 }, 0.3]
	]) {
		const writes = [];
		const makeControl = () => sliderControl(value, range, (next) => writes.push(next));
		const control = makeControl();
		assert.equal(control.value, expected);
		assert.equal(bitsSlider(control).value, expected);
		assert.equal(control.restoreValue(), expected);
		assert.equal(bitsSlider(makeControl()).value, expected);
		assert.deepEqual(writes, []);
	}
});
