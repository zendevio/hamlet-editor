import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const server = await createServer({
	configFile: false, cacheDir: 'node_modules/.vite/shell-i18n-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const store = await server.ssrLoadModule('/src/lib/stores/save-data.svelte.ts');
const game = await server.ssrLoadModule('/src/lib/stores/game-data.svelte.ts');
const { createMockRoster, createMockUpgrades } = await server.ssrLoadModule('/src/lib/data/mock.ts');
const labels = await server.ssrLoadModule('/src/lib/save-labels.ts');
const { setEditorLocale, t, describeMessage, describeActionMessage, richMessage } = await server.ssrLoadModule('/src/lib/i18n/index.svelte.ts');
const { compareNames, formatDate, formatNumber } = await server.ssrLoadModule('/src/lib/i18n/intl.ts');
const { profileSaveBlockReason, createSaveWorkflow } = await server.ssrLoadModule('/src/lib/save-workflow.ts');
const { withCurrentProfile } = await server.ssrLoadModule('/src/lib/profiles.ts');
const { showActionError } = await server.ssrLoadModule('/src/lib/i18n/notifications.ts');
const { toast } = await server.ssrLoadModule('svelte-sonner');

beforeEach(() => {
	store.resetSaveData();
	game.resetGameData();
	setEditorLocale('en');
});

test('summaries retain ids and status codes; the same objects render new game labels', () => {
	store.loadRoster(createMockRoster());
	store.loadUpgrades(createMockUpgrades());
	const hero = store.getHeroes()[0];
	const group = store.getBuildingUpgrades()[0];
	assert.equal(Object.hasOwn(hero, 'classDisplayName'), false);
	assert.equal(Object.hasOwn(hero, 'statusLabel'), false);
	assert.equal(Object.hasOwn(group, 'displayName'), false);
	const before = JSON.stringify(store.getSaveData().roster);
	game.setNameTable({
		['hero_class_name_' + hero.heroClass]: 'Класс',
		['town_name_' + group.buildingName]: 'Здание'
	}, 'russian');
	assert.equal(labels.heroClassName(hero.heroClass), 'Класс');
	assert.equal(labels.buildingDisplayName(group.buildingName), 'Здание');
	assert.equal(labels.gameTextLocale(), 'ru');
	setEditorLocale('ja');
	assert.equal(labels.heroClassName(hero.heroClass), 'Класс');
	assert.equal(JSON.stringify(store.getSaveData().roster), before);
	assert.equal(JSON.stringify(store.getDirtyData()), '{}');
	game.setNameTable({}, 'english');
	assert.notEqual(labels.heroClassName(hero.heroClass), 'Класс');
	assert.notEqual(labels.buildingDisplayName(group.buildingName), 'Здание');
	assert.equal(labels.heroClassName('houndmaster'), 'Houndmaster');
	assert.equal(labels.heroClassName('unknown_mod'), 'unknown_mod');
});

test('status and category labels render through the catalog, including P2 per-key fallback', () => {
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		for (const [status, expected] of [[0, 'Available'], [1, 'In party'], [2, 'In Treatment'], [3, 'Dead'], [4, 'Missing']]) {
			assert.equal(labels.heroStatusLabel(status), expected);
		}
		assert.equal(labels.heroStatusLabel(9), 'Unknown(9)');
		assert.equal(labels.heroStatusLabel(1000), 'Unknown(1000)');
		assert.equal(labels.heroStatusLabel('mod_status'), 'Unknown(mod_status)');
		for (const [id, category] of [['gear', 'Gear Rank'], ['treatment', 'Treatment'], ['dlc', 'DLC']]) assert.equal(describeMessage({ id: 'validation.category.' + id }), category);
	}
});

test('validation keeps both quantities in one sentence and pluralizes the fix action', () => {
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		// S2 keys are English-only until P3; Russian must use the per-key English contract.
		for (const [errors, warnings, expected] of [
			[0, 0, '0 warnings found.'], [0, 1, '1 warning found.'], [0, 2, '2 warnings found.'],
			[1, 0, '1 error and 0 warnings found.'], [1, 1, '1 error and 1 warning found.'],
			[1, 2, '1 error and 2 warnings found.'], [2, 1, '2 errors and 1 warning found.'],
			[2, 2, '2 errors and 2 warnings found.'], [5, 21, '5 errors and 21 warnings found.']
		]) assert.equal(t('validation.counts', { errors, errorsText: formatNumber(errors), warnings, warningsText: formatNumber(warnings) }), expected);
		assert.equal(t('validation.fixCount', { count: 1, countText: formatNumber(1) }), 'Fix 1 Issue Automatically');
		assert.equal(t('validation.fixCount', { count: 2, countText: formatNumber(2) }), 'Fix 2 Issues Automatically');
		assert.equal(t('shell.modsDetected', { count: 1, countText: formatNumber(1) }), '1 mod detected');
		assert.equal(t('shell.modsDetected', { count: 2, countText: formatNumber(2) }), '2 mods detected');
		assert.equal(t('shell.mods', { count: 1, countText: formatNumber(1) }), '1 mod');
		assert.equal(t('shell.mods', { count: 2, countText: formatNumber(2) }), '2 mods');
		const large = formatNumber(10000);
		assert.equal(t('shell.mods', { count: 10000, countText: large }), large + ' mods');
		assert.equal(t('validation.counts', { errors: 10000, errorsText: large, warnings: 2, warningsText: formatNumber(2) }),
			large + ' errors and 2 warnings found.');
	}
});

test('building collation uses game locale rather than editor locale and finishes with ids without mutating purchases', () => {
	const purchases = {
		z: { tree_id: '###abbey.cost', instance_number: 0, requirement_code: 'a', is_purchased: true },
		a: { tree_id: '###abbey.cost', instance_number: 0, requirement_code: 'a', is_purchased: false },
		m: { tree_id: '###guild.cost', instance_number: 0, requirement_code: 'a', is_purchased: false }
	};
	store.loadUpgrades({ base_root: { purchases } });
	game.setNameTable({ town_name_abbey: 'Same', town_name_guild: 'Same' }, 'russian');
	const before = JSON.stringify(store.getSaveData().upgrades);
	assert.deepEqual(store.getBuildingUpgrades().map(g => g.buildingName), ['abbey', 'guild']);
	assert.deepEqual(store.getBuildingUpgrades()[0].upgrades.map(p => p.is_purchased), [false, true]);
	assert.equal(JSON.stringify(store.getSaveData().upgrades), before);
	assert.ok(compareNames('same', 'a', 'same', 'z', 'ru') < 0);
	// Cyrillic sorts before Latin in Russian, after Latin in German.
	setEditorLocale('de');
	game.setNameTable({ town_name_abbey: 'Я', town_name_guild: 'Z' }, 'russian');
	assert.deepEqual(store.getBuildingUpgrades().map(g => g.buildingName), ['abbey', 'guild']);
	setEditorLocale('ru');
	game.setNameTable({ town_name_abbey: 'Я', town_name_guild: 'Z' }, 'german');
	assert.deepEqual(store.getBuildingUpgrades().map(g => g.buildingName), ['guild', 'abbey']);
	assert.equal(JSON.stringify(store.getSaveData().upgrades), before);
	game.setNameTable({ town_name_camping_trainer: 'Тренер' }, 'russian');
	assert.equal(labels.buildingDisplayName('camping_trainer'), 'Тренер');
	assert.equal(labels.buildingDisplayName('survivalist'), 'survivalist');
});

test('save workflow refuses the shared descriptor without backing up or writing', async () => {
	const data = { isLoaded: true, isLoading: false, isStale: false, profilePath: '/fixture/profile', gamePath: '/fixture/game' };
	const settings = { savePath: data.profilePath, gamePath: data.gamePath };
	const state = { isProfileLoading: false, gameRunning: false, gameDetectionUncertain: false, hasChanges: true };
	const cases = [
		[{ ...data, isLoading: true }, settings, state, 'error.profile_not_loaded'],
		[{ ...data, isLoaded: false }, settings, state, 'error.profile_not_loaded'],
		[data, settings, { ...state, isProfileLoading: true }, 'error.profile_not_loaded'],
		[data, { ...settings, savePath: '/fixture/other' }, state, 'error.profile_paths_changed'],
		[{ ...data, isStale: true }, settings, state, 'error.profile_stale'],
		[data, settings, { ...state, gameRunning: true }, 'error.save_game_running'],
		[data, settings, { ...state, gameDetectionUncertain: true }, 'error.game_detection_uncertain'],
		[data, settings, { ...state, hasChanges: false }, 'error.save_no_changes']
	];
	for (const [input, paths, status, id] of cases) {
		const reason = profileSaveBlockReason(input, paths, status);
		assert.deepEqual(reason, { id });
		const calls = [];
		const save = createSaveWorkflow({
			blocked: () => reason, validate: () => { calls.push('validate'); return []; },
			confirm: async () => 'cancel', backup: async () => { calls.push('backup'); },
			write: async () => { calls.push('write'); }, saved: () => calls.push('saved'),
			failed: error => calls.push(error), busy: () => {}
		});
		assert.equal(await save(), false);
		assert.deepEqual(calls, [reason]);
		for (const locale of ['en', 'ru']) {
			setEditorLocale(locale);
			assert.ok(describeMessage(reason).trim());
		}
	}
	assert.equal(profileSaveBlockReason(data, settings, state), null);
});

test('store-owned refusals are descriptors and their English messages stay unchanged', () => {
	for (const [actual, id, text] of [
		[store.setHeroName('missing', 'name'), 'store.heroMissing', 'This hero is no longer in the roster.'],
		[store.setHeroTrinket('missing', '0', '', 'inventory'), 'store.heroMissing', 'This hero is no longer in the roster.'],
		[store.setEstateName('name'), 'store.noGame', 'No game data loaded.'],
		[store.reviveHeroes([]), 'store.reviveSelection', 'Select a dead hero to revive.']
	]) {
		assert.deepEqual(actual, { id });
		assert.equal(describeMessage(actual), text);
	}
});

test('manual profile metadata never stores a localized fallback name', () => {
	assert.equal(withCurrentProfile([], '/', '', false)[0].profile_id, '');
	assert.equal(withCurrentProfile([], '/fixture/profile_0', '', false)[0].profile_id, 'profile_0');
});

test('descriptor and legacy action errors both keep the default short toast lifetime', () => {
	const original = toast.error;
	const calls = [];
	toast.error = (component, options) => { calls.push([component, options]); return 1; };
	try {
		showActionError({ id: 'store.heroMissing' });
		assert.deepEqual(calls[0][1].componentProps, { descriptor: { id: 'store.heroMissing' } });
		assert.equal(calls[0][1].duration, undefined);
		assert.equal(calls[0][1].closeButton, undefined);
		showActionError('legacy lane-owned refusal');
		assert.equal(calls[1][0], 'legacy lane-owned refusal');
		assert.equal(calls[1][1]?.duration, undefined);
	} finally { toast.error = original; }
});

test('the transitional action renderer handles unexpected typed errors and malformed values safely', () => {
	assert.equal(describeActionMessage('legacy refusal'), 'legacy refusal');
	assert.equal(describeActionMessage({ id: 'store.heroMissing' }), 'This hero is no longer in the roster.');
	assert.match(describeActionMessage({ code: 'save_stale', params: {}, detail: 'fixture bytes changed' }), /fixture bytes changed/);
	for (const value of [null, undefined, {}, { id: undefined }, { id: 42 }]) {
		assert.match(describeActionMessage(value), /An unexpected error occurred\./);
	}
});

test('About markup remains approved emphasis slots; backup time uses editor Intl', () => {
	for (const id of ['shell.aboutSummary', 'shell.aboutDisclaimer']) {
		const parts = richMessage(id, {});
		assert.deepEqual(parts.filter(p => typeof p !== 'string').map(p => p.tag), ['emphasis']);
	}
	const date = new Date('2026-10-25T10:23:45Z');
	const options = { hour: 'numeric', minute: '2-digit', second: '2-digit' };
	for (const locale of ['en', 'ru']) {
		setEditorLocale(locale);
		assert.equal(formatDate(date, options), new Intl.DateTimeFormat(locale, options).format(date));
	}
});
