import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite/language-settings-tests',
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error' });
after(() => server.close());
const lang = await server.ssrLoadModule('/src/lib/i18n/language-resolution.ts');
const core = await server.ssrLoadModule('/src/lib/stores/settings-core.ts');
const { createBootstrap, BOOTSTRAP_TIMEOUT_MS } = await server.ssrLoadModule('/src/lib/i18n/bootstrap.ts');
const evidence = (os = [], options = null, steam = null) => ({
	os_locales: { status: 'ok', value: os },
	game_options: { status: options === null ? 'absent' : 'ok', value: options === null ? null : { language: options, path_kind: 'fixture', verified: false } },
	steam_manifest: { status: steam === null ? 'absent' : 'ok', value: steam }
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('D2 OS preference fixtures: scripts win, unsupported entries skip, and encoding is removed', () => {
	for (const [raw, expected] of [
		['zh-Hans-TW', 'schinese'], ['zh-Hant-CN', undefined], ['zh-Hant', undefined],
		['zh-CN', 'schinese'], ['zh-SG', 'schinese'], ['zh-MY', 'schinese'], ['zh', 'schinese'],
		['zh-TW', undefined], ['zh-HK', undefined], ['zh-MO', undefined], ['zh-Latn-CN', undefined],
		['de_DE.UTF-8', 'german'], ['ru_RU.UTF-8', 'russian'], ['ja-JP', 'japanese'], ['ko-KR', 'koreana'],
		['pt-PT', 'brazilian'], ['pt-AO', 'brazilian'], ['es-MX', 'spanish'], ['es-AR', 'spanish'],
		['en-GB', 'english'], ['fr-CA', 'french'], ['it-IT', 'italian'], ['pl-PL', 'polish'], ['cs-CZ', 'czech'],
		['C', undefined], ['C.UTF-8', undefined], ['POSIX', undefined], ['ar', undefined], ['tr-TR', undefined]
	]) assert.equal(lang.osLanguage(raw), expected, raw);
	assert.deepEqual(lang.resolveEditor('system', evidence(['zh-Hant-CN', 'tr', 'de_DE.UTF-8', 'ja'])), { language: 'german', source: 'system' });
	assert.deepEqual(lang.resolveEditor('system', evidence(['ru', 'de'], 'japanese')), { language: 'russian', source: 'system' });
});

test('D2 final OD2 uses raw game evidence only after all OS preferences are unsupported', () => {
	for (const [options, steam, language, source] of [
		['japanese', 'russian', 'japanese', 'game'], ['default', 'latam', 'spanish', 'game'],
		['unknown', 'german', 'german', 'game'], [null, 'tchinese', 'english', 'english'],
		['default', 'unknown', 'english', 'english'], [null, null, 'english', 'english']
	]) assert.deepEqual(lang.resolveEditor('system', evidence(['C', 'zh-Hant', 'ar'], options, steam)), { language, source });
	for (const status of ['absent', 'unreadable', 'timed_out']) {
		const raw = evidence(['ja'], 'russian', 'german');
		raw.os_locales.status = raw.game_options.status = raw.steam_manifest.status = status;
		assert.deepEqual(lang.resolveEditor('system', raw), { language: 'english', source: 'english' });
		assert.deepEqual(lang.resolveGameText('match-game', undefined, 'japanese', raw), { language: 'japanese', source: 'editor-fallback' });
	}
});

test('D2 Match game prioritizes options then Steam then editor; all 12 are supported', () => {
	for (const language of ['english', 'french', 'german', 'spanish', 'italian', 'brazilian', 'polish', 'czech', 'russian', 'schinese', 'japanese', 'koreana']) {
		assert.equal(lang.resolveGameText('match-game', undefined, 'english', evidence([], language)).language, language);
	}
	assert.deepEqual(lang.resolveGameText('match-game', undefined, 'japanese', evidence([], 'russian', 'german')), { language: 'russian', source: 'game-settings' });
	assert.deepEqual(lang.resolveGameText('match-game', undefined, 'japanese', evidence([], 'default', 'latam')), { language: 'spanish', source: 'steam' });
	assert.deepEqual(lang.resolveGameText('match-game', undefined, 'japanese', evidence([], 'unknown', 'tchinese')), { language: 'japanese', source: 'editor-fallback' });
	assert.deepEqual(lang.resolveGameText('same-as-editor', undefined, 'japanese', evidence([], 'russian')), { language: 'japanese', source: 'editor' });
	assert.deepEqual(lang.resolveGameText('explicit', 'koreana', 'japanese', evidence([], 'russian')), { language: 'koreana', source: 'choice' });
});

test('D2 per-platform raw provenance does not change resolution or claim verification', () => {
	for (const [path_kind, verified] of [['macos_support', true], ['windows_documents', false], ['linux_data', false], ['proton_documents', false]]) {
		const raw = evidence([], 'russian'); raw.game_options.value = { language: 'russian', path_kind, verified };
		assert.deepEqual(lang.resolveEditor('system', raw), { language: 'russian', source: 'game' });
		assert.deepEqual(lang.resolveGameText('match-game', undefined, 'english', raw), { language: 'russian', source: 'game-settings' });
	}
});

test('D2a Phase A migration, invalid settings and downgrade-safe automatic modes', () => {
	assert.equal(core.migrateSettings({ gameTextLanguage: 'russian' }).gameTextMode, 'explicit');
	assert.equal(core.migrateSettings({}).gameTextMode, 'match-game');
	for (const mode of ['match-game', 'same-as-editor']) {
		const settings = core.migrateSettings({ gameTextMode: mode, gameTextLanguage: 'russian' });
		assert.equal(settings.gameTextLanguage, undefined);
		assert.equal(core.startupMigrationPatch({ gameTextMode: mode, gameTextLanguage: 'russian' }).gameTextLanguage, undefined);
	}
	for (const value of ['unknown', 3, {}, false, null]) {
		const invalid = [];
		const settings = core.migrateSettings({ editorLanguage: value, gameTextMode: value, gameTextLanguage: value, gamePath: value, autoBackup: value }, (key) => invalid.push(key));
		assert.equal(settings.editorLanguage, 'system');
		assert.equal(settings.gameTextMode, 'match-game');
		assert.ok(invalid.includes('editorLanguage'));
		assert.ok(invalid.includes('gameTextMode'));
	}
	assert.equal(core.migrateSettings({ gameTextMode: 'explicit', gameTextLanguage: 'bogus' }).gameTextMode, 'match-game');
	assert.equal(core.migrateSettings({ gameTextMode: 'bogus', gameTextLanguage: 'german' }).gameTextMode, 'explicit');
	assert.equal(core.migrateSettings({ isSetupComplete: 'true' }).isSetupComplete, false);
});

test('F3 startup migration only writes the two Phase A compatibility cases', () => {
	assert.deepEqual(core.startupMigrationPatch({ gameTextLanguage: 'russian' }), { gameTextMode: 'explicit' });
	for (const mode of ['match-game', 'same-as-editor']) {
		assert.deepEqual(core.startupMigrationPatch({ gameTextMode: mode, gameTextLanguage: 'ukrainian' }), { gameTextLanguage: undefined });
	}
	for (const raw of [{}, { editorLanguage: 'ukrainian' }, { gameTextMode: 'future-mode', gameTextLanguage: 'russian' },
		{ gameTextMode: 'explicit', gameTextLanguage: 'ukrainian' }, { gameTextLanguage: 'ukrainian' },
		{ editorLanguage: null, gameTextMode: null, gameTextLanguage: 'russian' }]) {
		const before = structuredClone(raw);
		assert.deepEqual(core.startupMigrationPatch(raw), {});
		core.migrateSettings(raw);
		assert.deepEqual(raw, before);
	}
});

test('D2b one writer coalesces rapid choices and serializes revisions including delete on automatic', async () => {
	const first = deferred(); const calls = []; const disk = {}; let saves = 0; let active = 0; let maximum = 0;
	const store = { async set(key, value) { calls.push([key, value]); disk[key] = value; }, async delete(key) { calls.push([key]); delete disk[key]; },
		async save() { maximum = Math.max(maximum, ++active); if (++saves === 1) await first.promise; active--; } };
	const writer = core.createSettingsWriter(async () => store, assert.fail);
	writer.enable();
	writer.write({ editorLanguage: 'russian' }); writer.write({ editorLanguage: 'japanese' });
	await tick();
	writer.write({ editorLanguage: 'german', gameTextLanguage: 'russian', gameTextMode: 'explicit' });
	writer.write({ gameTextMode: 'match-game', gameTextLanguage: undefined });
	first.resolve(); await writer.flush();
	assert.deepEqual(disk, { editorLanguage: 'german', gameTextMode: 'match-game' });
	assert.equal(calls[0][1], 'japanese');
	assert.equal(calls.some(([, value]) => value === 'russian'), false);
	assert.equal(writer.persistedRevision, writer.revision);
	assert.equal(maximum, 1);
});

test('D2b failed writes keep pending keys for retry and failed reads never enable persistence', async () => {
	let failed = 0; let attempts = 0; const disk = {};
	const writer = core.createSettingsWriter(async () => ({ async set(key, value) { disk[key] = value; }, async delete(key) { delete disk[key]; }, async save() { if (++attempts === 1) throw Error('denied'); } }), () => { failed++; });
	writer.write({ gamePath: 'must not write' }); await writer.flush();
	assert.deepEqual(disk, {}); assert.equal(attempts, 0);
	writer.enable(); writer.write({ editorLanguage: 'japanese' }); await writer.flush();
	assert.equal(writer.persistedRevision, 0);
	writer.write({ gameTextMode: 'same-as-editor' }); await writer.flush();
	assert.deepEqual(disk, { editorLanguage: 'japanese', gameTextMode: 'same-as-editor' });
	assert.equal(failed, 2);
});

test('D9 one idempotent bootstrap, total production timeout measured, late read suppressed', async (t) => {
	let calls = 0; const read = deferred();
	const start = performance.now(); const bootstrap = createBootstrap(() => { calls++; return read.promise; });
	const first = bootstrap(); assert.equal(bootstrap(), first);
	const result = await first;
	assert.equal(result.status, 'timeout'); assert.equal(calls, 1);
	assert.ok(result.elapsedMs >= BOOTSTRAP_TIMEOUT_MS - 30 && result.elapsedMs < BOOTSTRAP_TIMEOUT_MS + 500);
	read.resolve({ editorLanguage: 'japanese' }); await tick();
	assert.equal(await bootstrap(), result);
	t.diagnostic(`Production bootstrap deadline ${result.elapsedMs.toFixed(1)} ms; wall ${(performance.now() - start).toFixed(1)} ms`);
});

test('D9 corrupt read errors, late detection, success and rejection are terminal per launch', async () => {
	const error = await createBootstrap(async () => { throw Error('invalid JSON'); }, 20)();
	assert.equal(error.status, 'error');
	const late = deferred(); const bootstrap = createBootstrap(async () => { await Promise.resolve({}); return late.promise; }, 20);
	const result = await bootstrap(); late.resolve(evidence(['ja'])); await tick();
	assert.equal(result.status, 'timeout'); assert.equal(await bootstrap(), result);
	const success = createBootstrap(async () => 'catalog ready', 20);
	assert.equal((await success()).value, 'catalog ready');
});

test('D2 stale path completions suppressed, late automatic evidence cannot replace manual choice', async () => {
	const sequence = lang.createDetectionSequence(); let state = evidence(['en']); let choice = 'system';
	const old = sequence.next(); const current = sequence.next();
	const apply = (request, raw) => { if (sequence.isCurrent(request)) state = raw; return lang.resolveEditor(choice, state); };
	assert.equal(apply(current, evidence(['ja'])).language, 'japanese');
	assert.equal(apply(old, evidence(['ru'])).language, 'japanese');
	choice = 'german';
	assert.deepEqual(apply(current, evidence(['ru'])), { language: 'german', source: 'choice' });
});

test('D2b a choice arriving at batch completion cannot be stranded behind the completed promise', async () => {
	const disk = {}; let saves = 0; let writer;
	writer = core.createSettingsWriter(async () => ({
		async set(key, value) { disk[key] = value; }, async delete(key) { delete disk[key]; }, async save() { saves++; }
	}), assert.fail, () => { if (saves === 1) queueMicrotask(() => writer.write({ editorLanguage: 'japanese' })); });
	writer.enable(); writer.write({ editorLanguage: 'russian' });
	await tick(); await writer.flush();
	assert.equal(disk.editorLanguage, 'japanese'); assert.equal(saves, 2);
	assert.equal(writer.persistedRevision, writer.revision);
});
