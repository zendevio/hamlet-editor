import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let invokeHandler;
globalThis.window = { __TAURI_INTERNALS__: {
	invoke: (command, args) => command.startsWith('plugin:store|')
		? Promise.resolve(undefined)
		: Promise.resolve().then(() => invokeHandler(command, args))
} };
const server = await createServer({
	configFile: false,
	cacheDir: 'node_modules/.vite/profile-loading-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false },
	appType: 'custom',
	logLevel: 'error'
});
after(() => server.close());
const store = await server.ssrLoadModule('/src/lib/stores/save-data.svelte.ts');
const settings = await server.ssrLoadModule('/src/lib/stores/settings.svelte.ts');
const { saveProfile } = await server.ssrLoadModule('/src/lib/api/save.ts');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}
function loaded(path) {
	return { data: { 'persist.game.json': { base_root: { estatename: path, inraid: false, game_mode: 'radiant' } } }, name_table_version: 7 };
}

test('startup waits for name generation AND publication; switches and restores use the same barrier', async () => {
	const generation = deferred();
	const publication = deferred();
	const calls = [];
	invokeHandler = (command, args) => {
		calls.push([command, args]);
		if (command === 'generate_name_table') return generation.promise;
		if (command === 'set_name_table') return publication.promise;
		if (command === 'load_profile') return loaded(args.profilePath);
		throw new Error(`Unexpected command: ${command}`);
	};
	settings.setGamePath('/fixtures/game');
	const initialLoad = store.loadProfileFromBackend('/profiles/profile_0');
	await tick();
	assert.deepEqual(calls.map(([command]) => command), ['generate_name_table']);
	assert.equal(store.getSaveData().isLoading, true);
	assert.equal(store.getSaveData().isLoaded, false);
	generation.resolve(['abbey.meditation']);
	await tick();
	assert.deepEqual(calls.map(([command]) => command), ['generate_name_table', 'set_name_table']);
	publication.resolve();
	await initialLoad;
	assert.equal(store.getSaveData().nameTableVersion, 7);
	assert.equal(store.getSaveData().isLoading, false);
	await store.loadProfileFromBackend('/profiles/profile_1');
	store.markProfileStale();
	assert.equal(store.getSaveData().isStale, true);
	await store.loadProfileFromBackend('/profiles/profile_1');
	assert.equal(store.getSaveData().isStale, false);
	assert.deepEqual(calls.map(([command]) => command), [
		'generate_name_table', 'set_name_table', 'load_profile', 'load_profile', 'load_profile'
	]);
	assert.equal(store.getSaveData().profilePath, '/profiles/profile_1');
});

test('failed or empty name generation cannot decode or retain a writable profile', async () => {
	for (const mode of ['failure', 'empty', 'publication']) {
		settings.setGamePath(`/fixtures/${mode}`);
		const calls = [];
		invokeHandler = (command) => {
			calls.push(command);
			if (command === 'generate_name_table') {
				if (mode === 'failure') throw new Error('Cannot read game data');
				return mode === 'empty' ? [] : ['abbey.meditation'];
			}
			if (command === 'set_name_table') throw new Error('Cannot publish name table');
			throw new Error(`Unexpected command: ${command}`);
		};
		await assert.rejects(store.loadProfileFromBackend('/profiles/profile_0'));
		assert.equal(calls.includes('load_profile'), false);
		assert.equal(store.getSaveData().isLoaded, false);
		assert.equal(store.getSaveData().nameTableVersion, 0);
		assert.equal(store.getSaveData().isLoading, false);
	}
});

test('overlapping loads share initialization and only the latest profile populates the store', async () => {
	const generation = deferred();
	const calls = [];
	settings.setGamePath('/fixtures/concurrent-game');
	invokeHandler = (command, args) => {
		calls.push([command, args]);
		if (command === 'generate_name_table') return generation.promise;
		if (command === 'set_name_table') return;
		if (command === 'load_profile') return loaded(args.profilePath);
		throw new Error(`Unexpected command: ${command}`);
	};
	const first = store.loadProfileFromBackend('/profiles/profile_0');
	const second = store.loadProfileFromBackend('/profiles/profile_1');
	generation.resolve(['abbey.meditation']);
	await Promise.all([first, second]);
	assert.equal(calls.filter(([command]) => command === 'generate_name_table').length, 1);
	assert.deepEqual(calls.filter(([command]) => command === 'load_profile').map(([, args]) => args.profilePath), ['/profiles/profile_1']);
	assert.equal(store.getSaveData().game.base_root.estatename, '/profiles/profile_1');
});

test('save passes the version from the loaded profile to the backend guard', async () => {
	let received;
	invokeHandler = (command, args) => { received = [command, args]; };
	await saveProfile('/profiles/profile_1', { 'persist.game.json': { test: 1 } }, 7);
	assert.deepEqual(received, ['save_profile', {
		profilePath: '/profiles/profile_1', data: { 'persist.game.json': { test: 1 } }, nameTableVersion: 7
	}]);
});
