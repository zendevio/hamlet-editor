import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
let handler;
globalThis.window = { __TAURI_INTERNALS__: { invoke: (command, args) => Promise.resolve().then(() => handler(command, args)) } };
const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite/settings-runtime-tests',
	plugins: [svelte({ configFile: false, dynamicCompileOptions: () => ({ generate: 'client' }) })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error' });
after(() => server.close());
const store = await server.ssrLoadModule('/src/lib/stores/settings.svelte.ts');
const i18n = await server.ssrLoadModule('/src/lib/i18n/index.svelte.ts');
const { formatDate } = await server.ssrLoadModule('/src/lib/i18n/intl.ts');
const { effect_root, render_effect, flush } = await server.ssrLoadModule('svelte/internal/client');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const raw = (language = 'de-DE', game = 'russian') => ({ os_locales: { status: 'ok', value: [language] }, game_options: { status: 'ok', value: { language: game, path_kind: 'macos_support', verified: true } }, steam_manifest: { status: 'absent', value: null } });

test('real settings bootstrap, System dates, no reload from editor changes, races, downgrade deletion and setup reset', async () => {
	const disk = { gamePath: '/fixture/game', gameTextLanguage: 'russian', profileId: 'profile_2', autoBackup: true };
	const calls = []; let pending;
	handler = (command, args) => {
		calls.push([command, args]);
		if (command === 'read_settings') return { status: 'ok', values: { ...disk }, folder: '/fixture/settings', fingerprint: null, detail: '' };
		if (command === 'collect_language_evidence') return pending ? pending.promise : raw();
		if (command === 'plugin:store|load') return 1;
		if (command === 'plugin:store|set') { disk[args.key] = args.value; return; }
		if (command === 'plugin:store|delete') { delete disk[args.key]; return true; }
		if (command === 'plugin:store|save') return;
		throw Error(`Unexpected IPC ${command}`);
	};
	assert.equal(store.initializeSettings(), store.initializeSettings());
	await store.initializeSettings(); await tick();
	const settings = store.getSettings();
	assert.equal(settings.editorLanguage, 'system'); assert.equal(i18n.getEditorLocale(), 'de');
	assert.equal(settings.gameTextMode, 'explicit'); assert.equal(settings.gameTextLanguage, 'russian');
	assert.equal(formatDate('2026-10-25T10:00:00Z'), new Intl.DateTimeFormat('de').format(new Date('2026-10-25T10:00:00Z')));
	// Preserve OD2 evidence while System and automatic game modes are selected.
	pending = deferred(); const refreshed = store.refreshLanguageEvidence();
	pending.resolve(raw('tr-TR', 'russian')); await refreshed; flush();
	store.setEditorLanguage('german'); store.setGameTextLanguage('match-game'); flush(); await tick();
	const modes = [];
	const stopModes = effect_root(() => render_effect(() => { modes.push([i18n.getEditorLocale(), settings.gameTextLanguage]); }));
	pending = deferred(); store.setEditorLanguage('system'); flush(); await tick();
	assert.deepEqual(modes, [['de', 'russian'], ['ru', 'russian']]);
	assert.equal(settings.languageEvidencePath, '/fixture/game');
	pending.resolve(raw('tr-TR', 'russian')); await tick(); flush();
	assert.deepEqual(modes, [['de', 'russian'], ['ru', 'russian']]);
	pending = deferred(); store.setGamePath('/fixture/pending'); flush(); await tick();
	assert.equal(settings.languageEvidencePath, '/fixture/game');
	assert.deepEqual(modes, [['de', 'russian'], ['ru', 'russian']]);
	pending.resolve(raw('tr-TR', 'russian')); await tick(); flush();
	assert.equal(settings.languageEvidencePath, '/fixture/pending');
	assert.deepEqual(modes, [['de', 'russian'], ['ru', 'russian']]);
	stopModes();
	pending = deferred(); store.setGamePath('/fixture/unreadable'); flush(); await tick();
	assert.equal(i18n.getEditorLocale(), 'ru'); assert.equal(settings.gameTextLanguage, 'russian');
	pending.reject(Error('fixture detection failed')); await tick(); flush();
	assert.equal(i18n.getEditorLocale(), 'en'); assert.equal(settings.gameTextLanguage, 'english');
	assert.equal(settings.languageEvidencePath, '/fixture/unreadable');
	pending = undefined; await store.refreshLanguageEvidence(); flush();
	store.setGameTextLanguage('russian'); flush(); await tick();
	const requests = [];
	const stop = effect_root(() => render_effect(() => { requests.push(settings.gameTextLanguage); }));
	store.setEditorLanguage('japanese'); flush(); await tick();
	assert.deepEqual(requests, ['russian']);
	store.setGameTextLanguage('same-as-editor'); flush(); await tick();
	assert.equal(settings.gameTextLanguage, 'japanese');
	assert.equal(disk.gameTextMode, 'same-as-editor'); assert.equal(Object.hasOwn(disk, 'gameTextLanguage'), false);
	pending = deferred(); store.setGamePath('/fixture/other');
	const old = pending;
	await tick();
	pending = deferred(); store.setGamePath('/fixture/latest');
	const current = pending;
	await tick();
	store.setEditorLanguage('german'); store.setGameTextLanguage('koreana');
	current.resolve(raw('ja', 'japanese')); await tick(); flush();
	assert.equal(i18n.getEditorLocale(), 'de'); assert.equal(settings.gameTextLanguage, 'koreana');
	old.resolve(raw('ru', 'russian')); await tick(); flush();
	assert.equal(i18n.getEditorLocale(), 'de'); assert.equal(settings.gameTextLanguage, 'koreana');
	pending = undefined; store.resetSetup(); await tick(); flush();
	assert.equal(settings.editorLanguage, 'german'); assert.equal(settings.isSetupComplete, false);
	assert.equal(settings.gameTextMode, 'match-game'); assert.equal(Object.hasOwn(disk, 'gameTextLanguage'), false);
	assert.equal(calls.filter(([command]) => command === 'plugin:store|load').length, 1);
	assert.equal(calls.some(([command]) => ['load_profile', 'save_profile', 'generate_name_table', 'set_name_table'].includes(command)), false);
	stop();
});
