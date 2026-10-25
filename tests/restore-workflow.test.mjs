import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error' });
after(() => server.close());
const { runRestore, restoreOutcome } = await server.ssrLoadModule('/src/lib/restore-workflow.ts');
const { createUnsavedGuard } = await server.ssrLoadModule('/src/lib/save-workflow.ts');
const { createTranslator } = await server.ssrLoadModule('/src/lib/i18n/core.ts');
const catalogs = Object.fromEntries(await Promise.all(['en', 'ru'].map(async locale => [locale, JSON.parse(await readFile(new URL('../src/lib/i18n/catalogs/' + locale + '.json', import.meta.url), 'utf8'))])));
const translator = createTranslator(catalogs);
const allowed = { adds: 1, removes: 0, blocked_reason: null };
const blocked = { ...allowed, blocked_reason: 'Quit Steam' };

function flow(checks, choice = 'discard', saved = true, dirty = true) {
	const calls = [];
	let index = 0;
	const guard = createUnsavedGuard({
		hasChanges: () => dirty,
		choose: async () => { calls.push('prompt'); return choice; },
		save: async () => { calls.push('save'); return saved; },
		discard: () => calls.push('discard')
	});
	const run = () => runRestore({
		check: async () => {
			calls.push('check');
			const result = checks[index++];
			if (result instanceof Error) throw result;
			return result;
		},
		checked: () => calls.push('checked'),
		blocked: () => calls.push('reopen'),
		requestDataChange: (action, preflight) => { calls.push('request'); return guard(action, preflight); },
		restore: async () => { calls.push('restore'); },
		reload: async () => { calls.push('reload'); }
	});
	return { calls, run };
}

test('restore checks before the prompt and again before discard', async () => {
	const f = flow([allowed, allowed]);
	assert.equal(await f.run(), true);
	assert.deepEqual(f.calls, ['check', 'checked', 'request', 'prompt', 'check', 'checked', 'discard', 'restore', 'reload']);
});

test('blocked or failed checks never discard, including changes during the prompt', async () => {
	for (const position of [0, 1]) {
		for (const failure of [blocked, new Error('detection failed')]) {
			const f = flow(position ? [allowed, failure] : [failure]);
			if (failure instanceof Error) await assert.rejects(f.run, /detection failed/);
			else {
				assert.equal(await f.run(), false);
				assert.ok(f.calls.includes('reopen'));
			}
			assert.ok(!f.calls.includes('discard'));
			assert.ok(!f.calls.includes('restore'));
			assert.equal(f.calls.includes('prompt'), position === 1);
		}
	}
});

test('Save rechecks after saving; Cancel and failed Save do not continue', async () => {
	const f = flow([allowed, allowed], 'save');
	assert.equal(await f.run(), true);
	assert.deepEqual(f.calls, ['check', 'checked', 'request', 'prompt', 'save', 'check', 'checked', 'restore', 'reload']);
	for (const [choice, saved] of [['cancel', true], ['save', false]]) {
		const stopped = flow([allowed], choice, saved);
		assert.equal(await stopped.run(), false);
		assert.ok(!stopped.calls.includes('restore'));
		assert.equal(stopped.calls.filter(c => c === 'check').length, 1);
	}
	const blockedAfterSave = flow([allowed, blocked], 'save');
	assert.equal(await blockedAfterSave.run(), false);
	assert.ok(!blockedAfterSave.calls.includes('restore'));
});

test('clean profiles also recheck before restore', async () => {
	const f = flow([allowed, allowed], 'discard', true, false);
	assert.equal(await f.run(), true);
	assert.deepEqual(f.calls, ['check', 'checked', 'request', 'check', 'checked', 'restore', 'reload']);
});

test('outcomes pluralize each count and omit zero parts', () => {
	for (const [adds, removes, expected] of [
		[0, 0, 'is overwrite-only'], [1, 0, 'adds 1 file'], [0, 1, 'removes 1 file'],
		[2, 1, 'adds 2 files and removes 1 file'], [1, 2, 'adds 1 file and removes 2 files']
	]) {
		const descriptor = restoreOutcome({ adds, removes, blocked_reason: null });
		assert.deepEqual(descriptor, { id: 'settings.restoreOutcome', params: { adds, removes, addsText: adds } });
		assert.equal(translator.text('en', descriptor.id, descriptor.params), `This restore ${expected}.`);
	}
	assert.equal(restoreOutcome(null), null);
});

test('unknown, malformed and legacy blocker presence keeps restore disabled before any discard or write', async () => {
	for (const reason of [{ code: 'future_blocker', params: {}, detail: 'raw refusal' }, {}, 'legacy refusal', '', false, 0]) {
		for (const position of [0, 1]) {
			const refusal = { ...allowed, blocked_reason: reason };
			const f = flow(position ? [allowed, refusal] : [refusal]);
			assert.equal(await f.run(), false);
			assert.equal(f.calls.includes('restore'), false);
			assert.equal(f.calls.includes('discard'), false);
			assert.equal(f.calls.includes('reopen'), true);
		}
	}
});

test('restore descriptors use the real Russian one, few and many catalog branches', () => {
	for (const [count, ending] of [[1, 'файл'], [2, 'файла'], [5, 'файлов'], [21, 'файл'], [22, 'файла']]) {
		for (const [adds, removes, expected] of [
			[count, 0, `Восстановление добавит ${count} ${ending}.`],
			[0, count, `Восстановление удалит ${count} ${ending}.`],
			[count, count, `Восстановление добавит ${count} ${ending} и удалит ${count} ${ending}.`]
		]) {
			const descriptor = restoreOutcome({ adds, removes, blocked_reason: null });
			assert.equal(translator.text('ru', descriptor.id, descriptor.params), expected);
		}
	}
});
