import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { checkCatalogKeys, checkMessageContract, contract, checkPluralCoverage, pluralWitnesses, translationState, lengthBudgetWarning, checkCardinalCategories, checkSafetyKeys, checkLocaleReadiness } from './i18n-contract.mjs';
import { freshKeys } from './i18n-fresh-keys.mjs';
import { IntlMessageFormat } from 'intl-messageformat';
import { checkBaseline, scanCopy } from './i18n-ratchet.mjs';
import { pseudoCatalog } from '../src/lib/dev/pseudo-locale.ts';
import { GAME_TEXT_LOCALES } from '../src/lib/data/game-text-languages.ts';

const repo = new URL('../', import.meta.url);
const release = process.env.I18N_RELEASE === '1' || process.argv.includes('--release');
const report = { node: process.version, icu: process.versions.icu, release, safetyKeys: [], locales: {}, errors: [] };
async function gate(name, check) {
	try { return await check(); }
	catch (error) {
		report.errors.push({ gate: name, message: error.message });
		console.error(`I18n gate ${name}: ${error.message}`);
	}
}

async function check() {
	const root = new URL('../src/lib/i18n/', import.meta.url);
	const read = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
	const en = await read('catalogs/en.json');
	const tags = ['emphasis', 'code', 'link'];

	let generated = '// Generated from catalogs/en.json by scripts/i18n.mjs. Do not edit.\n';
	generated += 'export interface MessageParams {\n';
	for (const [id, message] of Object.entries(en).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		const { params } = contract(new IntlMessageFormat(message, 'en').getAst());
		generated += `\t${JSON.stringify(id)}: {${Object.entries(params).map(([key, type]) => ` ${JSON.stringify(key)}: ${type};`).join('')} };\n`;
	}
	generated += '}\nexport type MessageKey = keyof MessageParams;\n';
	generated += 'export type MessageDescriptor = { [K in MessageKey]: keyof MessageParams[K] extends never\n\t? { id: K; params?: never } : { id: K; params: MessageParams[K] } }[MessageKey];\n';
	const target = new URL('messages.generated.d.ts', root);
	if (process.argv.includes('--write')) await writeFile(target, generated);
	else await gate('generated-types', async () => assert.equal(await readFile(target, 'utf8'), generated, 'Generated message types are stale. Run pnpm i18n:generate'));

	const status = await read('pilot-status.json');
	const files = (await readdir(new URL('catalogs/', root))).filter((name) => name.endsWith('.json'));
	const catalogs = Object.fromEntries(await Promise.all(files.map(async (filename) => [filename.slice(0, -5), await read(`catalogs/${filename}`)])));
	const freshTarget = new URL('fresh-keys.generated.json', root);
	const generatedFresh = JSON.stringify(freshKeys(catalogs, status), null, '\t') + '\n';
	if (process.argv.includes('--write')) await writeFile(freshTarget, generatedFresh);
	else await gate('generated-fresh-keys', async () => assert.equal(await readFile(freshTarget, 'utf8'), generatedFresh, 'Generated fresh keys are stale. Run pnpm i18n:generate'));
	if (process.argv.includes('--types-only')) return;
	const allowlist = JSON.parse(await readFile(new URL('scripts/i18n-copy-allowlist.json', repo), 'utf8'));
	const baseline = JSON.parse(await readFile(new URL('scripts/i18n-copy-baseline.json', repo), 'utf8'));
	const counts = await gate('copy-scan', () => scanCopy(repo, Object.keys(en), allowlist)) ?? {};
	for (const [file, literals] of Object.entries(counts)) console.log(`Copy: ${file}: ${literals.length} (baseline ${baseline[file]?.length ?? 0})`);
	await gate('copy-baseline', () => checkBaseline(counts, baseline));
	const contexts = await read('contexts.json');
	const safetyKeys = await read('safety-keys.json');
	report.safetyKeys = safetyKeys;
	await gate('safety-manifest', () => checkSafetyKeys(safetyKeys, contexts, en));
	const localeStatus = await read('locale-status.json');
	await gate('locale-status', () => assert.deepEqual(Object.keys(localeStatus).sort(), Object.values(GAME_TEXT_LOCALES).sort(), 'Locale status must cover exactly the 12 supported languages'));

	const { catalogs: loadedCatalogs } = await gate('runtime-imports', () => import('../src/lib/i18n/catalogs.ts')) ?? {};
	await gate('runtime-map', () => assert.deepEqual(Object.keys(loadedCatalogs ?? {}).sort(), Object.keys(catalogs).sort(), 'Runtime catalogs must match catalog files'));
	await gate('runtime-contents', () => assert.deepEqual(loadedCatalogs, catalogs, 'Runtime catalog imports must match catalog contents'));
	const nativeMenu = await readFile(new URL('src-tauri/src/commands/native_menu.rs', repo), 'utf8');
	await gate('native-catalogs', () => assert.deepEqual([...nativeMenu.matchAll(/include_str!\("[^"]*\/catalogs\/([^/"]+)\.json"\)/g)].map((match) => match[1]).filter((locale, index, values) => values.indexOf(locale) === index).sort(), Object.keys(catalogs).sort(), 'Native menu catalogs must match runtime catalog files'));
	for (const locale of Object.keys(catalogs)) await gate(`${locale}:status`, () => assert.ok(Object.hasOwn(localeStatus, locale), `${locale}: missing locale status`));

	for (const [locale, completion] of Object.entries(localeStatus)) {
		await gate(`${locale}:completion`, () => assert.ok(['in-progress', 'complete'].includes(completion), `${locale}: invalid locale completion status`));
		await gate(`${locale}:icu`, () => checkCardinalCategories(locale));
		const catalog = catalogs[locale] ?? {};
		const missing = await gate(`${locale}:keys`, () => checkCatalogKeys(locale, catalog, en)) ?? [];
		const records = {};
		for (const [id, message] of Object.entries(catalog)) records[id] = locale === 'en' ? 'source' :
			await gate(`${locale}:${id}:record`, () => translationState(status[locale]?.[id], en[id], message, contexts[id]?.safety === true)) ?? 'invalid-review-record';
		const lengthWarnings = Object.entries(catalog).flatMap(([id, message]) => {
			let warning;
			try { warning = lengthBudgetWarning(en[id], message, locale); }
			catch { return []; } // The catalog syntax/contract gate below records this error.
			return warning ? [{ id, ...warning }] : [];
		});
		report.locales[locale] = { completion, missing, records, lengthWarnings };
		console.log(`${locale}: ${missing.length} missing keys (${completion}); ${lengthWarnings.length} length budget warnings`);
	}
	for (const [locale, { completion, records }] of Object.entries(report.locales)) {
		const warnings = await gate(`${locale}:readiness`, () => checkLocaleReadiness(locale, catalogs[locale] ?? {}, en, records, completion === 'complete', release, safetyKeys, status[locale])) ?? [];
		report.locales[locale].warnings = warnings;
		for (const warning of warnings) console.warn(`Translation warning: ${warning}`);
	}
	for (const [locale, records] of Object.entries(status)) {
		if (locale === 'removed') continue;
		await gate(`${locale}:obsolete-records`, () => {
			assert.ok(localeStatus[locale], `${locale}: obsolete review locale`);
			for (const id of Object.keys(records)) assert.ok(catalogs[locale]?.[id], `${locale}:${id}: obsolete review record; run pnpm i18n:records to archive it under removed`);
		});
	}
	await gate('contexts', () => assert.deepEqual(Object.keys(contexts).sort(), Object.keys(en).sort(), 'Context keys must match English'));
	for (const [id, message] of Object.entries(pseudoCatalog(en))) checkMessageContract('en', id, message, en[id]);
	let branchCount = 0;
	for (const filename of files) {
		const locale = filename.slice(0, -5);
		const raw = await readFile(new URL(`catalogs/${filename}`, root), 'utf8');
		const catalog = JSON.parse(raw);
		assert.equal(JSON.stringify(catalog, null, '\t') + '\n', raw, `${locale}: catalog import/export round trip`);
		assert.equal((raw.match(/^\s*"[^"\n]+"\s*:/gm) ?? []).length, Object.keys(catalog).length, `${locale}: duplicate keys`);
		const missing = checkCatalogKeys(locale, catalog, en);
		if (missing.length) console.log(`${locale}: ${missing.length} missing keys (English fallback): ${missing.join(', ')}`);
		for (const [id, message] of Object.entries(catalog)) {
			assert.ok(message.trim(), `${locale}:${id}: empty message`);
			assert.ok(!/[\u2014\u200B-\u200F\u202A-\u202E\u2060-\u2069\uE000-\uF8FF\uFFFD]/u.test(message), `${locale}:${id}: unexpected Unicode`);
			const stale = report.locales[locale].records[id]?.startsWith('stale-');
			if (!stale) checkMessageContract(locale, id, message, en[id]);
			const sourceContract = contract(new IntlMessageFormat(en[id], 'en').getAst());
			const ast = new IntlMessageFormat(message, locale).getAst();
			if (id.startsWith('native.')) {
				assert.ok(ast.length === 1 && ast[0].type === 0 && ast[0].value === message,
					`${locale}:${id}: native labels must be a single unchanged ICU literal`);
			}
			const actualContract = contract(ast);
			if (!stale) {
				assert.deepEqual(Object.keys(actualContract.params), Object.keys(sourceContract.params), `${locale}:${id}: placeholders`);
				assert.deepEqual(actualContract.slots, sourceContract.slots, `${locale}:${id}: slots`);
				for (const [param, type] of Object.entries(actualContract.params)) {
					assert.equal(type, sourceContract.params[param], `${locale}:${id}:${param}: parameter type`);
				}
			}
			assert.ok(contexts[id]?.context && contexts[id]?.lengthHint && contexts[id]?.tone, `${id}: context missing`);
			assert.ok(!contexts[id].context.startsWith('Settings pilot:'), `${id}: placeholder context`);
			assert.deepEqual([...contexts[id].slots].sort(), [...Object.keys(sourceContract.params), ...sourceContract.slots].sort(), `${id}: context slots must match parameters and tags`);
			checkPluralCoverage(locale, id, ast);
			// Mark every branch in a cloned FormatJS AST. ICU itself selects branches;
			// cartesian witnesses cover nested plurals, exact selectors and selects.
			const marked = structuredClone(ast);
			const expected = new Set();
			const candidates = {};
			function mark(nodes, path = 'root') {
				nodes.forEach((node, index) => {
					if (node.type === 5 || node.type === 6) {
						const choices = node.type === 6 ? pluralWitnesses(locale, node) : ['__catchall__'];
						for (const [selector, option] of Object.entries(node.options)) {
							if (selector.startsWith('=')) choices.push(Number(selector.slice(1)));
							else if (node.type === 5 && selector !== 'other') choices.push(selector);
							const marker = `[${path}.${index}.${selector}]`;
							expected.add(marker);
							mark(option.value, `${path}.${index}.${selector}`);
							option.value.unshift({ type: 0, value: marker });
						}
						candidates[node.value] = [...new Set([...(candidates[node.value] ?? []), ...choices])];
					} else if (node.type === 8) mark(node.children, `${path}.${index}.tag`);
				});
			}
			mark(marked);
			let cases = [{}];
			for (const [param, choices] of Object.entries(candidates)) {
				cases = cases.flatMap((entry) => choices.map((value) => ({ ...entry, [param]: value })));
			}
			const defaults = Object.fromEntries(Object.entries(actualContract.params).map(([param, type]) => [param, type === 'number' ? 1 : 'literal <img onerror=alert(1)>']));
			const slots = Object.fromEntries(tags.map((tag) => [tag, (chunks) => chunks.join('')]));
			const formatter = new IntlMessageFormat(marked, locale);
			const covered = new Set();
			for (const values of cases) {
				const result = String(formatter.format({ ...defaults, ...values, ...slots }));
				assert.ok(result.trim(), `${locale}:${id}: blank branch`);
				for (const marker of expected) if (result.includes(marker)) covered.add(marker);
			}
			assert.deepEqual([...covered].sort(), [...expected].sort(), `${locale}:${id}: uncovered ICU branches`);
			branchCount += covered.size;
		}
	}
	report.branchCount = branchCount;
	if (!report.errors.length) console.log(`Catalog known keys, syntax, contracts, provenance and ${branchCount} ICU branches passed. Node ${process.version}, ICU ${process.versions.icu}.`);
}

await gate('catalog-validation', check);
const reportPath = new URL(process.env.I18N_REPORT ?? 'test-results/i18n-readiness.json', repo);
await mkdir(new URL('.', reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, '\t') + '\n');
if (report.errors.length) process.exitCode = 1;
