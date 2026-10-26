import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, cp, symlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = new URL('../', import.meta.url);
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'hamlet-readiness-report-'));
	for (const directory of ['scripts', 'src/lib/i18n', 'src/lib/dev', 'src/lib/data', 'src-tauri/src/commands']) {
		await mkdir(join(root, directory), { recursive: true });
	}
	await cp(new URL('scripts/i18n.mjs', repo), join(root, 'scripts/i18n.mjs'));
	await cp(new URL('src/lib/i18n/', repo), join(root, 'src/lib/i18n'), { recursive: true });
	await cp(new URL('src-tauri/src/commands/native_menu.rs', repo), join(root, 'src-tauri/src/commands/native_menu.rs'));
	for (const path of ['node_modules', 'scripts/i18n-contract.mjs', 'scripts/i18n-records-lib.mjs', 'scripts/i18n-ratchet.mjs', 'scripts/i18n-fresh-keys.mjs', 'src/lib/dev/pseudo-locale.ts', 'src/lib/data/game-text-languages.ts']) {
		await symlink(fileURLToPath(new URL(path, repo)), join(root, path));
	}
	const allowlist = JSON.parse(await readFile(new URL('scripts/i18n-copy-allowlist.json', repo), 'utf8'));
	await writeFile(join(root, 'scripts/i18n-copy-allowlist.json'), JSON.stringify({ literals: allowlist.literals, files: { 'src/lib/data/game-text-languages.ts': allowlist.files['src/lib/data/game-text-languages.ts'] } }));
	await writeFile(join(root, 'scripts/i18n-copy-baseline.json'), '{}\n');
	return root;
}
async function editJSON(root, path, edit) {
	const file = join(root, path);
	const value = JSON.parse(await readFile(file, 'utf8'));
	edit(value);
	await writeFile(file, JSON.stringify(value, null, '\t') + '\n');
}
function run(root, args = []) {
	return spawnSync(process.execPath, [join(root, 'scripts/i18n.mjs'), ...args], {
		cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
		env: { ...process.env, I18N_REPORT: 'test-results/readiness.json', I18N_RELEASE: '0' }
	});
}

test('checker writes actionable readiness diagnostics even when early gates fail', async () => {
	const root = await fixture();
	try {
		const clean = run(root);
		assert.equal(clean.status, 0, clean.stderr);
		await editJSON(root, 'src/lib/i18n/safety-keys.json', (keys) => keys.splice(keys.indexOf('heroes.reset'), 1));
		await editJSON(root, 'src/lib/i18n/locale-status.json', (locales) => delete locales.fr);
		await editJSON(root, 'src/lib/i18n/pilot-status.json', (records) => {
			const record = records.de['settings.restoreWarning'];
			record.status = 'final';
			record.reviewer = { family: 'anthropic', model: 'fixture', date: '2026-10-26', instance: 'report-review' };
			record.semanticVerdict = 'pass'; record.glossaryVersion = 'v1';
			record.safetyVerdict = null;
			record.reviewedSourceHash = record.sourceHash; record.reviewedTranslationHash = record.translationHash;
		});
		const source = await readFile(join(root, 'scripts/i18n.mjs'), 'utf8');
		await writeFile(join(root, 'scripts/i18n.mjs'), source.replace('checkCardinalCategories(locale)', "checkCardinalCategories(locale, ['zero'])"));
		const mapFile = join(root, 'src/lib/i18n/catalogs.ts');
		await writeFile(mapFile, (await readFile(mapFile, 'utf8')).replace('en, de, ru, ja,', 'en, de, ru,'));
		const nativeFile = join(root, 'src-tauri/src/commands/native_menu.rs');
		await writeFile(nativeFile, (await readFile(nativeFile, 'utf8')).replaceAll('/catalogs/ja.json', '/catalogs/en.json'));
		const result = run(root);
		assert.equal(result.status, 1, result.stderr);
		const report = JSON.parse(await readFile(join(root, 'test-results/readiness.json'), 'utf8'));
		for (const gate of ['safety-manifest', 'locale-status', 'runtime-map', 'native-catalogs', 'de:icu', 'de:settings.restoreWarning:record']) {
			assert.ok(report.errors.some((error) => error.gate === gate), `${gate}: ${JSON.stringify(report.errors)}`);
		}
		assert.equal(report.locales.de.records['settings.restoreWarning'], 'invalid-review-record');
		assert.ok(report.errors.some((error) => error.message.includes('passing independent safety verdict')));
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('checker detects stale generated freshness and reports fatal reads and runtime imports', async () => {
	const root = await fixture();
	try {
		await editJSON(root, 'src/lib/i18n/catalogs/en.json', (english) => { english['settings.restoreWarning'] += ' Changed source.'; });
		const stale = run(root);
		assert.equal(stale.status, 1, stale.stderr);
		let report = JSON.parse(await readFile(join(root, 'test-results/readiness.json'), 'utf8'));
		assert.ok(report.errors.some((error) => error.gate === 'generated-fresh-keys'));
		assert.equal(report.locales.de.records['settings.restoreWarning'], 'stale-source');
		assert.equal(run(root, ['--write', '--types-only']).status, 0);
		const fresh = JSON.parse(await readFile(join(root, 'src/lib/i18n/fresh-keys.generated.json'), 'utf8'));
		assert.ok(!fresh.de.includes('settings.restoreWarning'));
		assert.equal(run(root).status, 0);
		await writeFile(join(root, 'src/lib/i18n/catalogs.ts'), 'throw new Error("runtime import probe");');
		assert.equal(run(root).status, 1);
		report = JSON.parse(await readFile(join(root, 'test-results/readiness.json'), 'utf8'));
		assert.ok(report.errors.some((error) => error.gate === 'runtime-imports' && error.message === 'runtime import probe'));
		await writeFile(join(root, 'src/lib/i18n/pilot-status.json'), '{');
		assert.equal(run(root).status, 1);
		report = JSON.parse(await readFile(join(root, 'test-results/readiness.json'), 'utf8'));
		assert.ok(report.errors.some((error) => error.gate === 'catalog-validation' && error.message.includes('JSON')));
	} finally { await rm(root, { recursive: true, force: true }); }
});


test('records CLI scopes authorship and archives to one locale', async () => {
 const root = await fixture();
 try {
  await cp(new URL('scripts/i18n-records.mjs', repo), join(root, 'scripts/i18n-records.mjs'));
  const recordFile = join(root, 'src/lib/i18n/pilot-status.json');
  const before = JSON.parse(await readFile(recordFile, 'utf8'));
  for (const locale of ['de', 'ru']) await editJSON(root, `src/lib/i18n/catalogs/${locale}.json`, (catalog) => { catalog['settings.gameLanguage'] += ' scope probe'; });
  const drafter = { family: 'openai', model: 'fixture', date: '2026-10-26', instance: 'scoped-writer' };
  const result = spawnSync(process.execPath, [join(root, 'scripts/i18n-records.mjs'), '--locale=de', `--drafter=${JSON.stringify(drafter)}`], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const after = JSON.parse(await readFile(recordFile, 'utf8'));
  assert.deepEqual(after.de['settings.gameLanguage'].drafter, drafter);
  assert.deepEqual(after.de['settings.gameLanguage'].previous, before.de['settings.gameLanguage']);
  assert.deepEqual(after.ru, before.ru);
  assert.deepEqual(after.ja, before.ja);
  assert.deepEqual(after.removed, before.removed);
  const invalid = spawnSync(process.execPath, [join(root, 'scripts/i18n-records.mjs'), '--locale=missing'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unknown translated locale: missing/);
 } finally { await rm(root, { recursive: true, force: true }); }
});
