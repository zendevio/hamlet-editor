import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { checkRustErrorProducers } from '../scripts/rust-error-contract.mjs';

const server = await createServer({
	configFile: false, cacheDir: 'node_modules/.vite/errors-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const { decodeError, describeError, errorContracts, isStaleSaveError } = await server.ssrLoadModule('/src/lib/errors.ts');
const { describeMessage, setEditorLocale } = await server.ssrLoadModule('/src/lib/i18n/index.svelte.ts');
const { createSaveWorkflow, profileSaveBlockReason } = await server.ssrLoadModule('/src/lib/save-workflow.ts');
const fixtures = JSON.parse(await readFile(new URL('./fixtures/app-errors.json', import.meta.url), 'utf8'));
const english = JSON.parse(await readFile(new URL('../src/lib/i18n/catalogs/en.json', import.meta.url), 'utf8'));
const { readableId } = await server.ssrLoadModule('/src/lib/i18n/core.ts');
const { showError, showPersistentError, dismissError } = await server.ssrLoadModule('/src/lib/i18n/notifications.ts');
const { toast } = await server.ssrLoadModule('svelte-sonner');
const toastCalls = [];
const toastEvents = [];
const originalToastError = toast.error;
const originalToastDismiss = toast.dismiss;
toast.error = (component, options) => { toastCalls.push(options); toastEvents.push(['error', options.id]); return options.id; };
toast.dismiss = (id) => { toastEvents.push(['dismiss', id]); return id; };
after(() => { toast.error = originalToastError; toast.dismiss = originalToastDismiss; });

test('every error code and parameter contract renders with raw detail in every editor locale', () => {
	assert.deepEqual(fixtures.map(({ code }) => code).sort(), Object.keys(errorContracts).sort());
	for (const fixture of fixtures) {
		assert.deepEqual(decodeError(fixture), fixture);
		assert.ok(Object.hasOwn(english, errorContracts[fixture.code].id), fixture.code);
		for (const locale of ['en', 'fr', 'de', 'es', 'it', 'pt-BR', 'pl', 'cs', 'ru', 'zh-Hans', 'ja', 'ko']) {
			setEditorLocale(locale);
			const description = describeError(fixture);
			assert.equal(description.message.id, errorContracts[fixture.code].id);
			const text = describeMessage(description.message);
			assert.ok(text.trim());
			assert.notEqual(text, readableId(description.message.id));
			for (const key of errorContracts[fixture.code].params) assert.ok(text.includes(fixture.params[key]), `${fixture.code}: ${text}`);
			assert.equal(description.detail, fixture.detail);
		}
		for (const key of errorContracts[fixture.code].params) {
			const params = { ...fixture.params }; delete params[key];
			assert.equal(describeError({ ...fixture, params }).message.id, 'error.unexpected');
		}
	}
	setEditorLocale('en');
});

test('compatibility decoder accepts typed, legacy, nested, malformed and circular rejections safely', () => {
	const typed = { code: 'save_stale', params: {}, detail: 'OS diagnostic' };
	for (const value of [typed, { error: typed }, { cause: { data: typed } }, JSON.stringify(typed), new Error('wrapper', { cause: typed })]) {
		assert.deepEqual(decodeError(value), typed);
	}
	for (const value of ['legacy diagnostic', new Error('legacy error'), { unexpected: 'shape' }, undefined, null, 4, Symbol('failure')]) {
		assert.equal(describeError(value).message.id, 'error.unexpected');
		assert.equal(typeof describeError(value).detail, 'string');
	}
	assert.deepEqual(decodeError({ detail: 'outer diagnostic', cause: typed }), { ...typed, detail: 'outer diagnostic\nOS diagnostic' });
	assert.equal(describeError('legacy diagnostic').detail, 'legacy diagnostic');
	assert.equal(describeError({ code: 'future_code', params: {}, detail: 'raw future detail' }).detail, 'raw future detail');
	assert.equal(describeError({ code: 'future_code', params: {}, detail: null }).message.id, 'error.unexpected');
	assert.match(describeError({ code: 'future_code', params: {}, detail: null }).detail, /future_code/);
	assert.equal(describeError({ code: 'file_read', params: { path: {} }, detail: 'raw' }).message.id, 'error.unexpected');
	assert.equal(describeError({ code: 'file_read', params: { path: Infinity }, detail: 'raw' }).message.id, 'error.unexpected');
	const circular = {}; circular.error = circular;
	assert.doesNotThrow(() => describeError(circular));
	assert.doesNotThrow(() => describeError(new Proxy({}, { get() { throw new Error('unreadable'); } })));
	assert.deepEqual(describeError({ id: 'error.profile_stale' }).message, { id: 'error.profile_stale' });
});

test('rollback and restore failures show each recovery location once with copyable diagnostics', () => {
	const failure = { code: 'transaction_rollback', params: { recoveryPath: '/fixture/recovery', backupPath: '/fixture/backup' }, detail: 'original OS error\nrollback OS error' };
	const result = describeError(failure);
	assert.equal(result.message.id, 'error.transaction_rollback');
	assert.match(describeMessage(result.message), /\/fixture\/recovery/);
	assert.deepEqual(result.recovery, [
		{ id: 'error.safety_backup', params: { backupPath: '/fixture/backup' } }
	]);
	assert.equal(result.detail, failure.detail);
	for (const code of ['transaction_rollback', 'backup_rollback']) {
		const description = describeError({ ...failure, code });
		const rendered = [description.message, ...description.recovery].map(describeMessage).join('\n');
		assert.equal(rendered.split('/fixture/recovery').length - 1, 1);
	}
});

test('generic errors keep params and recovery paths even when raw detail is present', () => {
	for (const code of ['future_rollback', 'asset_missing', 'transaction_rollback']) {
		const failure = { code, params: { recoveryPath: '/fixture/recovery', path: '/fixture/file' }, detail: 'OS diagnostic' };
		if (code === 'transaction_rollback') failure.params.recoveryPath = '';
		const result = describeError(failure);
		assert.equal(result.message.id, 'error.unexpected');
		assert.match(result.detail, /OS diagnostic/);
		assert.match(result.detail, /\/fixture\/file/);
		if (code !== 'transaction_rollback') {
			assert.match(result.detail, /\/fixture\/recovery/);
			assert.deepEqual(result.recovery, [{ id: 'error.recovery_files', params: { recoveryPath: '/fixture/recovery' } }]);
		}
	}
	for (const folder of ['', '   ']) {
		const result = describeError({ code: 'settings_io', params: { folder }, detail: 'app data resolution failed' });
		assert.equal(result.message.id, 'error.unexpected');
		assert.match(result.detail, /app data resolution failed/);
		assert.doesNotMatch(describeMessage(result.message), /settings in \./);
	}
});

test('production Rust error constructors match registered codes, fixtures and required params', async () => {
	const root = new URL('../src-tauri/src/', import.meta.url);
	const producers = [];
	for (const path of (await readdir(root, { recursive: true })).filter((path) => path.endsWith('.rs'))) {
		producers.push(...checkRustErrorProducers(await readFile(new URL(path, root), 'utf8'), errorContracts, fixtures, path));
	}
	assert.ok(producers.length > 75, 'must scan production constructors');
	assert.ok(producers.includes('transaction_rollback'));
	for (const [source, failure] of [
		['AppError::new("unknown_code")', /unknown AppError code/],
		['AppError::new("file_read").detail("raw")', /producer missing path/],
		['AppError::new("file_read").param("paht", path)', /unregistered param paht/],
		['AppError::new(code)', /code must be a stable literal/],
		['#[cfg(not(test))] mod production { AppError::new("unknown_code"); }', /unknown AppError code/],
		['#[cfg(any(test, windows))] mod production { AppError::new("file_read"); }', /producer missing path/],
		['g().map_err(|error| error.param("bakupPath", path))', /unregistered param bakupPath/],
		['error.param(key, path)', /param key must be a literal/],
		['AppError { code: "nope", ..error }', /struct literals must use a checked constructor/],
		['#[cfg(not(test))] #[allow(dead_code)] mod production { error.param("bakupPath", p); }', /unregistered param bakupPath/]
	]) assert.throws(() => checkRustErrorProducers(source, errorContracts, fixtures, 'probe.rs'), failure);
	assert.deepEqual(checkRustErrorProducers(`// AppError::new("unknown")
		#[cfg(all(test, unix))] mod tests { AppError::new(dynamic); }
		AppError::new("file_read").param("path", format!("{}", path)).detail("raw ) {}")`, errorContracts, fixtures, 'probe.rs'), ['file_read']);
	assert.deepEqual(checkRustErrorProducers(`
		#[cfg(test)] mod tests;
		#[cfg(test)] #[allow(dead_code)] mod more_tests { AppError::new(dynamic); error.param(dynamic, p); }
		#[cfg(all(test, unix))] #[path = "elsewhere.rs"] mod unix_tests;
		#[cfg(test)] #[allow(dead_code)] pub(crate) mod shared_tests { AppError::new(dynamic); }
		mod production;
		g().map_err(|error| error.param("backupPath", p).param("saveFile", f).param("recoveryPath", r));
		AppError::new("game_running")`, errorContracts, fixtures, 'probe.rs'), ['game_running']);
	assert.deepEqual(checkRustErrorProducers('fn failure() -> AppError { AppError::new("game_running") }',
		errorContracts, fixtures, 'probe.rs'), ['game_running']);
	assert.deepEqual(checkRustErrorProducers('fn failure(code: AppError) -> crate::error::AppError { code }',
		errorContracts, fixtures, 'probe.rs'), []);
	assert.deepEqual(checkRustErrorProducers('pub struct AppError { code: String }',
		errorContracts, fixtures, 'commands\\error.rs'), []);
});

test('ordinary retries dedupe only by operation, code and params and are re-created at the front', () => {
	toastCalls.length = 0;
	toastEvents.length = 0;
	// Each showing gets a fresh id so Sonner mounts a new toast at the front; an
	// identical earlier failure is dismissed rather than updated in its old slot.
	const ids = [];
	for (let index = 0; index < 5; index++) ids.push(showError({ code: 'game_running', detail: `attempt ${index}` }, { id: 'error.saveFailed' }));
	assert.equal(new Set(ids).size, 5);
	assert.deepEqual(toastCalls.map(({ id }) => id), ids);
	assert.equal(toastCalls.at(-1).componentProps.error.detail, 'attempt 4');
	assert.deepEqual(toastEvents, [['error', ids[0]], ...ids.slice(1).flatMap((id, index) => [['dismiss', ids[index]], ['error', id]])]);
	// Replaces the previous showing only when operation, code and params all match.
	const replaces = (show) => {
		toastEvents.length = 0;
		show();
		return toastEvents.some(([kind]) => kind === 'dismiss');
	};
	assert.equal(replaces(() => showError({ code: 'file_read' }, { id: 'error.saveFailed' })), false);
	assert.equal(replaces(() => showError({ code: 'game_running' }, { id: 'error.backupFailed' })), false);
	assert.equal(replaces(() => showError({ code: 'game_running', params: { path: '/a' } }, { id: 'error.saveFailed' })), false);
	showError({ code: 'file_read', params: { path: '/a', name: 'n' } });
	assert.equal(replaces(() => showError({ code: 'file_read', params: { name: 'n', path: '/a' } })), true);
	showError({ code: 'file_read' }, undefined, 'explicit-one');
	assert.equal(replaces(() => showError({ code: 'file_read' }, undefined, 'explicit-two')), false);
	showError('legacy failure');
	assert.equal(replaces(() => showError('new legacy diagnostic')), true);
});

test('recovery files, safety backups and kept copies always receive unique persistent ids', () => {
	for (const key of ['recoveryPath', 'backupPath', 'copy']) {
		const start = toastCalls.length;
		const error = { code: 'future_failure', params: { [key]: '/fixture/recovery' } };
		const first = showError(error, { id: 'error.saveFailed' }, 'explicit-id');
		const second = showError(error, { id: 'error.saveFailed' }, 'explicit-id');
		const later = showError({ code: 'save_stale' }, { id: 'error.saveFailed' }, 'explicit-id');
		assert.equal(new Set([first, second, later]).size, 3);
		assert.ok(toastCalls.slice(start, start + 2).every(({ duration, closeButton }) => duration === Infinity && closeButton));
	}
	const descriptor = { id: 'startup.settingsRecovered', params: { folder: '/fixture', copy: 'settings.corrupt/settings.json' } };
	assert.notEqual(showPersistentError(descriptor, '', 'startup'), showPersistentError(descriptor, '', 'startup'));
});

test('resolving a background operation dismisses its ordinary failures and keeps recovery notices', () => {
	const ordinary = showError({ code: 'file_read', params: { path: '/fixture' } }, undefined, 'background-operation');
	const other = showError({ code: 'game_running' }, undefined, 'background-operation');
	const recovery = showError({ code: 'backup_rollback', params: { recoveryPath: '/fixture/recovery' } }, undefined, 'background-operation');
	toastEvents.length = 0;
	dismissError('background-operation');
	assert.deepEqual(toastEvents, [['dismiss', ordinary], ['dismiss', other]]);
	assert.ok(toastEvents.every(([, id]) => id !== recovery));
	dismissError('background-operation');
	assert.equal(toastEvents.length, 2);
});

test('stale save detection uses protocol codes and a failed workflow retains edits', async () => {
	assert.equal(isStaleSaveError('Save files changed on disk since load'), false);
	assert.equal(isStaleSaveError({ code: 'save_stale', params: {}, detail: 'arbitrary wording' }), true);
	assert.equal(isStaleSaveError({ error: { code: 'save_stale' } }), true);
	assert.equal(isStaleSaveError({ code: 'save_changed_during_load' }), false);
	let stale = false, cleared = false;
	const save = createSaveWorkflow({
		blocked: () => null, validate: () => [], confirm: async () => 'save', backup: async () => {},
		write: async () => { throw { code: 'save_stale', params: {}, detail: 'changed' }; },
		saved: () => { cleared = true; }, failed: (error) => { stale = isStaleSaveError(error); }, busy: () => {}
	});
	assert.equal(await save(), false); assert.equal(stale, true); assert.equal(cleared, false);
	const reason = profileSaveBlockReason({ isLoaded: true, isLoading: false, isStale: true, profilePath: '/p', gamePath: '/g' },
		{ savePath: '/p', gamePath: '/g' }, { isProfileLoading: false, gameRunning: false, gameDetectionUncertain: false, hasChanges: true });
	let failure;
	const blocked = createSaveWorkflow({
		blocked: () => reason, validate: () => [], confirm: async () => 'save', backup: async () => assert.fail('backup'),
		write: async () => assert.fail('write'), saved: () => assert.fail('clear'), failed: (error) => { failure = error; }, busy: () => {}
	});
	assert.equal(await blocked(), false); assert.equal(failure, reason); assert.equal(failure instanceof Error, false);
	assert.equal(describeMessage(describeError(failure).message), 'Save files may have changed. Reload the profile before saving.');
});
