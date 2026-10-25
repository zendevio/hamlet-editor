import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const server = await createServer({
	configFile: false, cacheDir: 'node_modules/.vite/i18n-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const { createTranslator } = await server.ssrLoadModule('/src/lib/i18n/core.ts');
const { t, setEditorLocale } = await server.ssrLoadModule('/src/lib/i18n/index.svelte.ts');
const { formatNumber, formatDate, formatList } = await server.ssrLoadModule('/src/lib/i18n/intl.ts');

test('I3: missing, empty, syntactically broken and unrenderable text falls back per key', () => {
	const translator = createTranslator({
		en: { missing: 'English', empty: 'English empty', broken: 'English broken', slots: '<link>English link</link>', both: '{bad' },
		ru: { empty: ' ', broken: '{bad', slots: '<unapproved>bad</unapproved>', both: '{also_bad' }
	});
	assert.equal(translator.text('ru', 'missing'), 'English');
	assert.equal(translator.text('ru', 'empty'), 'English empty');
	assert.equal(translator.text('ru', 'broken'), 'English broken');
	assert.equal(translator.text('ru', 'slots'), 'English link');
	assert.equal(translator.text('ru', 'both'), 'both');
	assert.equal(translator.text('ru', 'unknown_mod_id'), 'unknown mod id');
});

test('Russian one/few/many/other and locale-bound Intl helpers', () => {
	setEditorLocale('ru');
	for (const [count, expected] of [[1, '1 файл'], [2, '2 файла'], [5, '5 файлов'], [11, '11 файлов'], [21, '21 файл'], [22, '22 файла'], [1.5, '1,5 файла']]) {
		assert.equal(t('settings.backupFiles', { count, profile: 'profile_0' }), `${expected} · profile_0`);
	}
	setEditorLocale('de');
	assert.equal(formatNumber(1234.5), new Intl.NumberFormat('de').format(1234.5));
	assert.equal(formatDate('not a timestamp'), 'not a timestamp');
	assert.equal(formatList(['a', 'b']), new Intl.ListFormat('de').format(['a', 'b']));
	setEditorLocale('en');
});
