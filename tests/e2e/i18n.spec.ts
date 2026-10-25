import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { GAME_TEXT_LANGUAGES, GAME_TEXT_LOCALES } from '../../src/lib/data/game-text-languages.js';
import type {} from '../../src/lib/dev/harness.js';
async function evidence(info: TestInfo, name: string, body: string | Uint8Array, contentType: string) {
	const path = info.outputPath(name);
	await writeFile(path, body);
	await info.attach(name, { path, contentType });
}

// Locale switches may only request display text, native menu labels and persist
// evidence and the three language keys. All profile and setup settings remain protected.
const switchCommands = new Set(['load_localization', 'plugin:store|load', 'plugin:store|set', 'plugin:store|delete', 'plugin:store|save', 'is_game_running', 'set_native_menu_language', 'collect_language_evidence']);
function expectSwitchCalls(calls: { command: string; args: Record<string, unknown> }[], persisted: Record<string, unknown>) {
	expect(calls.filter(({ command }) => !switchCommands.has(command))).toEqual([]);
	for (const { command, args } of calls) {
		if (!['plugin:store|set', 'plugin:store|delete'].includes(command) || ['gameTextLanguage', 'gameTextMode', 'editorLanguage'].includes(String(args.key))) continue;
		expect(command).toBe('plugin:store|set');
		expect(persisted).toHaveProperty(String(args.key));
		expect(args.value).toEqual(persisted[String(args.key)]);
	}
}

const cycle = ['en', 'ru', 'ja', 'de'];
const allLocales = ['en', 'fr', 'de', 'es', 'it', 'pt-BR', 'pl', 'cs', 'ru', 'zh-Hans', 'ja', 'ko'];
const gameLanguages = ['english', 'french', 'german', 'spanish', 'italian', 'brazilian', 'polish', 'czech', 'russian', 'schinese', 'japanese', 'koreana'];
const catalog = async (locale: string) => JSON.parse(await readFile(new URL(`../../src/lib/i18n/catalogs/${locale}.json`, import.meta.url), 'utf8'));
const renderedCopy: Record<string, { files: string; summary: string; repository: string }> = {
	en: { files: '22 files · profile_0', summary: 'This restore adds 2 files and removes 1 file.', repository: 'GitHub Repository' },
	ru: { files: '22 файла · profile_0', summary: 'Восстановление добавит 2 файла и удалит 1 файл.', repository: 'Репозиторий на GitHub' },
	ja: { files: '22ファイル · profile_0', summary: 'この復元では2ファイルを追加し、1ファイルを削除します。', repository: 'GitHubリポジトリ' },
	de: { files: '22 Dateien · profile_0', summary: 'Diese Wiederherstellung fügt 2 Dateien hinzu und entfernt 1 Datei.', repository: 'GitHub-Repository' }
};

async function open(page: Page) {
	await page.goto('/settings?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect(page.locator('#editor-language')).toBeVisible();
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await expect(page.getByTestId('settings-page').getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
}
const persistedSettings = (page: Page) => page.evaluate(() => {
	const { gameTextLanguage: _language, gameTextMode: _mode, editorLanguage: _editor, ...values } = window.__h1!.persistedSettings();
	return values;
});
const editorId = (locale: string) => Object.entries(GAME_TEXT_LOCALES).find(([, tag]) => tag === locale)![0];
const snapshot = (page: Page) => page.evaluate(() => window.__h1!.snapshot());
async function switchEditor(page: Page, locale: string) {
	const persisted = await persistedSettings(page);
	await page.locator('#editor-language').selectOption(editorId(locale), { force: true });
	await expect.poll(() => page.evaluate(() => window.__h1!.persistedSettings().editorLanguage)).toBe(editorId(locale));
	expect(await persistedSettings(page)).toEqual(persisted);
}
async function switchGame(page: Page, language: string) {
	const persisted = await persistedSettings(page);
	await page.locator('#game-text-language').selectOption(language, { force: true });
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await expect.poll(() => page.evaluate(() => window.__h1!.persistedSettings().gameTextLanguage)).toBe(language);
	expect(await persistedSettings(page)).toEqual(persisted);
}

// These are the same production pickers, with a game-options signal distinct
// from the supported system language in the default harness fixture.
async function switchAutomaticModes(page: Page) {
	for (const [id, choice, locale, language] of [
		['editor-language', 'system', 'en', 'koreana'],
		['game-text-language', 'match-game', 'en', 'russian'],
		['game-text-language', 'same-as-editor', 'en', 'english']
	]) {
		const previous = await page.evaluate(() => window.__h1!.gameText().requested);
		const marker = await page.evaluate(() => window.__h1!.calls.length);
		await page.locator(`#${id}`).selectOption(choice, { force: true });
		await expect.poll(() => page.evaluate((key) => window.__h1!.persistedSettings()[key],
			id === 'editor-language' ? 'editorLanguage' : 'gameTextMode'), { message: `Persist ${choice}` }).toBe(choice);
		await expect(page.locator('html')).toHaveAttribute('lang', locale);
		await expect.poll(() => page.evaluate(() => window.__h1!.gameText())).toMatchObject({ requested: language, effective: language, loading: false });
		const calls = await page.evaluate((start) => window.__h1!.calls.slice(start), marker);
		expect(calls.filter(({ command }) => command === 'load_localization').map(({ args }) => args.language)).toEqual(previous === language ? [] : [language]);
	}
}

async function expectSettingsCopy(page: Page, messages: Record<string, string>) {
	const settings = page.getByTestId('settings-page');
	for (const key of [
		'gameLanguage', 'gameLanguageHelp', 'paths', 'pathsHelp', 'gameInstallation',
		'browse', 'detect', 'saveLocation', 'currentProfile', 'backups', 'backupsHelp',
		'autoBackup', 'autoBackupHelp', 'createBackup', 'openBackupFolder', 'restoreGameBackup',
		'recentBackups', 'restore', 'display', 'displayHelp', 'darkMode', 'darkModeHelp',
		'about', 'version', 'disclaimer'
	]) {
		await expect(settings.getByText(messages[`settings.${key}`], { exact: true }).first()).toHaveCount(1);
	}
	for (const [index, key, placeholder] of [[0, 'gameInstallation', 'gamePathPlaceholder'], [1, 'saveLocation', 'savePathPlaceholder']] as const) {
		const input = settings.locator('textarea[readonly]').nth(index);
		await expect(input).toHaveAttribute('aria-label', messages[`settings.${key}`]);
		await expect(input).toHaveAttribute('placeholder', messages[`settings.${placeholder}`]);
	}
	await expect(settings.locator('[data-slot=select-trigger]')).toHaveAttribute('aria-label', messages['settings.currentProfile']);
	await expect(settings.locator('[role=switch]').first()).toHaveAttribute('aria-label', messages['settings.autoBackup']);
	await expect(settings.locator('[role=switch]').last()).toHaveAttribute('aria-label', messages['settings.darkMode']);
	await expect(settings.locator('label[for=game-text-language]')).toHaveText(messages['settings.gameLanguage']);
}

test('I1-I3: Settings switches live with dirty edits, selected id, partial name and the same open dialog', async ({ page }, info) => {
	await open(page);
	await page.evaluate(() => window.__h1!.edit());
	const before = await snapshot(page);
	await page.getByLabel('Harness selected hero').selectOption(before.heroes[0].id);
	await page.getByLabel('Harness uncommitted name').fill('partially typed <name');
	await page.getByTestId('settings-page').getByRole('button', { name: 'Restore', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	const dialogNode = await dialog.elementHandle();
	const inputNode = await page.getByLabel('Harness uncommitted name').elementHandle();
	const componentNode = await page.getByTestId('settings-page').elementHandle();
	const pathNode = await page.getByTestId('game-folder-path').elementHandle();
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	const navigations: string[] = [];
	page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });

	for (const locale of cycle) {
		// The real picker lives outside the modal. Dispatching its change emulates
		// a real Settings change while keeping the restore dialog open and focused.
		await switchEditor(page, locale);
		const messages = await catalog(locale);
		await expectSettingsCopy(page, messages);
		await expect(page.getByTestId('settings-page').getByText(renderedCopy[locale].files, { exact: true })).toHaveCount(1);
		await expect(page.getByTestId('settings-page').locator('a[href="https://github.com/AlinGheorghe/hamlet-editor"]')).toHaveText(renderedCopy[locale].repository);
		await expect(dialog.getByRole('heading')).toHaveText(messages['settings.restoreBackup']);
		await expect(dialog.locator('[data-slot=dialog-description]')).toContainText(messages['settings.restoreDescription']);
		await expect(dialog.locator('[data-slot=dialog-description]')).toContainText(renderedCopy[locale].summary);
		await expect(dialog.getByText(renderedCopy[locale].files, { exact: true })).toBeVisible();
		await expect(dialog.getByRole('button', { name: messages['common.close'], exact: true })).toBeVisible();
		await expect(dialog.getByText(messages['settings.restoreWarning'], { exact: true })).toBeVisible();
		await expect(dialog.getByText(messages['settings.restoreConfirm'], { exact: true })).toBeVisible();
		await expect(dialog.getByRole('button', { name: messages['settings.cancel'], exact: true })).toBeVisible();
		await expect(dialog.getByRole('button', { name: messages['settings.restore'], exact: true })).toBeDisabled();
		await expect(page.getByLabel('Harness uncommitted name')).toHaveValue('partially typed <name');
		await expect(page.getByLabel('Harness selected hero')).toHaveValue(before.heroes[0].id);
		expect(await snapshot(page)).toEqual(before);
		expect(await persistedSettings(page)).toEqual(persisted);
		expect(await dialogNode!.evaluate((element) => element === document.querySelector('[role=dialog]'))).toBe(true);
		expect(await componentNode!.evaluate((element) => element === document.querySelector('[data-testid=settings-page]'))).toBe(true);
		expect(await inputNode!.evaluate((element) => element === document.querySelector('[aria-label="Harness uncommitted name"]'))).toBe(true);
		expect(await pathNode!.evaluate((element) => element === document.querySelector('[data-testid=settings-page] [data-testid=game-folder-path]'))).toBe(true);
		const rich = page.getByTestId('rich-proof');
		await expect(rich).toContainText('<img src=x onerror=alert(1)>');
		await expect(rich.locator('img')).toHaveCount(0);
		expect(await rich.locator('em,code,a').evaluateAll((elements) => elements.map((element) => element.tagName))).toEqual(
			locale === 'de' ? ['A', 'CODE', 'EM'] : locale === 'ja' ? ['CODE', 'EM', 'A'] : locale === 'ru' ? ['EM', 'A', 'CODE'] : ['EM', 'CODE', 'A']
		);
		await expect(rich.locator('a')).toHaveAttribute('href', 'https://github.com/AlinGheorghe/hamlet-editor');
		await evidence(info, `settings-${locale}.png`, await page.screenshot(), 'image/png');
		await evidence(info, `settings-${locale}.aria.txt`, await page.getByTestId('settings-page').ariaSnapshot(), 'text/plain');
	}
	for (const locale of allLocales) {
		await switchEditor(page, locale);
		expect(await persistedSettings(page)).toEqual(persisted);
	}
	for (const language of gameLanguages) {
		await page.locator('#game-text-language').selectOption(language, { force: true });
		await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
		await expect.poll(() => page.evaluate(() => window.__h1!.persistedSettings().gameTextLanguage)).toBe(language);
		expect(await snapshot(page)).toEqual(before);
		expect(await persistedSettings(page)).toEqual(persisted);
	}
	await expect(page.getByLabel('Harness uncommitted name')).toHaveValue('partially typed <name');
	await expect(page.getByLabel('Harness selected hero')).toHaveValue(before.heroes[0].id);
	expect(await snapshot(page)).toEqual(before);
	expect(await persistedSettings(page)).toEqual(persisted);
	expect(await dialogNode!.evaluate((element) => element === document.querySelector('[role=dialog]'))).toBe(true);
	expect(await componentNode!.evaluate((element) => element === document.querySelector('[data-testid=settings-page]'))).toBe(true);
	expect(await inputNode!.evaluate((element) => element === document.querySelector('[aria-label="Harness uncommitted name"]'))).toBe(true);
	expect(await pathNode!.evaluate((element) => element === document.querySelector('[data-testid=settings-page] [data-testid=game-folder-path]'))).toBe(true);
	const calls = await page.evaluate((start) => window.__h1!.calls.slice(start), marker);
	expectSwitchCalls(calls, persisted);
	expect(await persistedSettings(page)).toEqual(persisted);
	expect(calls.filter(({ command }) => command === 'load_localization').map(({ args }) => args.language)).toEqual(gameLanguages.slice(1));
	expect(navigations).toEqual([]);
	await expect(dialog).toBeVisible();
	await evidence(info, 'intl-host-plurals.json', JSON.stringify(await page.evaluate((locales) => ({
		userAgent: navigator.userAgent,
		plurals: Object.fromEntries(locales.map((locale) => [locale, {
			categories: new Intl.PluralRules(locale).resolvedOptions().pluralCategories,
			samples: [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 1.5, 1000000].map((n) => [n, new Intl.PluralRules(locale).select(n)])
		}]))
	}), allLocales), null, 2), 'application/json');
});

test('P1: Russian plural branches render in Settings through the mounted UI', async ({ page }, info) => {
	await open(page);
	await page.evaluate(() => window.__h1!.plans.push({ command: 'list_backups', value: [1, 2, 5, 11, 21, 22, 25].map((count) => ({
		path: `/h1/backup-${count}`, timestamp: '2026-10-25T10:00:00Z', file_count: count, profile_id: 'profile_0'
	})) }));
	await page.getByTestId('settings-page').getByRole('button', { name: 'Create Backup Now', exact: true }).click();
	await switchEditor(page, 'ru');
	for (const [count, noun] of [[1, 'файл'], [2, 'файла'], [5, 'файлов'], [11, 'файлов'], [21, 'файл'], [22, 'файла'], [25, 'файлов']]) {
		await expect(page.getByTestId('settings-page').getByText(`${count} ${noun} · profile_0`, { exact: true })).toHaveCount(1);
	}
	await evidence(info, 'russian-settings-plurals.aria.txt', await page.getByTestId('settings-page').ariaSnapshot(), 'text/plain');
});

test('I1: reversed, failed and empty responses retain the effective table, including a real path race', async ({ page }) => {
	await open(page);
	await page.evaluate(() => {
		window.__h1!.plans.push({ command: 'load_localization', language: 'russian', hold: 'ru' });
	});
	await page.locator('#game-text-language').selectOption('russian');
	await expect.poll(() => page.evaluate(() => window.__h1!.held())).toContain('ru');
	await switchGame(page, 'japanese');
	await page.evaluate(() => window.__h1!.release('ru'));
	await expect(page.getByTestId('game-name-pair')).toHaveText('japanese:crusader | japanese:vestal');
	for (const plan of [{ fail: 'fixture IO failure' }, { empty: true }]) {
		await page.evaluate((plan) => window.__h1!.plans.push({ command: 'load_localization', ...plan }), plan);
		await switchGame(page, plan.empty ? 'polish' : 'koreana');
		expect(await page.evaluate(() => window.__h1!.gameText())).toMatchObject({ effective: 'japanese', error: true, errorDetail: plan.empty ? 'Error: Empty game text table' : 'Error: fixture IO failure' });
		await expect(page.getByTestId('game-text-diagnostic')).toContainText(plan.empty ? 'Empty game text table' : 'fixture IO failure');
		await expect(page.getByTestId('game-name-pair')).toHaveAttribute('lang', 'ja');
		await expect(page.getByTestId('game-text-error')).toContainText('日本語');
		await expect(page.getByTestId('game-name-pair')).toHaveText('japanese:crusader | japanese:vestal');
	}
	// Hold the current installation's request, then browse through the actual
	// Settings data-change guard, name-table barrier and profile reload.
	await page.evaluate(() => {
		window.__h1!.plans.push({ command: 'load_localization', gamePath: '/h1/game', language: 'russian', hold: 'path' });
	});
	await page.locator('#game-text-language').selectOption('russian');
	await expect.poll(() => page.evaluate(() => window.__h1!.held())).toContain('path');
	const marker = await page.evaluate(() => {
		window.__h1!.plans.push({ command: 'plugin:dialog|open', value: '/h1/new-game' });
		return window.__h1!.calls.length;
	});
	await page.getByTestId('settings-page').getByRole('button', { name: 'Browse', exact: true }).first().click();
	await expect.poll(() => page.evaluate(() => window.__h1!.getSettings().gamePath)).toBe('/h1/new-game');
	await expect.poll(() => page.evaluate(() => window.__h1!.snapshot().gamePath)).toBe('/h1/new-game');
	await switchGame(page, 'german');
	await page.evaluate(() => window.__h1!.release('path'));
	await expect(page.getByTestId('game-name-pair')).toHaveText('german:crusader | german:vestal');
	expect(await page.evaluate(() => window.__h1!.gameText().path)).toBe('/h1/new-game');
	expect(await page.evaluate(() => window.__h1!.getSettings().gamePath)).toBe('/h1/new-game');
	const pathCalls = await page.evaluate((start) => window.__h1!.calls.slice(start), marker);
	expect(pathCalls).toEqual(expect.arrayContaining([
		expect.objectContaining({ command: 'plugin:dialog|open' }),
		expect.objectContaining({ command: 'generate_name_table', args: { gamePath: '/h1/new-game' } }),
		expect.objectContaining({ command: 'set_name_table' }),
		expect.objectContaining({ command: 'load_profile' })
	]));
	for (const language of gameLanguages) {
		await switchGame(page, language);
		await expect(page.getByTestId('unknown-id')).toHaveText('Unknown Mod Id');
	}
});

test('I2: identical edit scripts capture identical save payloads with and without switches', async ({ page }, info) => {
	const payloads = [];
	for (const switches of [false, true]) {
		await open(page);
		const baseline = await snapshot(page);
		await page.evaluate(() => window.__h1!.edit());
		const edited = await snapshot(page);
		const expected = structuredClone(baseline.data);
		const roster = expected.roster as { base_root: { heroes: Record<string, { hero_file_data: { raw_data: { base_root: { actor: { name: string }; quirks: Record<string, unknown> } } } }> } };
		const root = roster.base_root.heroes[edited.heroes[0].id].hero_file_data.raw_data.base_root;
		root.actor.name = 'Backups';
		root.quirks.unknown_mod_quirk = { is_locked: true, is_new: false, mission_count: 0, replaces_quirk: 0, replaces_quirk_viewed: false, evolution_duration_remaining: 0 };
		expect(edited.data).toEqual(expected);
		expect(edited.heroes[0]).toMatchObject({ name: 'Backups', heroClass: 'unknown_mod_class' });
		if (switches) {
			for (const locale of allLocales) await switchEditor(page, locale);
			for (const language of gameLanguages) await switchGame(page, language);
			await switchAutomaticModes(page);
		}
		await page.evaluate(() => window.__h1!.save());
		const calls = await page.evaluate(() => window.__h1!.calls.filter(({ command }) => command === 'save_profile'));
		expect(calls).toHaveLength(1);
		payloads.push(calls[0].args);
		await evidence(info, `save-payload-${switches ? 'switched' : 'baseline'}.json`, JSON.stringify(calls[0].args, null, 2), 'application/json');
	}
	expect(payloads[1]).toEqual(payloads[0]);
	const fixture = JSON.parse(await readFile(new URL('../fixtures/i18n-save-payload.json', import.meta.url), 'utf8'));
	expect(payloads[0].data).toEqual(fixture);
});

test('D12: a persistent restore error and third-party aria labels update in place', async ({ page }) => {
	await open(page);
	await page.evaluate(() => window.__h1!.plans.push({ command: 'check_restore', fail: 'fixture: read denied at /h1/backup' }));
	await page.getByTestId('settings-page').getByRole('button', { name: 'Restore', exact: true }).click();
	const alert = page.getByRole('alert').filter({ hasText: 'fixture: read denied' });
	await expect(alert).toContainText('Restore unavailable');
	const node = await alert.elementHandle();
	for (const locale of cycle) {
		await switchEditor(page, locale);
		const messages = await catalog(locale);
		await expect(alert).toContainText(messages['settings.restoreUnavailable']);
		await expect(alert).toContainText('fixture: read denied at /h1/backup');
		expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
		await expect(page.getByRole('button', { name: messages['common.closeToast'], exact: true })).toBeVisible();
	}
});

test('I1: dirty and blocked-save guards survive switches', async ({ page }) => {
	await open(page);
	await page.evaluate(() => { window.__h1!.edit(); window.__h1!.markStale(); });
	for (const locale of cycle) await switchEditor(page, locale);
	// The header Save button sits inside its tooltip trigger, so the inner node is the real button.
	await expect(page.getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true }).last()).toBeDisabled();
	await expect(page.getByText('Profile stale: Reload required', { exact: true })).toBeVisible();
	await page.evaluate(() => window.__h1!.plans.push({ command: 'plugin:dialog|open', value: '/h1/another-profile' }));
	const messages = await catalog('de');
	await page.getByTestId('settings-page').getByRole('button', { name: messages['settings.browse'], exact: true }).nth(1).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
	expect((await snapshot(page)).dirtyFiles).toContain('persist.roster.json');
});

for (const route of ['heroes', 'estate'] as const) {
	test(`I1/I2: paired saves while real /${route} game-name UI stays mounted`, async ({ page }, info) => {
		const payloads: Record<string, unknown>[] = [];
		for (const switches of [false, true]) {
			await page.goto(`/${route}?h1`);
			await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
			await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
			await page.evaluate(() => window.__h1!.edit());
			const before = await snapshot(page);
			let selectedRow;
			if (route === 'heroes') {
				const row = page.getByRole('button').filter({ hasText: 'Backups' }).filter({ hasText: 'unknown_mod_class' });
				await row.click();
				selectedRow = await row.elementHandle();
				await expect(row).toHaveClass(/bg-accent/);
				await page.getByRole('button', { name: 'Backups', exact: true }).click();
			}
			const input = route === 'heroes' ? page.getByRole('textbox', { name: 'Hero name', exact: true }) : page.getByPlaceholder('Enter estate name...');
			// A literal game display string remains user data even when that map changes.
			await input.fill('english:crusader');
			const inputNode = await input.elementHandle();
			const persisted = await persistedSettings(page);
			const marker = await page.evaluate(() => window.__h1!.calls.length);
			if (switches) {
				for (const locale of allLocales) {
					await switchEditor(page, locale);
					await expect(input).toHaveValue('english:crusader');
					expect(await snapshot(page)).toEqual(before);
					expect(await persistedSettings(page)).toEqual(persisted);
				}
				for (const language of gameLanguages) {
					await switchGame(page, language);
					await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
					await expect.poll(() => page.evaluate(() => window.__h1!.persistedSettings().gameTextLanguage)).toBe(language);
					if (route === 'heroes') await expect(page.getByText(`${language}:crusader`, { exact: true })).toBeVisible();
					else await expect(page.locator('p[title="h1_trinket_a"]')).toHaveText(`${language}:trinket-a`);
					await expect(input).toHaveValue('english:crusader');
					expect(await snapshot(page)).toEqual(before);
					expect(await persistedSettings(page)).toEqual(persisted);
				}
				await switchAutomaticModes(page);
				await expect(input).toHaveValue('english:crusader');
				expect(await snapshot(page)).toEqual(before);
			}
			expect(await inputNode!.evaluate((element) => element.isConnected && element === document.activeElement)).toBe(true);
			if (selectedRow) expect(await selectedRow.evaluate((element) => element.isConnected && element.classList.contains('bg-accent'))).toBe(true);
			expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), persisted);
			expect(await persistedSettings(page)).toEqual(persisted);
			await input.press('Enter');
			const edited = await snapshot(page);
			const expected = structuredClone(before.data);
			if (route === 'heroes') {
				const roster = expected.roster as { base_root: { heroes: Record<string, { hero_file_data: { raw_data: { base_root: { actor: { name: string } } } } }> } };
				roster.base_root.heroes[before.heroes[0].id].hero_file_data.raw_data.base_root.actor.name = 'english:crusader';
			} else {
				(expected.game as { base_root: { estatename: string } }).base_root.estatename = 'english:crusader';
			}
			expect(edited.data).toEqual(expected);
			expect(edited.heroes[0].heroClass).toBe('unknown_mod_class');
			// Exercise the actual header save and its validation choice. The synthetic
			// roster may warn, so accept the explicit Save Anyway without auto-fixes.
			const saveButton = page.getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true }).last();
			await expect(saveButton).toBeEnabled();
			await saveButton.click();
			await expect.poll(async () =>
				await page.evaluate(() => window.__h1!.calls.some(({ command }) => command === 'save_profile')) ||
				await page.getByRole('dialog').filter({ hasText: 'Pre-Save Validation' }).isVisible()
			).toBe(true);
			const validation = page.getByRole('dialog').filter({ hasText: 'Pre-Save Validation' });
			if (await validation.isVisible()) await validation.getByRole('button', { name: 'Save Anyway', exact: true }).click();
			await expect.poll(() => page.evaluate(() => window.__h1!.calls.filter(({ command }) => command === 'save_profile').length)).toBe(1);
			const call = await page.evaluate(() => window.__h1!.calls.find(({ command }) => command === 'save_profile')!);
			expect(call.args.data).toEqual(edited.dirty);
			payloads.push(call.args);
			await evidence(info, `${route}-${switches ? 'switched' : 'baseline'}-save.json`, JSON.stringify(call.args, null, 2), 'application/json');
			await evidence(info, `${route}-${switches ? 'switched' : 'baseline'}.aria.txt`, await page.locator('main main').ariaSnapshot(), 'text/plain');
		}
		expect(payloads[1]).toEqual(payloads[0]);
	});
}

test('D12: a failed game-text request on Heroes raises one live persistent diagnostic', async ({ page }) => {
	await page.goto('/heroes?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await page.evaluate(() => {
		window.__h1!.plans.push({ command: 'load_localization', fail: 'fixture: unreadable /h1/game' });
	});
	await switchGame(page, 'koreana');
	const alert = page.getByRole('alert').filter({ hasText: 'fixture: unreadable /h1/game' });
	await expect(alert).toHaveCount(1);
	await expect(alert).toContainText('Could not load');
	const node = await alert.elementHandle();
	for (const locale of cycle) {
		await switchEditor(page, locale);
		await expect(alert).toHaveCount(1);
		expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
		const expected = (await catalog(locale))['settings.gameTextFailed']
			.replace('{requested}', GAME_TEXT_LANGUAGES.koreana)
			.replace('{effective}', GAME_TEXT_LANGUAGES.english);
		await expect(alert.locator('p').first()).toHaveText(expected);
	}
	await page.evaluate(() => {
		window.__h1!.plans.push({ command: 'load_localization', fail: 'fixture: second failure' });
	});
	await switchGame(page, 'polish');
	const gameAlerts = page.getByRole('alert').filter({ hasText: /fixture: (unreadable|second failure)/ });
	await expect(page.getByRole('alert').filter({ hasText: 'fixture: second failure' })).toHaveCount(1);
	await expect(gameAlerts).toHaveCount(1);
	await expect(alert).toHaveCount(0);
	await page.evaluate(() => {
		window.__h1!.plans.push({ command: 'load_localization', language: 'german', hold: 'recovery' });
	});
	await page.locator('#game-text-language').selectOption('german');
	await expect.poll(() => page.evaluate(() => window.__h1!.held())).toContain('recovery');
	await expect(gameAlerts).toHaveCount(0);
	await page.evaluate(() => window.__h1!.release('recovery'));
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText())).toMatchObject({ loading: false, error: false, effective: 'german' });
	await expect(gameAlerts).toHaveCount(0);
});

for (const scenario of ['hanging-read', 'unreadable', 'late-detection']) {
	test(`D9: ${scenario} opens in English, never writes defaults and ignores late results`, async ({ page }, info) => {
		await page.goto(`/settings?h1&startup=${scenario}`);
		if (scenario !== 'unreadable') {
			await expect(page.getByTestId('startup-shell')).toBeVisible();
			await expect(page.getByTestId('startup-shell')).toHaveText('');
		}
		await expect(page.locator('#editor-language')).toBeVisible({ timeout: 4000 });
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		const notice = scenario === 'hanging-read' ? (await catalog('en'))['startup.settingsTimeout']
			: scenario === 'unreadable' ? (await catalog('en'))['startup.settingsUnreadable'].replace('{folder}', '/h1/settings')
			: 'Language detection was unavailable at startup. Automatic language choices use English for this launch.';
		await expect(page.getByText(notice, { exact: true })).toBeVisible();
		const elapsed = await page.evaluate(() => window.__h1!.getSettings().startupElapsedMs);
		if (scenario !== 'unreadable') expect(elapsed).toBeGreaterThanOrEqual(1900);
		expect(elapsed).toBeLessThan(2800);
		const stored = await page.evaluate(() => window.__h1!.persistedSettings());
		if (scenario === 'hanging-read') await page.evaluate(() => window.__h1!.release('startup-read'));
		if (scenario === 'late-detection') {
			// A manual choice remains active even after the abandoned launch result arrives.
			await page.locator('#editor-language').selectOption('japanese');
			await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
			await page.evaluate(() => window.__h1!.release('startup-detection'));
		} else await page.locator('#editor-language').selectOption('german');
		await expect(page.locator('html')).toHaveAttribute('lang', scenario === 'late-detection' ? 'ja' : 'de');
		// Drain two animation frames after the held IPC response and assert again.
		await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		await expect(page.locator('html')).toHaveAttribute('lang', scenario === 'late-detection' ? 'ja' : 'de');
		if (scenario === 'late-detection') {
			await expect.poll(() => page.evaluate(() => window.__h1!.persistedSettings().editorLanguage)).toBe('japanese');
			expect(await persistedSettings(page)).toEqual(Object.fromEntries(Object.entries(stored).filter(([key]) => !['editorLanguage', 'gameTextMode', 'gameTextLanguage'].includes(key))));
		} else {
			expect(await page.evaluate(() => window.__h1!.persistedSettings())).toEqual(stored);
			expect(await page.evaluate(() => window.__h1!.calls.filter(({ command }) => /plugin:store\|(set|delete|save)/.test(command)))).toEqual([]);
		}
		await evidence(info, `bootstrap-${scenario}.json`, JSON.stringify({ elapsedMs: elapsed, persistedUnchanged: true }), 'application/json');
	});
}

test('D2: late path detection cannot override a manual choice in either picker', async ({ page }) => {
	await open(page);
	await page.evaluate(() => window.__h1!.plans.push(
		{ command: 'collect_language_evidence', gamePath: '/h1/new-game', hold: 'detect-path', value: {
			os_locales: { status: 'ok', value: ['de-DE'] },
			game_options: { status: 'ok', value: { language: 'koreana', path_kind: 'linux_data', verified: false } },
			steam_manifest: { status: 'ok', value: 'german' }
		} },
		{ command: 'plugin:dialog|open', value: '/h1/new-game' }
	));
	await page.getByTestId('settings-page').getByRole('button', { name: 'Browse', exact: true }).first().click();
	await expect.poll(() => page.evaluate(() => window.__h1!.held())).toContain('detect-path');
	await expect.poll(() => page.evaluate(() => window.__h1!.snapshot().gamePath)).toBe('/h1/new-game');
	await switchEditor(page, 'ru');
	await switchGame(page, 'japanese');
	await page.evaluate(() => window.__h1!.release('detect-path'));
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().effective)).toBe('japanese');
	await expect(page.locator('#editor-language')).toHaveValue('russian');
	await expect(page.locator('#game-text-language')).toHaveValue('japanese');
});

test('D1/D8: before setup, real pickers update html lang and CJK typography live', async ({ page }) => {
	await page.goto('/settings?h1&preSetup');
	await expect(page.locator('#editor-language')).toBeVisible();
	const protectedSettings = await persistedSettings(page);
	for (const [locale, firstFont] of [['zh-Hans', 'PingFang SC'], ['ja', 'Hiragino Sans'], ['ko', 'Apple SD Gothic Neo'], ['en', 'JetBrains Mono Variable']]) {
		await switchEditor(page, locale);
		await expect(page.locator('html')).toHaveAttribute('lang', locale);
		await expect(page.locator('html')).toHaveClass(locale === 'en' ? /^(?!.*\bcjk\b)/ : /\bcjk\b/);
		expect(await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily)).toContain(firstFont);
		if (locale !== 'en') {
			const styles = await page.locator('main [class*="text-[11px]"]').first().evaluate((element) => {
				const style = getComputedStyle(element); return { size: parseFloat(style.fontSize), spacing: style.letterSpacing, transform: style.textTransform };
			});
			expect(styles).toEqual({ size: 12, spacing: 'normal', transform: 'none' });
		}
	}
	await page.locator('#game-text-language').selectOption('same-as-editor');
	await expect.poll(() => page.evaluate(() => window.__h1!.persistedSettings().gameTextMode)).toBe('same-as-editor');
	expect(await page.evaluate(() => window.__h1!.persistedSettings())).not.toHaveProperty('gameTextLanguage');
	expect(await persistedSettings(page)).toEqual(protectedSettings);
	expect(await page.evaluate(() => window.__h1!.calls.filter(({ command }) => command === 'load_profile'))).toEqual([]);
});

test('M1: corrupt settings recover with a live persistent kept-copy notice and working writes', async ({ page }) => {
	await page.goto('/settings?h1&startup=corrupt');
	await expect(page.locator('#editor-language')).toBeVisible();
	const notice = page.getByRole('alert').filter({ hasText: 'settings.json.corrupt-123/settings.json' });
	await expect(notice).toHaveCount(1);
	await expect(notice).toContainText('/h1/settings');
	await expect(notice).toContainText('Starting with defaults; new settings can be saved.');
	const node = await notice.elementHandle();
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	await switchEditor(page, 'de');
	await expect(notice).toContainText((await catalog('de'))['startup.settingsRecovered'].replace('{folder}', '/h1/settings').replace('{copy}', 'settings.json.corrupt-123/settings.json'));
	expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	await expect(page.locator('#game-text-language')).toHaveValue('match-game');
	expect(await page.evaluate((start) => window.__h1!.calls.slice(start).some(({ command }) => command === 'plugin:store|save'), marker)).toBe(true);
});

test('F4: a stored manual editor choice survives detection timeout and matches its picker', async ({ page }) => {
	await page.goto('/settings?h1&startup=manual-timeout');
	await expect(page.locator('#editor-language')).toBeVisible({ timeout: 4000 });
	await expect(page.locator('#editor-language')).toHaveValue('german');
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	await expect(page.getByTestId('editor-language-source')).toHaveText('Deutsch: Ihre Auswahl');
	await expect(page.getByRole('alert').filter({ hasText: (await catalog('de'))['startup.gameTextFallback'] })).toHaveCount(1);
	await expect.poll(() => page.evaluate(() => window.__h1!.getSettings().language)).toBe('german');
	await page.evaluate(() => {
		window.__h1!.plans.push({ command: 'collect_language_evidence', hold: 'first-refresh' });
		(window as unknown as { localeChanges: string[] }).localeChanges = [];
		new MutationObserver((records) => {
			for (const record of records) (window as unknown as { localeChanges: string[] }).localeChanges.push(record.oldValue ?? '');
		}).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'], attributeOldValue: true });
	});
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	await page.locator('#editor-language').selectOption('system');
	await expect.poll(() => page.evaluate(() => window.__h1!.held())).toContain('first-refresh');
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	expect(await page.evaluate((start) => window.__h1!.calls.slice(start).filter(({ command, args }) =>
		command === 'set_native_menu_language' && args.locale === 'en' || command === 'load_localization' && args.language === 'english'), marker)).toEqual([]);
	expect(await page.evaluate(() => (window as unknown as { localeChanges: string[] }).localeChanges)).toEqual([]);
	await expect.poll(() => page.evaluate(() => window.__h1!.getSettings().language)).toBe('german');
	await page.evaluate(() => window.__h1!.release('first-refresh'));
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await switchEditor(page, 'ja');
	await page.evaluate(() => window.__h1!.release('startup-detection'));
	await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
});

test('M2/F8: System, Match game and Same as editor preserve dirty state and diagnostics without a locale flap or extra table request', async ({ page }) => {
	await page.goto('/settings?h1&automatic');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	// The unsupported OS fixture makes System use the Russian game-options signal.
	await switchEditor(page, 'en');
	await page.evaluate(() => window.__h1!.edit());
	const before = await snapshot(page);
	await page.getByLabel('Harness selected hero').selectOption(before.heroes[0].id);
	await page.getByLabel('Harness uncommitted name').fill('automatic partially typed name');
	await page.getByTestId('settings-page').getByRole('button', { name: 'Restore', exact: true }).click();
	const dialog = page.getByRole('dialog');
	const dialogNode = await dialog.elementHandle();
	const input = page.getByLabel('Harness uncommitted name');
	const inputNode = await input.elementHandle();
	await switchEditor(page, 'de');
	await page.evaluate(() => window.__h1!.plans.push({ command: 'load_localization', language: 'russian', fail: 'automatic mode fixture diagnostic' }));
	await switchGame(page, 'russian');
	const diagnostic = page.locator('[role=alert]').filter({ hasText: 'automatic mode fixture diagnostic' });
	await expect(diagnostic).toHaveCount(1);
	const diagnosticNode = await diagnostic.elementHandle();
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => {
		window.__h1!.plans.push({ command: 'collect_language_evidence', hold: 'system-refresh' });
		return window.__h1!.calls.length;
	});
	const locales = await page.evaluateHandle(() => {
		const seen: string[] = [document.documentElement.lang];
		const observer = new MutationObserver((records) => {
			for (const record of records) seen.push(record.oldValue ?? '');
			seen.push(document.documentElement.lang);
		});
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'], attributeOldValue: true });
		return { seen, stop() { observer.disconnect(); } };
	});
	await page.locator('#editor-language').selectOption('system', { force: true });
	await expect.poll(() => page.evaluate(() => window.__h1!.held())).toContain('system-refresh');
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	for (const mode of ['same-as-editor', 'match-game', 'same-as-editor']) {
		await page.locator('#game-text-language').selectOption(mode, { force: true });
		await expect.poll(() => page.evaluate(() => window.__h1!.persistedSettings().gameTextMode)).toBe(mode);
		await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
		await expect.poll(() => page.evaluate(() => window.__h1!.gameText())).toMatchObject({ requested: 'russian', effective: 'english', loading: false, error: true, errorDetail: 'Error: automatic mode fixture diagnostic' });
		await expect(input).toHaveValue('automatic partially typed name');
		await expect(page.getByLabel('Harness selected hero')).toHaveValue(before.heroes[0].id);
		expect(await snapshot(page)).toEqual(before);
		expect(await persistedSettings(page)).toEqual(persisted);
		expect(await dialogNode!.evaluate((element) => element.isConnected && element === document.querySelector('[role=dialog]'))).toBe(true);
		expect(await inputNode!.evaluate((element) => element.isConnected)).toBe(true);
		expect(await diagnosticNode!.evaluate((element) => element.isConnected)).toBe(true);
	}
	await page.evaluate(() => window.__h1!.release('system-refresh'));
	await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	const calls = await page.evaluate((start) => window.__h1!.calls.slice(start), marker);
	expectSwitchCalls(calls, persisted);
	expect(calls.filter(({ command }) => command === 'load_localization')).toEqual([]);
	expect(calls.filter(({ command }) => command === 'set_native_menu_language').map(({ args }) => args.locale)).not.toContain('en');
	expect(await locales.evaluate((history) => { history.stop(); return history.seen; })).not.toContain('en');
	await locales.dispose();
	await expect(diagnostic).toHaveCount(1);
	expect(await snapshot(page)).toEqual(before);
	await page.evaluate(() => window.__h1!.markStale());
	await expect(page.getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true, includeHidden: true }).last()).toBeDisabled();
	await expect(dialog).toBeVisible();
});

test('F5: unavailable options are marked only after the installed-language check succeeds', async ({ page }) => {
	await page.goto('/settings?h1&installed=limited');
	await expect.poll(() => page.evaluate(() => window.__h1?.held() ?? [])).toContain('installed-languages');
	await expect(page.locator('#game-text-language option[value=koreana]')).toHaveText('한국어');
	await page.evaluate(() => window.__h1!.release('installed-languages'));
	await expect(page.locator('#game-text-language option[value=koreana]')).toHaveText('한국어 (not available)');
	await expect(page.locator('#game-text-language option[value=russian]')).toHaveText('Русский');
	await expect(page.locator('#game-text-language option[value=match-game]')).toHaveText('Match game');
	await page.goto('/settings?h1&installed=failed');
	await expect(page.getByText('Installed languages could not be checked. Your saved selection is retained.', { exact: true })).toBeVisible();
	await expect(page.locator('#game-text-language option[value=koreana]')).toHaveText('한국어');
});

test('M2: changing installation keeps OD2 languages until fresh path evidence arrives', async ({ page }) => {
	await page.goto('/settings?h1&automatic');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await page.locator('#game-text-language').selectOption('match-game');
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText())).toMatchObject({ effective: 'russian', loading: false });
	const marker = await page.evaluate(() => {
		window.__h1!.plans.push(
			{ command: 'plugin:dialog|open', value: '/h1/new-game' },
			{ command: 'collect_language_evidence', gamePath: '/h1/new-game', hold: 'new-installation', value: {
				os_locales: { status: 'ok', value: ['tr-TR'] },
				game_options: { status: 'ok', value: { language: 'japanese', path_kind: 'fixture', verified: false } },
				steam_manifest: { status: 'absent', value: null }
			} }
		);
		return window.__h1!.calls.length;
	});
	await page.getByTestId('settings-page').getByRole('button', { name: (await catalog('ru'))['settings.browse'], exact: true }).first().click();
	await expect.poll(() => page.evaluate(() => window.__h1!.held())).toContain('new-installation');
	await expect.poll(() => page.evaluate(() => window.__h1!.snapshot().gamePath)).toBe('/h1/new-game');
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText())).toMatchObject({ requested: 'russian', effective: 'russian', path: '/h1/new-game', loading: false });
	await page.evaluate(() => window.__h1!.release('new-installation'));
	await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText())).toMatchObject({ requested: 'japanese', effective: 'japanese', path: '/h1/new-game', loading: false });
	const calls = await page.evaluate((start) => window.__h1!.calls.slice(start), marker);
	expect(calls.filter(({ command }) => command === 'load_localization').map(({ args }) => [args.gamePath, args.language])).toEqual([
		['/h1/new-game', 'russian'], ['/h1/new-game', 'japanese']
	]);
	expect(calls.filter(({ command }) => command === 'set_native_menu_language').map(({ args }) => args.locale)).not.toContain('en');
});

for (const locale of ['en', 'de', 'ja']) {
	for (const viewport of [{ width: 800, height: 600 }, { width: 1366, height: 768 }]) {
		test(`P1c: full folder paths at ${viewport.width}x${viewport.height} (${locale})`, async ({ page }, info) => {
			await page.setViewportSize(viewport);
			await page.goto('/settings?h1&longPaths');
			await expect.poll(() => page.evaluate(() => window.__h1?.getSettings().ready)).toBe(true);
			await switchEditor(page, locale);
			for (const kind of ['game', 'save']) {
				const path = page.getByTestId(`${kind}-folder-path`);
				const fullPath = await page.evaluate((key) => String(window.__h1!.persistedSettings()[key]), `${kind}Path`);
				await expect(path).toHaveValue(fullPath);
				// Center the field so the sticky header and the viewport edge cannot hide it.
				await path.evaluate((element) => element.scrollIntoView({ block: 'center' }));
				await expect(path).toBeVisible();
				const geometry = await path.evaluate((element) => {
					const rect = element.getBoundingClientRect();
					const style = getComputedStyle(element);
					const singleLineHeight = parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
					return {
						unclipped: element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
						fullTextVisible: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && element.scrollTop === 0 && element.scrollLeft === 0,
						wrapped: rect.height > singleLineHeight + 1
					};
				});
				expect(geometry).toEqual({ unclipped: true, fullTextVisible: true, wrapped: true });
				await evidence(info, `p1c-${locale}-${viewport.width}-${kind}-path.png`, await page.screenshot(), 'image/png');
			}
		});
	}
}

for (const [scenario, detail] of [['unreadable', 'fixture: settings read denied'], ['recovery-failed', 'fixture: settings recovery denied']]) {
	test(`P1c: settings raw diagnostic survives locale changes (${scenario})`, async ({ page }) => {
		await page.goto(`/settings?h1&startup=${scenario}`);
		await expect.poll(() => page.evaluate(() => window.__h1?.getSettings().ready)).toBe(true);
		const raw = page.getByRole('alert').getByText(detail, { exact: false });
		await expect(raw).toBeVisible();
		const text = await raw.textContent();
		await page.locator('#editor-language').selectOption('german', { force: true });
		await expect(page.locator('html')).toHaveAttribute('lang', 'de');
		await expect(raw).toHaveText(text!);
		const expected = (await catalog('de'))['startup.settingsUnreadable'].replace('{folder}', '/h1/settings');
		await expect(page.getByRole('alert').filter({ hasText: expected })).toHaveCount(1);
	});
}

test('P1c: path fields retain keyboard focus and empty translated placeholders', async ({ page }) => {
	await page.goto('/settings?h1&emptyPaths');
	await expect.poll(() => page.evaluate(() => window.__h1?.getSettings().ready)).toBe(true);
	// A single-line field shares its center line with the Browse button.
	const gameField = page.getByTestId('game-folder-path');
	const gameRow = gameField.locator('xpath=ancestor::div[contains(@class, "flex-wrap")][1]');
	const centers = await gameRow.evaluate((row) => {
		const center = (element: Element) => { const rect = element.getBoundingClientRect(); return rect.top + rect.height / 2; };
		return { field: center(row.querySelector('textarea')!), button: center(row.querySelector('button')!) };
	});
	expect(Math.abs(centers.field - centers.button)).toBeLessThanOrEqual(1);
	// At the narrowest supported width a wrapping placeholder is never clipped.
	await page.setViewportSize({ width: 800, height: 600 });
	for (const locale of ['en', 'de', 'ru', 'ja']) {
		await switchEditor(page, locale);
		const messages = await catalog(locale);
		for (const [kind, label] of [['game', 'gameInstallation'], ['save', 'saveLocation']]) {
			const field = page.getByTestId(`${kind}-folder-path`);
			await expect(field).toHaveValue('');
			await expect(field).toHaveAttribute('placeholder', messages[`settings.${kind}PathPlaceholder`]);
			await expect(field).toHaveAttribute('aria-label', messages[`settings.${label}`]);
			await expect.poll(() => field.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
		}
	}
	await page.locator('#game-text-language').focus();
	for (const kind of ['game', 'save']) {
		const field = page.getByTestId(`${kind}-folder-path`);
		for (let step = 0; step < 40; step++) {
			await page.keyboard.press('Tab');
			if (await field.evaluate((element) => element === document.activeElement)) break;
		}
		await expect(field).toBeFocused();
	}
});
