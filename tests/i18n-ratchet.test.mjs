import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkSettingsCopy } from '../scripts/i18n-ratchet.mjs';
import { checkAllowlist, countCopy } from '../scripts/i18n-ratchet.mjs';

test('per-file exemptions expire when a literal disappears and cannot hide visible markup', () => {
	const allowlist = { files: { 'src/View.svelte': { Manual: 'Protocol source value.' } } };
	checkAllowlist({ 'src/View.svelte': new Set(['Manual']) }, allowlist);
	assert.throws(() => checkAllowlist({ 'src/View.svelte': new Set() }, allowlist), /Stale copy allowlist entries/);
	assert.throws(() => checkAllowlist({}, allowlist), /Stale copy allowlist entries/);
	assert.equal(countCopy('<script>const source = "Manual";</script>', 'src/View.svelte', [], allowlist).length, 0);
	assert.deepEqual(countCopy('<script>const source = "Manual";</script><span>Manual</span><input aria-label="Manual" />', 'src/View.svelte', [], allowlist), ['Manual', 'Manual']);
	for (const source of ["<span>{'Manual'}</span>", "<input aria-label={'Manual'} />", '<span>{`Manual`}</span>', '<input aria-label={`Manual`} />', '<script lang="ts"></script><span>{"Manual" as string}</span>', '<span>{`Manual ${value}`}</span>']) {
		assert.deepEqual(countCopy(source, 'src/View.svelte', [], allowlist), ['Manual']);
	}
});


test('markup exemptions cannot hide conditional branches, logical operands, template quasis or string wrappers', () => {
	const allowlist = { files: { 'src/View.svelte': { Manual: 'Protocol source value.' } } };
	for (const expression of [
		"busy ? 'Manual' : label", "busy ? label : 'Manual'", "label ?? 'Manual'", "label || 'Manual'",
		"label && 'Manual'", "'Manual' || label", "'Manual' && label", "'Manual' ?? label",
		"busy ? `Manual` : label", "busy ? label : `Manual ${value}`", "`Manual ${label}`",
		"`${busy ? 'Manual' : label}`", "String('Manual')"
	]) {
		for (const source of [`<span>{${expression}}</span>`, `<input aria-label={${expression}} />`, `<div title={${expression}}></div>`]) {
			assert.deepEqual(countCopy(source, 'src/View.svelte', [], allowlist), ['Manual'], source);
		}
	}
	assert.deepEqual(countCopy("<span>{value === 'Manual' ? label : other}</span>", 'src/View.svelte', [], allowlist), []);
});

const check = (source) => checkSettingsCopy(source, ['settings.selectProfile', 'common.close']);
test('Settings copy ratchet covers expressions, templates, component props and script toasts', () => {
	for (const source of [
		"<span>{profile || 'Select a profile...'}</span>",
		'<span>{`Select ${profile}`}</span>',
		'<DialogContent closeLabel="Close" />',
		'<EmptyState description={"Choose a profile"} />',
		'<Input aria-label="Profile" />',
		'<DialogContent closeLabel="Закрыть" />',
		'<script>toast.error("Could not load profile")</script>',
		'<script>toast("Backup created")</script>',
		"<script>open({ directory: true, title: 'Select save file folder' })</script>",
		"<script>open({ title: `Select ${folder}` })</script>",
		"<script>showPersistentError({ id: 'common.close' }, 'literal detail')</script>",
		"<script>const label = 'Select a profile';</script><p>{label}</p>",
		"<script>let label = $state('Development');</script><p>{label}</p>",
		"{#if true}{@const label = 'Select a profile'}<p>{label}</p>{/if}",
		'<script>toast.error(t("common.close"), { description: `Failed ${path}` })</script>',
		"<button onclick={() => toast.error('Save failed badly')}>Save</button>",
		"<button on:click={() => toast.error('Copied badly')}>Save</button>",
		"{#each [{ label: 'Each label copy' }] as item}<p>{item.label}</p>{/each}",
		"{@render s('Rendered copy')}",
		"{#await Promise.resolve('Await copy')}<p></p>{/await}",
		"{#key 'Key copy'}<p></p>{/key}",
		"{@html 'HTML copy'}",
		"<Button {...{ title: 'Spread copy' }} />",
		'<input use:tooltip={"Use copy"} />',
		'<div {@attach tooltip("Attach copy")}></div>',
		'<div transition:fade={{ label: "Transition copy" }}></div>',
		'{#each rows as row (row.id)}<div animate:flip={{ label: "Animate copy" }}></div>{/each}',
		'{#snippet row(label = "Snippet default")}<p>{label}</p>{/snippet}',
		'<script lang="ts">enum Labels { Main = "Enum copy" }</script>',
		...['submit', 'button', 'reset'].map((type) => `<input type="${type}" value="Submit copy" />`),
		'<input type={"submit"} value={"Submit copy"} />'
	]) assert.throws(() => check(source), /Hardcoded Settings text/);
});
test('Settings copy ratchet allows catalog references, ids, style props and explicit brands', () => {
	check(`<script>toast.error(t('common.close'), { description: String(error) });
		toast(t('common.close'));
		open({ directory: true, title: t('common.close') });
		showPersistentError({ id: 'common.close' }, String(error), 'game-text-load');
		const label = t('common.close');</script>
		{#if true}{@const other = t('common.close')}<p>{other}{label}</p>{/if}
		<DialogContent id="restore-dialog" class="text-sm" closeLabel={t('common.close')}>
			<span>{profile || t('settings.selectProfile')}</span><p>Hamlet Editor</p><p>Steam</p>
		</DialogContent>`);
});

test('all-source ratchet includes returned/thrown logic copy and typed template expressions', async () => {
	const { countCopy, checkBaseline } = await import('../scripts/i18n-ratchet.mjs');
	for (const source of [
		'export const blocked = () => "Close the game before saving.";',
		'export function check() { throw new Error(`Could not read ${path}`); }',
		'export function check() { return { reason: "Load a profile first." }; }',
		'const object = { m(label = "Object method copy") {} };',
		'class Example { m(label = "Class method copy") {} }',
		'class Example { @label("Decorator copy") m() {} }',
		'class Example { m(@label("Parameter decorator copy") value) {} }'
	]) assert.ok(countCopy(source, 'src/lib/logic.ts').length > 0);
	assert.equal(countCopy('<script lang="ts"></script><p>{"Hidden copy" as string}</p>', 'src/View.svelte').length, 1);
	assert.equal(countCopy('type Id = "persist.roster.json"; export const id = "persist.roster.json";', 'src/id.ts', [], {
		files: { 'src/id.ts': { 'persist.roster.json': 'Persisted filename.' } }
	}).length, 0);
	assert.equal(countCopy('export const label = "error.save_stale";', 'src/label.ts', ['error.save_stale']).length, 0);
	assert.throws(() => checkBaseline({ 'src/lib/logic.ts': ['Old', 'New'] }, { 'src/lib/logic.ts': ['Old'] }), /New hardcoded copy/);
	assert.throws(() => checkBaseline({ 'src/new.ts': ['New'] }, {}), /New hardcoded copy: src\/new.ts/);
	assert.throws(() => checkBaseline({ 'src/old.ts': [] }, { 'src/old.ts': ['Old'] }), /lower the baseline to 0/);
	assert.throws(() => checkBaseline({}, { 'src/deleted.ts': [] }), /Stale hardcoded-copy baseline: src\/deleted.ts/);
	assert.throws(() => checkBaseline({ 'src/renamed.ts': [] }, { 'src/old.ts': [] }), /src\/old.ts/);
	assert.throws(() => checkBaseline({ 'src/old.ts': ['English toast'] }, { 'src/old.ts': ['/settings'] }), /English toast/);
	assert.throws(() => checkBaseline({ 'src/old.ts': ['Old', 'Old'] }, { 'src/old.ts': ['Old'] }), /New hardcoded copy/);
	checkBaseline({ 'src/old.ts': ['Old'], 'src/new.ts': [] }, { 'src/old.ts': ['Old'] });
});

test('P2 catalogs report missing keys but reject unknown keys and incompatible present entries', async () => {
	const { checkCatalogKeys, checkMessageContract } = await import('../scripts/i18n-contract.mjs');
	const english = { title: 'Title', count: '{count, plural, one {# file} other {# files}}' };
	assert.deepEqual(checkCatalogKeys('de', { title: 'Titel' }, english), ['count']);
	assert.throws(() => checkCatalogKeys('de', { obsolete: 'Alt' }, english), /unknown key obsolete/);
	checkMessageContract('de', 'count', '{count, plural, one {# Datei} other {# Dateien}}', english.count);
	for (const broken of ['{amount}', '{count}', '<link>{count}</link>', '{bad']) {
		assert.throws(() => checkMessageContract('de', 'count', broken, english.count));
	}
});

test('only the exact-one English revival title omits its unreachable cardinal one category', async () => {
	const { requiredPluralCategories } = await import('../scripts/i18n-contract.mjs');
	const node = { value: 'count', pluralType: 'cardinal', offset: 0, options: { '=1': {}, other: {} } };
	assert.deepEqual(requiredPluralCategories('en', 'heroes.reviveTitle', node), ['other']);
	for (const locale of ['ru', 'fr']) {
		assert.deepEqual(requiredPluralCategories(locale, 'heroes.reviveTitle', node), new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
	}
	for (const [id, changed] of [
		['unrelated.count', node], ['heroes.reviveTitle', { ...node, value: 'other' }],
		['heroes.reviveTitle', { ...node, offset: 1 }], ['heroes.reviveTitle', { ...node, options: { other: {} } }],
		['heroes.reviveTitle', { ...node, pluralType: 'ordinal' }]
	]) assert.ok(requiredPluralCategories('en', id, changed).includes('one'));
});

test('CSS APIs and native names are structural, while component name labels count', async () => {
	const { countCopy } = await import('../scripts/i18n-ratchet.mjs');
	assert.equal(countCopy('<input name="hero-name" /><WalletCard name="Gold" />', 'src/Wallet.svelte').length, 1);
	assert.equal(countCopy('<input type="text" value="persisted value" /><div style="color: red"></div>', 'src/View.svelte').length, 0);
	assert.equal(countCopy("<span aria-current={active ? 'step' : undefined}></span>", 'src/View.svelte').length, 0);
	assert.equal(countCopy('<div aria-hidden="true"><span aria-hidden="false"></span></div>', 'src/View.svelte').length, 0);
	assert.equal(countCopy('const style = cn("flex items-center", active && "text-red-500");', 'src/styles.ts').length, 0);
	assert.equal(countCopy('<script>const style = cn("flex items-center");</script><p class={style}>Gold</p>', 'src/Wallet.svelte').length, 1);
});

test('scan includes i18n UI and generated-header claims but excludes known generated files and dev fixtures', async () => {
	const { scanCopy } = await import('../scripts/i18n-ratchet.mjs');
	const directory = await mkdtemp(join(tmpdir(), 'hamlet-copy-scan-'));
	try {
		await mkdir(join(directory, 'src/lib/i18n'), { recursive: true });
		await mkdir(join(directory, 'src/lib/dev'), { recursive: true });
		for (const [file, source] of Object.entries({
			'src/lib/i18n/ErrorMessage.svelte': '<p>Visible error copy</p>',
			'src/lib/i18n/core.ts': 'export const key = "runtime identifier";',
			'src/lib/dev/Fixture.svelte': '<p>Test fixture</p>',
			'src/claimed.ts': '// Generated by a claim\nexport const title = "Visible claimed copy";',
			'src/real.generated.ts': 'export const key = "generated identifier";'
		})) await writeFile(join(directory, file), source);
		assert.deepEqual(await scanCopy(pathToFileURL(`${directory}/`), [], {}), {
			'src/claimed.ts': ['Visible claimed copy'], 'src/lib/i18n/ErrorMessage.svelte': ['Visible error copy']
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
