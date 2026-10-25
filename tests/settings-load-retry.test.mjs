import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

test('F3/F11 real startup preserves future keys and retries a rejected first LazyStore load', async (t) => {
	const disk = { editorLanguage: 'ukrainian', gameTextMode: 'future-mode', gameTextLanguage: 'russian' };
	let loads = 0;
	const calls = [];
	globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
		calls.push(command);
		if (command === 'read_settings') return { status: 'ok', values: { ...disk }, folder: '/fixture/settings', fingerprint: null, detail: '' };
		if (command === 'collect_language_evidence') return { os_locales: { status: 'ok', value: ['en'] }, game_options: { status: 'absent', value: null }, steam_manifest: { status: 'absent', value: null } };
		if (command === 'plugin:store|load') { if (++loads === 1) throw Error('transient load failure'); return 1; }
		if (command === 'plugin:store|set') { disk[args.key] = args.value; return; }
		if (command === 'plugin:store|delete') { delete disk[args.key]; return true; }
		if (command === 'plugin:store|save') return;
		throw Error(`Unexpected IPC ${command}`);
	} } };
	const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite/settings-load-retry',
		plugins: [svelte({ configFile: false, dynamicCompileOptions: () => ({ generate: 'client' }) })],
		resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
		server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error' });
	t.after(() => server.close());
	const store = await server.ssrLoadModule('/src/lib/stores/settings.svelte.ts');
	await store.initializeSettings();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls.some((command) => command.startsWith('plugin:store|')), false);
	assert.deepEqual(disk, { editorLanguage: 'ukrainian', gameTextMode: 'future-mode', gameTextLanguage: 'russian' });
	store.setEditorLanguage('german');
	await t.waitFor(() => assert.equal(store.getSettings().persistenceFailed, true));
	assert.equal(loads, 1);
	store.setEditorLanguage('japanese');
	await t.waitFor(() => { assert.equal(disk.editorLanguage, 'japanese'); assert.equal(store.getSettings().persistenceFailed, false); });
	assert.equal(loads, 2);
	assert.equal(disk.gameTextMode, 'future-mode');
	store.setGameTextLanguage('same-as-editor');
	await t.waitFor(() => assert.equal(disk.gameTextMode, 'same-as-editor'));
	assert.equal(loads, 2);
	assert.equal(Object.hasOwn(disk, 'gameTextLanguage'), false);
});
