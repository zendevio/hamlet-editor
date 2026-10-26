import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IntlMessageFormat } from 'intl-messageformat';
import { checkCatalogKeys, checkMessageContract, checkPluralCoverage, pluralWitnesses, sourceHash, translationState, lengthBudgetWarning, cardinalCategories, checkCardinalCategories, checkSafetyKeys, checkLocaleReadiness, checkIdentity, identityFamilies } from '../scripts/i18n-contract.mjs';
import { freshKeys } from '../scripts/i18n-fresh-keys.mjs';
import { draftRecords } from '../scripts/i18n-records-lib.mjs';
import { catalogs, currentCatalogs } from '../src/lib/i18n/catalogs.ts';
import { pseudoMessage, pseudoCatalog } from '../src/lib/dev/pseudo-locale.ts';
import { checkProductionBuild } from '../scripts/i18n-build-guard-lib.mjs';

const ast = (message, locale = 'en') => new IntlMessageFormat(message, locale).getAst();

test('parity reports incomplete catalogs and fails complete or unknown-key catalogs', () => {
	const english = { title: 'Title', help: 'Help' };
	for (const locale of ['de', 'fr', 'zh-Hans']) {
		assert.deepEqual(checkCatalogKeys(locale, { title: 'Titel' }, english), ['help']);
		assert.throws(() => checkCatalogKeys(locale, { title: 'Titel' }, english, true), /complete locale missing keys: help/);
		assert.throws(() => checkCatalogKeys(locale, { old: 'Alt' }, english), /unknown key old/);
		assert.deepEqual(checkCatalogKeys(locale, { title: 'Titel', help: 'Hilfe' }, english, true), []);
	}
});

test('plural coverage pins all 12 CLDR contracts and rejects ICU drift', () => {
	assert.deepEqual(cardinalCategories, {
		en: ['one', 'other'], de: ['one', 'other'],
		fr: ['many', 'one', 'other'], es: ['many', 'one', 'other'], it: ['many', 'one', 'other'], 'pt-BR': ['many', 'one', 'other'],
		pl: ['few', 'many', 'one', 'other'], cs: ['few', 'many', 'one', 'other'], ru: ['few', 'many', 'one', 'other'],
		'zh-Hans': ['other'], ja: ['other'], ko: ['other']
	});
	for (const locale of ['en', 'fr', 'de', 'es', 'it', 'pt-BR', 'pl', 'cs', 'ru', 'zh-Hans', 'ja', 'ko']) {
		const categories = cardinalCategories[locale];
		checkCardinalCategories(locale);
		assert.throws(() => checkCardinalCategories(locale, ['zero']), /ICU drift/);
		const message = `{count, plural, ${categories.map((category) => `${category} {# item}`).join(' ')}}`;
		checkPluralCoverage(locale, 'count', ast(message, locale));
		const node = ast(message, locale)[0];
		const witnesses = pluralWitnesses(locale, node);
		assert.deepEqual([...new Set(witnesses.map((value) => new Intl.PluralRules(locale).select(value)))].sort(), [...categories].sort());
		for (const category of categories.filter((value) => value !== 'other')) {
			const broken = `{kind, select, yes {<emphasis>${message.replace(`${category} {# item}`, '')}</emphasis>} other {none}}`;
			assert.throws(() => checkPluralCoverage(locale, 'nested', ast(broken, locale)), new RegExp(`missing plural category ${category}`));
		}
		if (['zh-Hans', 'ja', 'ko'].includes(locale)) assert.deepEqual(categories, ['other']);
	}
	const message = '{count, plural, offset:2 =3 {exact} one {# item} other {# items}}';
	const node = ast(message)[0];
	assert.ok(pluralWitnesses('en', node).includes(3));
	assert.ok(pluralWitnesses('en', node).some((value) => value !== 3 && new Intl.PluralRules('en').select(value - 2) === 'one'));
});

function syntax(nodes) {
	return nodes.filter((node) => node.type !== 0).map((node) => {
		const { location: _location, options, children, ...token } = node;
		return { ...token, ...(options ? { options: Object.fromEntries(Object.entries(options).map(([key, option]) => [key, syntax(option.value)])) } : {}), ...(children ? { children: syntax(children) } : {}) };
	});
}

test('pseudo-locale preserves exact ICU tokens, nested selector/tag structure, quotes and hostile placeholders', () => {
	const message = "Hello {name}! {count, plural, offset:1 =0 {No files} one {<emphasis># file</emphasis>} other {{kind, select, disk {# files on disk} other {# files}}}} '{literal}' '' <code>{path}</code>";
	const pseudo = pseudoMessage(message);
	assert.deepEqual(syntax(ast(pseudo)), syntax(ast(message)));
	for (const token of ['{name}', '{count, plural, offset:1 =0 {', '<emphasis>', '</emphasis>', '{kind, select, disk {', '<code>{path}</code>', "'{", "}'", "''"]) assert.ok(pseudo.includes(token), token);
	checkMessageContract('en', 'proof', pseudo, message);
	const params = { name: '<img src=x>', path: 'C:/unchanged', count: 5, kind: 'disk', emphasis: (chunks) => chunks.join(''), code: (chunks) => chunks.join('') };
	const rendered = new IntlMessageFormat(pseudo, 'en').format(params);
	assert.ok(rendered.startsWith('⟦') && rendered.endsWith('⟧'));
	assert.ok(rendered.includes('<img src=x>') && rendered.includes('C:/unchanged'));
	const source = 'This is a reasonably long label for the expansion check';
	const expanded = pseudoMessage(source).slice(1, -1);
	assert.ok(expanded.length >= source.length * 1.35 && expanded.length <= source.length * 1.45);
	assert.match(expanded, /[áéíóú]/u);
});

test('every English message generates deterministically with the same contract and syntax', async () => {
	const english = JSON.parse(await readFile(new URL('../src/lib/i18n/catalogs/en.json', import.meta.url)));
	const pseudo = pseudoCatalog(english);
	assert.deepEqual(pseudo, pseudoCatalog(english));
	assert.deepEqual(Object.keys(pseudo), Object.keys(english));
	for (const [id, message] of Object.entries(pseudo)) {
		checkMessageContract('en', id, message, english[id]);
		assert.deepEqual(syntax(ast(message)), syntax(ast(english[id])), id);
	}
});

const identity = (family, model = `${family} fixture model`, date = '2026-10-25') => ({ family, model, date });
const person = (name, date = '2026-10-25') => ({ family: 'human', person: name, date });
const draft = (sourceText = 'Source', translationText = 'Ziel') => ({ status: 'draft', sourceHash: sourceHash(sourceText), translationHash: sourceHash(translationText), sourceText, translationText, drafter: identity('openai') });
const approved = () => ({ ...draft(), status: 'final', reviewer: identity('anthropic'), semanticVerdict: 'pass', glossaryVersion: 'v1', reviewedSourceHash: sourceHash('Source'), reviewedTranslationHash: sourceHash('Ziel') });

test('review records detect source and translation drift without rewriting final records', () => {
	const record = draft();
	assert.equal(translationState(record, 'Source', 'Ziel'), 'draft');
	assert.equal(translationState(record, 'Changed', 'Ziel'), 'stale-source');
	assert.equal(translationState(record, 'Source', 'Geändert'), 'stale-translation');
	assert.equal(translationState(undefined, 'Source', 'Ziel'), 'missing-review-record');
	assert.throws(() => translationState({ ...record, status: 'pilot, unreviewed' }, 'Source', 'Ziel'), /Invalid review status/);
	assert.throws(() => translationState({ ...record, status: 'reviewed' }, 'Source', 'Ziel'), /needs reviewer/);
	const final = approved();
	const before = structuredClone(final);
	assert.equal(translationState(final, 'Source', 'Ziel'), 'final');
	assert.equal(translationState(final, 'Changed', 'Ziel'), 'stale-source');
	assert.deepEqual(final, before);
	assert.throws(() => translationState({ ...final, sourceHash: sourceHash('Changed'), sourceText: 'Changed' }, 'Changed', 'Ziel'), /Reviewed source hash is stale/);
	assert.throws(() => translationState({ ...final, translationHash: sourceHash('Neu'), translationText: 'Neu' }, 'Source', 'Neu'), /Reviewed translation hash is stale/);
	assert.throws(() => translationState({ ...record, sourceText: 'Changed' }, 'Changed', 'Ziel'), /Source snapshot hash differs/);
	assert.throws(() => translationState({ ...record, translationText: 'Neu' }, 'Source', 'Neu'), /Translation snapshot hash differs/);
});

test('every destructive message requires a passing independent Q4 record before reviewed or final', async () => {
	const english = JSON.parse(await readFile(new URL('../src/lib/i18n/catalogs/en.json', import.meta.url)));
	const contexts = JSON.parse(await readFile(new URL('../src/lib/i18n/contexts.json', import.meta.url)));
	const keys = JSON.parse(await readFile(new URL('../src/lib/i18n/safety-keys.json', import.meta.url)));
	for (const id of ['error.backup_rollback', 'heroes.reset', 'heroes.resetHelp']) {
		assert.ok(keys.includes(id), id);
		assert.equal(contexts[id].safety, true, id);
		assert.throws(() => checkSafetyKeys(keys.filter((key) => key !== id), contexts, english), new RegExp(`missing ${id}`));
	}
	checkSafetyKeys(keys, contexts, english);
	assert.throws(() => checkSafetyKeys([], contexts, english), /non-empty/);
	for (const id of keys) {
		const changed = structuredClone(contexts); delete changed[id].safety;
		assert.throws(() => checkSafetyKeys(keys, changed, english), /flags must match/);
	}
	assert.throws(() => checkSafetyKeys(keys.filter((id) => id !== 'raid.abandon'), contexts, english), /missing raid.abandon/);
	const safetyVerdict = { verdict: 'pass', independent: true, sourceHash: sourceHash('Source'), translationHash: sourceHash('Ziel'), reviewer: identity('google'), action: 'Remove', object: 'Hero', conditions: 'No raid; negation checked', reversibility: 'Discard before saving', scope: 'Memory until Save', codePath: 'hero-safety.ts', workflow: 'Dismiss dialog then Save' };
	for (const status of ['reviewed', 'final']) {
		const record = { ...approved(), status, safetyVerdict };
		assert.equal(translationState(record, 'Source', 'Ziel', true), status);
		for (const verdict of [null, 'pass', { ...safetyVerdict, verdict: 'fail' }]) {
			assert.throws(() => translationState({ ...record, safetyVerdict: verdict }, 'Source', 'Ziel', true), /passing independent safety verdict/);
		}
		for (const field of ['action', 'object', 'conditions', 'reversibility', 'scope', 'codePath', 'workflow']) {
			assert.throws(() => translationState({ ...record, safetyVerdict: { ...safetyVerdict, [field]: '' } }, 'Source', 'Ziel', true), /Safety verdict missing/);
		}
		for (const reviewer of [record.drafter, record.reviewer]) assert.throws(() => translationState({ ...record, safetyVerdict: { ...safetyVerdict, reviewer } }, 'Source', 'Ziel', true), /third independent reviewer/);
		for (const field of ['sourceHash', 'translationHash']) assert.throws(() => translationState({ ...record, safetyVerdict: { ...safetyVerdict, [field]: 'old' } }, 'Source', 'Ziel', true), /Safety verdict .* hash is stale/);
		assert.throws(() => translationState({ ...record, safetyVerdict: { ...safetyVerdict, independent: false } }, 'Source', 'Ziel', true), /independent third check/);
		if (status === 'final') checkLocaleReadiness('de', { title: 'Ziel' }, { title: 'Source' }, { title: 'final' }, true, false, ['title'], { title: record });
	}
	assert.equal(checkLocaleReadiness('de', {}, english, {}, false, true, keys).length, Object.keys(english).length);
	assert.ok(checkLocaleReadiness('de', { title: 'Ziel' }, { title: 'Changed' }, { title: 'stale-source' }, true, false, ['title'], { title: draft() }).some((warning) => warning.includes('final safety review')));
});

test('records command preserves fresh and human evidence and demotes deltas with previous history', () => {
	const original = { de: { title: approved() } };
	const before = structuredClone(original);
	assert.deepEqual(draftRecords({ title: 'Source' }, { de: { title: 'Ziel' } }, original), original);
	for (const [source, target] of [['Changed', 'Ziel'], ['Source', 'Neu']]) {
		const result = draftRecords({ title: source }, { de: { title: target } }, original, identity('google'));
		assert.equal(translationState(result.de.title, source, target), source === 'Changed' ? 'stale-source' : 'draft');
		if (source === 'Changed') assert.deepEqual(result.de.title, original.de.title);
		else {
			assert.equal(result.de.title.safetyVerdict, null);
			assert.deepEqual(result.de.title.previous, original.de.title);
		}
	}
	const human = { de: { title: { ...approved(), reviewKind: 'human' } } };
	assert.throws(() => draftRecords({ title: 'Source' }, { de: { title: 'Neu' } }, human), /human record protected/);
	assert.deepEqual(draftRecords({ title: 'Changed' }, { de: { title: 'Ziel' } }, human).de.title, human.de.title);
	assert.throws(() => draftRecords({ title: 'Source' }, { de: { title: 'Ziel' } }, {}), /supply --drafter/);
	const created = draftRecords({ title: 'Source', absent: 'Missing' }, { de: { title: 'Ziel' } }, {}, identity('anthropic'));
	assert.equal(created.de.title.status, 'draft');
	assert.deepEqual(created.de.title.drafter, identity('anthropic'));
	assert.equal(created.de.absent, undefined);
	assert.deepEqual(original, before);
});

test('runtime map covers all files and stale keys fall back per message on main while release fails', async () => {
	const { readdir } = await import('node:fs/promises');
	const { createTranslator } = await import('../src/lib/i18n/core.ts');
	assert.deepEqual(Object.keys(catalogs).sort(), (await readdir(new URL('../src/lib/i18n/catalogs/', import.meta.url))).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5)).sort());
	const input = { en: { title: 'Source changed', other: 'Other' }, de: { title: 'Ziel', other: 'Andere' } };
	const status = { de: { title: draft(), other: draft('Other', 'Andere') } };
	const translator = createTranslator(currentCatalogs(input, freshKeys(input, status)));
	assert.equal(translator.text('de', 'title'), 'Source changed');
	assert.equal(translator.text('de', 'other'), 'Andere');
	const changedInput = { ...input, de: { title: 'Neu', other: 'Andere' } };
	const changedTarget = currentCatalogs(changedInput, freshKeys(changedInput, status));
	assert.equal(changedTarget.de.title, undefined);
	assert.equal(checkLocaleReadiness('de', input.de, input.en, { title: 'stale-source', other: 'draft' }, false).length, 1);
	assert.throws(() => checkLocaleReadiness('de', input.de, input.en, { title: 'stale-source' }, false, true), /stale-source/);
	assert.equal(checkLocaleReadiness('de', {}, input.en, {}, false).length, 2);
	assert.throws(() => checkLocaleReadiness('de', {}, input.en, {}, true, true), /missing keys/);
});

test('length warnings measure literal labels rather than ICU token lengths and never fail a translation', () => {
	assert.deepEqual(lengthBudgetWarning('Save', 'Änderungen speichern', 'de'), { sourceLength: 4, translatedLength: 20, ratio: 5 });
	assert.equal(lengthBudgetWarning('{veryLongVariableName}', '{veryLongVariableName}', 'de'), null);
	assert.equal(lengthBudgetWarning('A long explanation that has more than forty letters.', 'Eine sehr lange Erklärung, die länger ist und keine kurze Beschriftung darstellt.', 'de'), null);
});

test('production guard rejects dev harness and pseudo artifacts, including escaped brackets', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'hamlet-production-i18n-'));
	const root = pathToFileURL(`${directory}/`);
	try {
		await assert.rejects(() => checkProductionBuild(root), /Production build is empty/);
		await writeFile(join(directory, 'app.js'), 'English production app');
		assert.equal(await checkProductionBuild(root), 1);
		await writeFile(join(directory, 'font.woff2'), Buffer.from('binary __h1 ⟦ bytes'));
		assert.equal(await checkProductionBuild(root), 2);
		for (const marker of ['window.__h1', 'mockIPC', '⟦Šáṽé⟧', '\\u27e6accented\\u27e7']) {
			await writeFile(join(directory, 'app.js'), marker);
			await assert.rejects(() => checkProductionBuild(root), /Dev i18n content in production/);
		}
		await writeFile(join(directory, 'app.js'), 'English app');
		await writeFile(join(directory, 'pseudo-locale.json'), '{}');
		await assert.rejects(() => checkProductionBuild(root), /Dev i18n artifact in production/);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('production guard CLI executes through a symlinked absolute path', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'hamlet-guard-cli-'));
	try {
		const script = join(directory, 'guard.mjs');
		await symlink(new URL('../scripts/i18n-build-guard.mjs', import.meta.url), script);
		const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
		// The CLI must print a pass or fail with a real build error, never no-op.
		assert.ok(result.status !== 0 || /Production i18n guard passed/.test(result.stdout), result.stderr);
	} finally { await rm(directory, { recursive: true, force: true }); }
});


test('restoreWarning source deltas stay stale through both records-writer probes, including a new drafter', async () => {
	const records = JSON.parse(await readFile(new URL('../src/lib/i18n/pilot-status.json', import.meta.url)));
	const { createTranslator } = await import('../src/lib/i18n/core.ts');
	const id = 'settings.restoreWarning';
	const old = records.de[id];
	const input = { en: { [id]: catalogs.en[id] + ' The source meaning changed.' }, de: { [id]: catalogs.de[id] } };
	for (const drafter of [undefined, person('Someone Else', '2026-10-26')]) {
		const original = { de: { [id]: old } };
		for (const result of [original, draftRecords(input.en, input, original, drafter)]) {
			assert.equal(translationState(result.de[id], input.en[id], input.de[id], true), 'stale-source');
			assert.deepEqual(result.de[id].drafter, old.drafter);
			assert.equal(createTranslator(currentCatalogs(input, freshKeys(input, result))).text('de', id), input.en[id]);
			assert.ok(checkLocaleReadiness('de', input.de, input.en, { [id]: 'stale-source' }, false, false, [id], result.de).some((warning) => warning.includes('stale-source')));
			assert.throws(() => checkLocaleReadiness('de', input.de, input.en, { [id]: 'stale-source' }, false, true, [id], result.de), /stale-source/);
			assert.deepEqual(draftRecords(input.en, input, result, drafter), result);
		}
		const changedInput = { ...input, de: { [id]: input.de[id] + ' Geändert.' } };
		if (!drafter) {
			// Changed text never inherits the previous author.
			assert.throws(() => draftRecords(input.en, changedInput, original, drafter), /translation changed; supply --drafter/);
			continue;
		}
		const changed = draftRecords(input.en, changedInput, original, drafter);
		assert.equal(translationState(changed.de[id], input.en[id], changedInput.de[id]), 'draft');
		assert.deepEqual(changed.de[id].drafter, drafter);
		assert.deepEqual(changed.de[id].previous.drafter, old.drafter);
	}
	// An actual semantic pass may associate unchanged text with the new source.
	const reviewed = { ...old, status: 'reviewed', sourceText: input.en[id], sourceHash: sourceHash(input.en[id]),
		reviewedSourceHash: sourceHash(input.en[id]), reviewedTranslationHash: old.translationHash,
		reviewer: identity('anthropic'), semanticVerdict: 'pass', glossaryVersion: 'v1' };
	assert.equal(translationState(reviewed, input.en[id], input.de[id]), 'reviewed');
	assert.deepEqual(freshKeys(input, { de: { [id]: reviewed } }).de, [id]);
});

test('structured identities enforce semantic and safety reviewer families independently of model and date', () => {
	const record = approved();
	for (const reviewer of [record.drafter, { ...record.drafter, model: 'Another model', date: '2026-10-26' }]) {
		assert.throws(() => translationState({ ...record, reviewer }, 'Source', 'Ziel'), /Semantic reviewer must differ in family/);
	}
	for (const drafter of ['Codex, 2026-10-25', {}, { family: 'x', model: 'y' }, { family: 'x', model: 'y', date: 'yesterday' }]) {
		assert.throws(() => translationState({ ...draft(), drafter }, 'Source', 'Ziel'), /identity/);
	}
	const safetyVerdict = { verdict: 'pass', independent: true, sourceHash: record.sourceHash, translationHash: record.translationHash,
		reviewer: identity('google'), action: 'Reset', object: 'Hero', conditions: 'Unsaved edits only', reversibility: 'Discard edits', scope: 'Memory', codePath: 'heroes', workflow: 'Reset hero' };
	for (const family of ['openai', 'anthropic']) {
		const reviewer = identity(family, 'Other model', '2026-10-26');
		assert.throws(() => translationState({ ...record, safetyVerdict: { ...safetyVerdict, reviewer } }, 'Source', 'Ziel', true), /third independent reviewer family/);
	}
	assert.throws(() => translationState({ ...record, safetyVerdict: { ...safetyVerdict, reviewer: 'Third family' } }, 'Source', 'Ziel', true), /structured identity/);
});

test('release requires final safety approval in every shipped catalog even when the locale is in progress', () => {
	const input = { reset: 'Ziel', other: 'Anderes' };
	const english = { reset: 'Source', other: 'Other', absentSafety: 'Absent' };
	const states = { reset: 'draft', other: 'draft' };
	const records = { reset: draft() };
	const keys = ['reset', 'absentSafety'];
	assert.ok(checkLocaleReadiness('de', input, english, states, false, false, keys, records).some((warning) => warning.includes('de:reset: needs a recorded final safety review')));
	assert.throws(() => checkLocaleReadiness('de', input, english, states, false, true, keys, records), /de:reset: needs a recorded final safety review/);
	const record = approved();
	record.safetyVerdict = { verdict: 'pass', independent: true, sourceHash: record.sourceHash, translationHash: record.translationHash,
		reviewer: identity('google'), action: 'Reset', object: 'Hero', conditions: 'Unsaved edits only', reversibility: 'Discard edits', scope: 'Memory', codePath: 'heroes', workflow: 'Reset hero' };
	assert.deepEqual(checkLocaleReadiness('de', input, english, { ...states, reset: 'final' }, false, true, keys, { reset: record }), ['de:absentSafety: missing-translation']);
	assert.throws(() => checkLocaleReadiness('de', input, english, { ...states, reset: 'final' }, false, true, keys, { reset: { ...record, safetyVerdict: null } }), /passing independent safety verdict/);
});

test('records writer archives removed keys, removed translations and removed locales without losing evidence', () => {
	const old = { de: { kept: draft(), removedTranslation: draft(), removedEnglish: draft() }, fr: { kept: draft() }, removed: { ja: { older: draft() } } };
	const english = { kept: 'Source', removedTranslation: 'Source' };
	const catalogs = { de: { kept: 'Ziel' } };
	const result = draftRecords(english, catalogs, old);
	assert.deepEqual(result.de, { kept: old.de.kept });
	assert.equal(result.fr, undefined);
	assert.deepEqual(result.removed, { ja: old.removed.ja, de: { removedTranslation: old.de.removedTranslation, removedEnglish: old.de.removedEnglish }, fr: old.fr });
	assert.deepEqual(draftRecords(english, catalogs, result), result);
	assert.ok(old.de.removedTranslation);
});

test('a changed translation requires a drafter and never inherits the previous author', () => {
	const original = { de: { title: draft('Source', 'Alt') } };
	const before = structuredClone(original);
	// Unchanged text needs no drafter and keeps its author.
	assert.deepEqual(draftRecords({ title: 'Source' }, { de: { title: 'Alt' } }, original), original);
	for (const english of ['Source', 'Changed']) {
		assert.throws(() => draftRecords({ title: english }, { de: { title: 'Neu' } }, original), /de:title: translation changed; supply --drafter/);
		assert.throws(() => draftRecords({ title: english }, { de: { title: 'Neu' } }, original, identity('OpenAI Codex')), /family must be one of/);
		const result = draftRecords({ title: english }, { de: { title: 'Neu' } }, original, person('Ana', '2026-10-26'));
		assert.deepEqual(result.de.title.drafter, person('Ana', '2026-10-26'));
		assert.deepEqual(result.de.title.previous, original.de.title);
		assert.equal(translationState(result.de.title, english, 'Neu'), 'draft');
	}
	assert.deepEqual(original, before);
});

test('removing a key again keeps every earlier archived record in its previous chain', () => {
	const english = { k: 'Source' };
	const first = draft('Source', 'Alt');
	const removedOnce = draftRecords(english, { de: {} }, { de: { k: first } });
	assert.equal(removedOnce.de, undefined);
	assert.deepEqual(removedOnce.removed, { de: { k: first } });
	// Re-adding the key links its archive instead of leaving it to be overwritten.
	const readded = draftRecords(english, { de: { k: 'Neu' } }, removedOnce, identity('anthropic'));
	assert.equal(readded.de.k.translationText, 'Neu');
	assert.deepEqual(readded.de.k.previous, first);
	assert.equal(readded.removed, undefined);
	const removedTwice = draftRecords(english, { de: {} }, readded);
	assert.equal(removedTwice.removed.de.k.translationText, 'Neu');
	assert.deepEqual(removedTwice.removed.de.k.previous, first);
	assert.deepEqual(draftRecords(english, { de: {} }, removedTwice), removedTwice);
	// Records archived before this rule existed are kept as the oldest entry, below the record's own history.
	const history = draft('Source', 'Zwischen');
	const legacy = { de: { k: { ...draft('Source', 'Neu'), previous: history } }, removed: { de: { k: first } } };
	const merged = draftRecords(english, { de: {} }, legacy).removed.de.k;
	assert.equal(merged.translationText, 'Neu');
	assert.equal(merged.previous.translationText, 'Zwischen');
	assert.deepEqual(merged.previous.previous, first);
});

test('identity families are a closed list and human reviewers are compared by person', () => {
	assert.deepEqual(identityFamilies, ['anthropic', 'openai', 'google', 'human']);
	for (const family of ['OpenAI Codex', 'open ai', ' openai ', 'OpenAI', 'claude', 'draft-family', '']) {
		assert.throws(() => checkIdentity(identity(family), 'Translation drafter'), /family must be one of anthropic, openai, google, human/, family);
	}
	for (const family of ['anthropic', 'openai', 'google']) {
		assert.equal(checkIdentity(identity(family), 'Translation drafter'), family);
		assert.throws(() => checkIdentity({ family, date: '2026-10-25' }, 'Translation drafter'), /missing model/);
	}
	assert.equal(checkIdentity(person('  Ana   Pop '), 'Translation drafter'), 'human:ana pop');
	for (const name of [undefined, '', '  ']) {
		assert.throws(() => checkIdentity({ family: 'human', person: name, model: 'n/a', date: '2026-10-25' }, 'Translation drafter'), /missing person/);
	}
	// Two people are independent of each other; the same person is not, whatever the spelling or date.
	const humanDraft = { ...approved(), drafter: person('Ana') };
	for (const reviewer of [person('Ana'), person(' ana ', '2026-10-27')]) {
		assert.throws(() => translationState({ ...humanDraft, reviewer }, 'Source', 'Ziel'), /Semantic reviewer must differ .* in person when both are human/);
	}
	for (const reviewer of [person('Ben'), identity('openai')]) assert.equal(translationState({ ...humanDraft, reviewer }, 'Source', 'Ziel'), 'final');
	const safetyVerdict = { verdict: 'pass', independent: true, sourceHash: sourceHash('Source'), translationHash: sourceHash('Ziel'),
		action: 'Reset', object: 'Hero', conditions: 'Unsaved edits only', reversibility: 'Discard edits', scope: 'Memory', codePath: 'heroes', workflow: 'Reset hero' };
	const twoPeople = { ...humanDraft, reviewer: person('Ben') };
	for (const reviewer of [person('ANA'), person('Ben')]) {
		assert.throws(() => translationState({ ...twoPeople, safetyVerdict: { ...safetyVerdict, reviewer } }, 'Source', 'Ziel', true), /third independent reviewer/);
	}
	for (const reviewer of [person('Cara'), identity('google')]) {
		assert.equal(translationState({ ...twoPeople, safetyVerdict: { ...safetyVerdict, reviewer } }, 'Source', 'Ziel', true), 'final');
	}
});
