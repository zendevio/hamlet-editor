import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { checkCatalogKeys, checkMessageContract, contract } from './i18n-contract.mjs';
import { IntlMessageFormat } from 'intl-messageformat';
import { checkBaseline, scanCopy } from './i18n-ratchet.mjs';

const root = new URL('../src/lib/i18n/', import.meta.url);
const hash = (value) => createHash('sha256').update(value).digest('hex');
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
else assert.equal(await readFile(target, 'utf8'), generated, 'Generated message types are stale. Run pnpm i18n:generate');

if (process.argv.includes('--types-only')) process.exit(0);
const repo = new URL('../', import.meta.url);
const allowlist = JSON.parse(await readFile(new URL('scripts/i18n-copy-allowlist.json', repo), 'utf8'));
const baseline = JSON.parse(await readFile(new URL('scripts/i18n-copy-baseline.json', repo), 'utf8'));
const counts = await scanCopy(repo, Object.keys(en), allowlist);
for (const [file, literals] of Object.entries(counts)) console.log(`Copy: ${file}: ${literals.length} (baseline ${baseline[file]?.length ?? 0})`);
checkBaseline(counts, baseline);
const contexts = await read('contexts.json');
const status = await read('pilot-status.json');
const samples = [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 1.5, 1000000];
let branchCount = 0;
for (const filename of (await readdir(new URL('catalogs/', root))).filter((name) => name.endsWith('.json'))) {
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
		checkMessageContract(locale, id, message, en[id]);
		const sourceContract = contract(new IntlMessageFormat(en[id], 'en').getAst());
		const ast = new IntlMessageFormat(message, locale).getAst();
		if (id.startsWith('native.')) {
			assert.ok(ast.length === 1 && ast[0].type === 0 && ast[0].value === message,
				`${locale}:${id}: native labels must be a single unchanged ICU literal`);
		}
		const actualContract = contract(ast);
		assert.deepEqual(Object.keys(actualContract.params), Object.keys(sourceContract.params), `${locale}:${id}: placeholders`);
		assert.deepEqual(actualContract.slots, sourceContract.slots, `${locale}:${id}: slots`);
		for (const [param, type] of Object.entries(actualContract.params)) {
			assert.equal(type, sourceContract.params[param], `${locale}:${id}:${param}: parameter type`);
		}
		assert.ok(contexts[id]?.context && contexts[id]?.lengthHint && contexts[id]?.tone, `${id}: context missing`);
		assert.ok(!contexts[id].context.startsWith('Settings pilot:'), `${id}: placeholder context`);
		assert.deepEqual([...contexts[id].slots].sort(), [...Object.keys(sourceContract.params), ...sourceContract.slots].sort(), `${id}: context slots must match parameters and tags`);
		if (locale !== 'en') {
			assert.equal(status[locale]?.[id]?.sourceHash, hash(en[id]), `${locale}:${id}: stale source`);
			assert.equal(status[locale]?.[id]?.translationHash, hash(message), `${locale}:${id}: stale translation`);
		}
		// Mark every branch in a cloned FormatJS AST. ICU itself selects branches;
		// cartesian witnesses cover nested plurals, exact selectors and selects.
		const marked = structuredClone(ast);
		const expected = new Set();
		const candidates = {};
		function mark(nodes, path = 'root') {
			nodes.forEach((node, index) => {
				if (node.type === 5 || node.type === 6) {
					const choices = node.type === 6 ? [...samples] : ['__catchall__'];
					if (node.type === 6) {
						for (const category of new Intl.PluralRules(locale, { type: node.pluralType }).resolvedOptions().pluralCategories) {
							assert.ok(node.options[category], `${locale}:${id}: missing plural category ${category}`);
						}
					}
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
console.log(`Catalog known keys, syntax, contracts, provenance and ${branchCount} ICU branches passed. Node ${process.version}, ICU ${process.versions.icu}.`);
