import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const evidence = { os_locales: { status: 'ok', value: ['ru'] }, game_options: { status: 'absent', value: null }, steam_manifest: { status: 'absent', value: null } };
for (const scenario of ['recovered-corrupt', 'io-error', 'read-timeout', 'hanging-read', 'hanging-detection', 'manual-detection-timeout', 'late-corrupt', 'late-recovery', 'recovery-refused', 'transient-read']) {
	test(`M1/F4 real settings startup: ${scenario}`, async (t) => {
		const pending = deferred(); const refresh = deferred(); const calls = []; let detections = 0;
		const disk = { gamePath: '/fixture/game', profileId: 'profile_3', editorLanguage: scenario === 'manual-detection-timeout' ? 'german' : 'system', gameTextMode: 'match-game' };
		globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
			calls.push(command);
			if (command === 'read_settings') {
				if (['io-error', 'transient-read'].includes(scenario)) return { status: 'io_error', folder: '/fixture/settings', detail: 'Settings changed or unreadable' };
				if (scenario === 'read-timeout') throw { kind: 'timeout', folder: '/fixture/settings', detail: 'Settings read deadline elapsed' };
				if (['hanging-read', 'late-corrupt'].includes(scenario)) return pending.promise;
				if (['recovered-corrupt', 'late-recovery', 'recovery-refused'].includes(scenario)) {
					for (const key of Object.keys(disk)) delete disk[key];
					return { status: 'corrupt', values: {}, folder: '/fixture/settings', fingerprint: { size: 1, hash: 'fixture' }, detail: '' };
				}
				return { status: 'ok', values: { ...disk }, folder: '/fixture/settings', fingerprint: null, detail: '' };
			}
			if (command === 'recover_corrupt_settings') {
				assert.deepEqual(args.fingerprint, { size: 1, hash: 'fixture' });
				if (scenario === 'recovery-refused') throw { kind: 'io_error', folder: '/fixture/settings', detail: 'Settings fingerprint changed; recovery refused' };
				return scenario === 'late-recovery' ? pending.promise : 'settings.json.corrupt-123';
			}
			if (command === 'collect_language_evidence') return ++detections > 1 ? refresh.promise : scenario === 'recovered-corrupt' ? evidence : pending.promise;
			if (command === 'plugin:store|load') return 1;
			if (command === 'plugin:store|set') { disk[args.key] = args.value; return; }
			if (command === 'plugin:store|delete') { delete disk[args.key]; return true; }
			if (command === 'plugin:store|save') return;
			throw Error(`Unexpected IPC ${command}`);
		} } };
		const server = await createServer({ configFile: false, cacheDir: `node_modules/.vite/settings-startup-${scenario}`,
			plugins: [svelte({ configFile: false, dynamicCompileOptions: () => ({ generate: 'client' }) })],
			resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
			server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error' });
		t.after(() => server.close());
		const store = await server.ssrLoadModule('/src/lib/stores/settings.svelte.ts');
		const editor = await server.ssrLoadModule('/src/lib/i18n/index.svelte.ts');
		await store.initializeSettings();
		const settings = store.getSettings();
		assert.equal(settings.ready, true); assert.equal(settings.startupNotice, true);
		assert.deepEqual(settings.startupNotices.map(({ id }) => id), [scenario === 'recovered-corrupt' ? 'startup.settingsRecovered'
			: ['io-error', 'transient-read', 'recovery-refused'].includes(scenario) ? 'startup.settingsUnreadable'
			: ['hanging-read', 'read-timeout', 'late-corrupt', 'late-recovery'].includes(scenario) ? 'startup.settingsTimeout' : scenario === 'manual-detection-timeout' ? 'startup.gameTextFallback' : 'startup.languageFallback']);
		if (scenario === 'recovered-corrupt') {
			assert.deepEqual(settings.startupNotices[0].params, { folder: '/fixture/settings', copy: 'settings.json.corrupt-123' });
			assert.equal(settings.isSetupComplete, false);
			assert.equal(editor.getEditorLocale(), 'ru');
		} else if (scenario === 'manual-detection-timeout') {
			assert.equal(editor.getEditorLocale(), 'de');
			assert.equal(settings.editorLanguage, 'german');
			assert.equal(settings.editorResolution.source, 'choice');
			store.setEditorLanguage('system');
			await tick();
			assert.equal(editor.getEditorLocale(), 'de');
			assert.equal(settings.gameTextLanguage, 'german');
			refresh.resolve(evidence);
			await tick();
			assert.equal(editor.getEditorLocale(), 'ru');
			assert.equal(settings.gameTextLanguage, 'russian');
		} else {
			assert.equal(editor.getEditorLocale(), 'en');
			assert.equal(settings.editorResolution.source, 'startup-fallback');
		}
		if (scenario.includes('detection')) assert.equal(settings.profileId, 'profile_3');
		store.setEditorLanguage('japanese'); await tick();
		assert.equal(editor.getEditorLocale(), 'ja');
		pending.resolve(scenario === 'late-recovery' ? 'settings.json.corrupt-late'
			: scenario === 'late-corrupt' ? { status: 'corrupt', values: {}, folder: '/fixture/settings', fingerprint: { size: 1, hash: 'fixture' } }
			: scenario === 'hanging-read' ? { status: 'ok', values: { editorLanguage: 'russian', gamePath: '/late' }, folder: '/fixture/settings', fingerprint: null, detail: '' } : evidence);
		await tick();
		assert.equal(editor.getEditorLocale(), 'ja');
		if (['io-error', 'transient-read', 'recovery-refused', 'read-timeout', 'hanging-read', 'late-corrupt', 'late-recovery'].includes(scenario)) {
			assert.equal(calls.some((command) => command.startsWith('plugin:store|')), false);
			assert.equal(settings.persistenceFailed, true);
			if (!['late-recovery', 'recovery-refused'].includes(scenario)) assert.equal(disk.editorLanguage, 'system');
			assert.equal(calls.includes('collect_language_evidence'), false);
		} else {
			await t.waitFor(() => assert.equal(disk.editorLanguage, 'japanese'));
			assert.equal(settings.persistenceFailed, false);
		}
		assert.equal(calls.includes('recover_corrupt_settings'), ['recovered-corrupt', 'late-recovery', 'recovery-refused'].includes(scenario));
		if (scenario === 'late-recovery') assert.deepEqual(settings.startupNotices.at(-1), { id: 'startup.settingsRecovered', params: { folder: '/fixture/settings', copy: 'settings.json.corrupt-late' } });
		t.diagnostic(`real settings ${scenario}: ${settings.startupElapsedMs.toFixed(1)} ms`);
	});
}
