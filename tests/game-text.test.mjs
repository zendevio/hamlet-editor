import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let invoke;
globalThis.window = { __TAURI_INTERNALS__: { invoke: (command, args) => invoke(command, args) } };
const server = await createServer({
	configFile: false, cacheDir: 'node_modules/.vite/game-text-tests',
	// Use client runes so the observer tracks actual store identity changes;
	// response getters below flush before a complete table can be published.
	plugins: [svelte({ configFile: false, dynamicCompileOptions: () => ({ generate: 'client' }) })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const game = await server.ssrLoadModule('/src/lib/stores/game-data.svelte.ts');
const text = await server.ssrLoadModule('/src/lib/stores/game-text.svelte.ts');
const { effect_root, render_effect, flush } = await server.ssrLoadModule('svelte/internal/client');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

test('game text swaps table identity once after complete success and never on stale/failure/empty loads', async () => {
	game.resetGameData();
	game.setNameTable({ first: 'en:first', second: 'en:second' }, 'english', '/old');
	const state = game.getGameData();
	const observations = [];
	const stop = effect_root(() => render_effect(() => {
		observations.push({ table: state.nameTable, first: game.localize('first'), second: game.localize('second'), language: state.displayLanguage, path: state.displayGamePath });
	}));
	const calls = [];
	let pending;
	invoke = (command, args) => {
		assert.equal(command, 'load_localization');
		calls.push(args);
		pending = deferred();
		return pending.promise;
	};
	const original = state.nameTable;
	text.requestGameText('/game', 'russian');
	const stale = pending;
	text.requestGameText('/game', 'japanese');
	const current = pending;
	flush();
	assert.equal(observations.length, 1);
	assert.equal(state.nameTable, original);
	// Inspect state between reads of each incoming entry. No partial table may
	// become visible while filtering the response, even inside one microtask.
	const incoming = Object.fromEntries(['first', 'second'].map((key) => [key, `ja:${key}`]));
	for (const key of Object.keys(incoming)) {
		Object.defineProperty(incoming, key, { enumerable: true, get() {
			flush();
			assert.equal(state.nameTable, original);
			assert.equal(observations.length, 1);
			return `ja:${key}`;
		} });
	}
	current.resolve({ table: incoming, english: { first: 'English first' } });
	await tick();
	flush();
	assert.equal(observations.length, 2);
	assert.notEqual(state.nameTable, original);
	assert.deepEqual(observations[1], { table: state.nameTable, first: 'ja:first', second: 'ja:second', language: 'japanese', path: '/game' });
	assert.equal(game.localizeEnglish('first'), 'English first');
	const applied = state.nameTable;
	stale.resolve({ table: { first: 'ru:first', second: 'ru:second' }, english: { first: 'Stale English' } });
	await tick();
	flush();
	assert.equal(observations.length, 2);
	assert.equal(game.localizeEnglish('first'), 'English first');
	for (const failure of ['rejection', 'empty']) {
		text.requestGameText('/game', failure === 'empty' ? 'polish' : 'koreana');
		if (failure === 'empty') pending.resolve({ table: {}, english: {} });
		else pending.reject(new Error('unreadable /game'));
		await tick();
		flush();
		assert.equal(state.nameTable, applied);
		assert.equal(game.localizeEnglish('first'), 'English first');
		assert.equal(observations.length, 2);
		assert.equal(text.getGameTextState().error, true);
		assert.equal(text.getGameTextState().errorDetail, failure === 'empty' ? 'Error: Empty game text table' : 'Error: unreadable /game');
	}
	text.requestGameText('/new-game', 'german');
	pending.resolve({ table: { first: 'de:first', second: 'de:second' }, english: {} });
	await tick();
	flush();
	assert.equal(observations.length, 3);
	assert.notEqual(state.nameTable, applied);
	assert.equal(game.localizeEnglish('first'), 'First');
	assert.equal(text.getGameTextState().errorDetail, '');
	text.requestGameText('/new-game', 'english');
	pending.resolve({ table: { first: 'English table alias', second: 'English second' }, english: null });
	await tick();
	flush();
	assert.equal(observations.length, 4);
	assert.equal(game.localizeEnglish('first'), 'English table alias');
	assert.equal(game.getGameData().displayLanguage, 'english');
	assert.deepEqual(calls.map(({ language }) => language), ['russian', 'japanese', 'koreana', 'polish', 'german', 'english']);
	stop();
});
