import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { GAME_TEXT_LANGUAGES, GAME_TEXT_LOCALES } from '../../src/lib/data/game-text-languages.js';
import type {} from '../../src/lib/dev/harness.js';
// svelte-sonner keeps stacking state (data-front, data-expanded, data-visible)
// on the toast list item that wraps our alert content. A replaced toast stays
// in the DOM with data-removed while it animates out, so it is skipped.
function toastOf(page: Page, content: Locator) {
	return page.locator('[data-sonner-toast][data-removed="false"]').filter({ has: content });
}
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
	// Save is one focusable button that also owns its tooltip trigger handlers.
	await expect(page.getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true })).toBeDisabled();
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
			const saveButton = page.getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true });
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
			await evidence(info, `${route}-${switches ? 'switched' : 'baseline'}.aria.txt`, await page.getByRole('main').ariaSnapshot(), 'text/plain');
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
	await expect(page.getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true, includeHidden: true })).toBeDisabled();
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

test('S1: a stale save code marks the loaded profile stale without clearing dirty edits', async ({ page }) => {
	await open(page);
	await page.evaluate(() => {
		window.__h1!.edit();
		window.__h1!.plans.push({ command: 'save_profile', fail: { code: 'save_stale', params: {}, detail: 'fixture changed bytes' } });
	});
	const before = await snapshot(page);
	await page.getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true }).click();
	const validation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Pre-Save Validation' }) });
	await expect.poll(async () => await validation.isVisible() || await page.evaluate(() => window.__h1!.snapshot().stale)).toBe(true);
	if (await validation.isVisible()) await validation.getByRole('button', { name: 'Save Anyway', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__h1!.snapshot().stale)).toBe(true);
	const after = await snapshot(page);
	expect(after.dirty).toEqual(before.dirty);
	expect(after.dirtyFiles).toEqual(before.dirtyFiles);
	await expect(page.getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true, includeHidden: true })).toBeDisabled();
	await expect(page.getByRole('alert').filter({ hasText: 'fixture changed bytes' })).toContainText('Save failed');
	await expect(page.getByRole('alert').filter({ hasText: 'fixture changed bytes' })).not.toContainText('Error:');
	expect(await page.evaluate(() => window.__h1!.calls.filter(({ command }) => command === 'save_profile'))).toHaveLength(1);
});

test('S1: a mounted typed error toast re-renders its title and retains the raw detail and paths', async ({ page }) => {
	await open(page);
	await page.evaluate(() => window.__h1!.plans.push({ command: 'create_backup', fail: {
		code: 'transaction_rollback', params: { recoveryPath: '/h1/recovery', backupPath: '/h1/safety-backup' },
		detail: 'fixture OS diagnostic <raw>\nrollback diagnostic'
	} }));
	await page.getByTestId('settings-page').getByRole('button', { name: 'Create Backup Now', exact: true }).click();
	const notice = page.getByRole('alert').filter({ hasText: 'fixture OS diagnostic <raw>' });
	await expect(notice).toHaveCount(1);
	await expect(notice).toContainText((await catalog('en'))['settings.backupFailed']);
	const node = await notice.elementHandle();
	const raw = notice.getByText('fixture OS diagnostic <raw>\nrollback diagnostic', { exact: true });
	await expect(raw).toBeVisible();
	const before = await raw.textContent();
	const laterFailures: { code: string; params: Record<string, string | number>; detail: string }[] = [
		{ code: 'transaction_rollback', params: { recoveryPath: '/h1/second-recovery' }, detail: 'second rollback diagnostic' },
		{ code: 'game_running', params: {}, detail: 'retry blocked by game' }
	];
	for (const failure of laterFailures) {
		await page.evaluate((fail) => window.__h1!.plans.push({ command: 'create_backup', fail }), failure);
		const create = page.getByTestId('settings-page').getByRole('button', { name: 'Create Backup Now', exact: true });
		await create.click();
		await expect(create).toBeEnabled();
		await expect(page.getByRole('alert').filter({ hasText: failure.detail })).toHaveCount(1);
	}
	await page.evaluate(() => window.__h1!.plans.push({ command: 'open_backup_folder', fail: {
		code: 'backups_open', params: { path: '/h1/backups' }, detail: 'open folder diagnostic'
	} }));
	await page.getByTestId('settings-page').getByRole('button', { name: 'Open Backup Folder', exact: true }).click();
	await expect(toastOf(page, page.getByRole('alert').filter({ hasText: 'open folder diagnostic' }))).toHaveAttribute('data-front', 'true');
	await expect(notice).toHaveCount(1);
	await expect(toastOf(page, notice)).toHaveAttribute('data-expanded', 'true');
	await expect(toastOf(page, notice)).toHaveAttribute('data-visible', 'true');
	await expect(raw).toBeVisible();
	await expect(page.getByRole('alert').filter({ hasText: 'second rollback diagnostic' })).toContainText('/h1/second-recovery');
	expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	await switchEditor(page, 'de');
	await expect(notice).toContainText((await catalog('de'))['settings.backupFailed']);
	await expect(notice).toContainText('/h1/recovery');
	await expect(notice).toContainText('/h1/safety-backup');
	await expect(raw).toHaveText(before!);
	expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	expect(await raw.evaluate((element) => getComputedStyle(element).userSelect)).toBe('text');
});

test('S1: an identical retry returns to the front after another persistent failure', async ({ page }) => {
	await open(page);
	const create = page.getByTestId('settings-page').getByRole('button', { name: 'Create Backup Now', exact: true });
	for (let attempt = 0; attempt < 3; attempt++) {
		await page.evaluate((index) => window.__h1!.plans.push({ command: 'create_backup', fail: {
			code: 'game_running', params: {}, detail: `retry diagnostic ${index}`
		} }), attempt);
		await create.click();
		await expect(create).toBeEnabled();
		const retry = page.getByRole('alert').filter({ hasText: `retry diagnostic ${attempt}` });
		await expect(retry).toHaveCount(1);
		await expect(toastOf(page, retry)).toHaveAttribute('data-front', 'true');
		// data-front alone is not enough: the stack position must move too.
		await expect(toastOf(page, retry)).toHaveAttribute('data-index', '0');
		// The drawn position comes from Sonner's height list, not data-index.
		await expect.poll(() => toastOf(page, retry).evaluate((element) => (element as HTMLElement).style.getPropertyValue('--offset'))).toBe('0px');
		await expect(retry).toBeVisible();
		await expect(page.getByRole('alert').filter({ hasText: 'Darkest Dungeon is running. Close the game before changing save files.' })).toHaveCount(1);
		if (attempt === 2) break;
		await page.evaluate(() => window.__h1!.plans.push({ command: 'open_backup_folder', fail: {
			code: 'backups_open', params: { path: '/h1/backups' }, detail: 'intervening folder failure'
		} }));
		await page.getByTestId('settings-page').getByRole('button', { name: 'Open Backup Folder', exact: true }).click();
		const intervening = toastOf(page, page.getByRole('alert').filter({ hasText: 'intervening folder failure' }));
		await expect(intervening).toHaveAttribute('data-front', 'true');
		await expect(intervening).toHaveAttribute('data-index', '0');
	}
});

test('S1: an unknown typed restore blocker stays disabled after confirmation and locale changes', async ({ page }) => {
	await open(page);
	await page.evaluate(() => {
		window.__h1!.edit();
		window.__h1!.plans.push({ command: 'check_restore', value: {
			adds: 1, removes: 0, blocked_reason: { code: 'future_blocker', params: {}, detail: 'fixture future refusal' }
		} });
	});
	const before = await snapshot(page);
	await page.getByTestId('settings-page').getByRole('button', { name: 'Restore', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('alert')).toContainText('An unexpected error occurred.');
	await expect(dialog.getByRole('alert')).toContainText('fixture future refusal');
	await dialog.getByRole('checkbox').check();
	await expect(dialog.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	await switchEditor(page, 'de');
	await expect(dialog.getByRole('button', { name: (await catalog('de'))['settings.restore'], exact: true })).toBeDisabled();
	await expect(dialog.getByRole('alert')).toContainText('fixture future refusal');
	expect(await snapshot(page)).toEqual(before);
	const calls = await page.evaluate((start) => window.__h1!.calls.slice(start), marker);
	expectSwitchCalls(calls, await persistedSettings(page));
	expect(calls.filter(({ command }) => ['restore_backup', 'restore_game_backup', 'save_profile'].includes(command))).toEqual([]);
});

async function expectFocusedHeaderTooltip(page: Page, button: Locator, reason: string, close = true) {
	await page.mouse.move(0, 0);
	await page.keyboard.press('Escape');
	// A blocked button stays in the tab order: aria-disabled, never disabled.
	await expect(button).not.toHaveAttribute('disabled', /.*/);
	await expect(button).toHaveAttribute('tabindex', '0');
	// Focus left on this button by an earlier pass would make focus() fire no
	// event, so clear it first.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await button.focus();
	// Return through the actual tab order.
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Tab');
	await expect(button).toBeFocused();
	await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"]):visible')).toHaveText(reason);
	await expect(button).toHaveAttribute('aria-describedby', /.+/);
	if (close) {
		await page.keyboard.press('Escape');
		await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"]):visible')).toHaveCount(0);
	}
}

async function expectHeaderTooltip(page: Page, button: Locator, reason: string) {
	await page.mouse.move(0, 0);
	await button.hover();
	await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"]):visible')).toHaveText(reason);
	await page.keyboard.press('Escape');
	await expectFocusedHeaderTooltip(page, button, reason);
}

async function activateBlockedHeaderButton(page: Page, button: Locator, shortcuts: string[]) {
	await expect(button).toBeDisabled();
	await expect(button).toHaveJSProperty('disabled', false);
	const box = await button.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await button.focus();
	for (const key of ['Enter', 'Space', ...shortcuts]) await page.keyboard.press(key);
}

for (const [state, reason] of [
	['no edits', 'No unsaved changes'],
	['stale', 'Save files may have changed. Reload the profile before saving.'],
	['running', 'DD Running. Close the game before saving.'],
	['uncertain', 'Unable to detect game status. Save blocked as precaution.'],
	['paths changed', 'Paths changed. Reload the profile before saving.'],
	['no profile', 'No profile loaded']
] as const) {
	test(`S2: blocked Save exposes ${state} on hover and keyboard focus in en and after switching to ru`, async ({ page }) => {
		await open(page);
		if (state === 'paths changed') await page.evaluate(() => window.__h1!.loadProfile('/h1/other-profile'));
		if (state !== 'no edits' && state !== 'no profile') await page.evaluate(() => window.__h1!.edit());
		if (state === 'stale') await page.evaluate(() => window.__h1!.markStale());
		if (state === 'no profile') await page.evaluate(() => window.__h1!.resetProfile());
		if (state === 'running' || state === 'uncertain') {
			await page.evaluate(value => window.__h1!.gameStatus(value === 'running' ? true : 'uncertain'), state);
		}
		const header = page.locator('[data-slot="sidebar-inset"] > header');
		const dirty = state !== 'no edits' && state !== 'no profile';
		const save = header.getByRole('button', { name: dirty ? 'Unsaved changes. Save all changes.' : 'Save', exact: true });
		await expect(save).toBeDisabled({ timeout: 10_000 });
		const node = await save.elementHandle();
		const before = await snapshot(page);
		const persisted = await persistedSettings(page);
		const marker = await page.evaluate(() => window.__h1!.calls.length);
		for (const locale of ['en', 'ru']) {
			await switchEditor(page, locale);
			await expect(save).toHaveCount(1);
			await expect(header.locator('button button')).toHaveCount(0);
			await expectHeaderTooltip(page, save, reason);
			await activateBlockedHeaderButton(page, save, ['Control+s', 'Meta+s']);
			await expect(page.getByRole('dialog')).toHaveCount(0);
			const backup = header.getByRole('button', { name: 'Backup', exact: true });
			if (state === 'no profile') {
				await expectHeaderTooltip(page, backup, 'No profile loaded');
				await activateBlockedHeaderButton(page, backup, ['Control+b', 'Meta+b']);
			} else await expect(backup).toBeEnabled();
			await expect(header.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(dirty ? 1 : 0);
			if (dirty) await expect(header.getByRole('button', { name: 'Discard', exact: true })).toBeEnabled();
			if (state === 'stale') await expect(header.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
			expect(await node!.evaluate(element => element.isConnected)).toBe(true);
			expect(await snapshot(page)).toEqual(before);
		}
		const calls = await page.evaluate(start => window.__h1!.calls.slice(start), marker);
		expectSwitchCalls(calls, persisted);
		expect(calls.filter(({ command }) => ['save_profile', 'create_backup'].includes(command))).toEqual([]);
	});
}

for (const phase of ['read', 'libraries']) {
	test(`S2: profile ${phase} loading keeps Save blocked with the exact loading tooltip`, async ({ page }) => {
		await page.goto(`/settings?h1&profileLoading=${phase}`);
		const held = phase === 'read' ? 'profile-read' : 'profile-libraries';
		await expect.poll(() => page.evaluate(() => window.__h1?.held())).toContain(held);
		if (phase === 'libraries') await page.evaluate(() => window.__h1!.edit());
		const header = page.locator('[data-slot="sidebar-inset"] > header');
		const save = header.getByRole('button', { name: phase === 'read' ? 'Save' : 'Unsaved changes. Save all changes.', exact: true });
		const before = await snapshot(page);
		for (const locale of ['en', 'ru']) {
			await switchEditor(page, locale);
			await expect(save).toBeDisabled();
			await expectFocusedHeaderTooltip(page, save, 'Loading profile...');
			await save.focus();
			for (const key of ['Enter', 'Space', 'Control+s', 'Meta+s']) await page.keyboard.press(key);
			expect(await snapshot(page)).toEqual(before);
		}
		expect(await page.evaluate(() => window.__h1!.calls.filter(({ command }) => ['save_profile', 'create_backup'].includes(command)))).toEqual([]);
		await page.evaluate(id => window.__h1!.release(id), held);
		await expect(page.getByRole('status', { name: 'Loading profile...' })).toHaveCount(0);
		if (phase === 'read') {
			// A clean profile remains blocked by its no-changes reason after loading.
			await expect(save).toBeDisabled();
			await expectHeaderTooltip(page, save, 'No unsaved changes');
		} else await expect(save).toBeEnabled();
	});
}

test('S2: saving blocks repeat Save and Discard activation while keeping their tooltips reachable', async ({ page }) => {
	await open(page);
	await page.evaluate(() => {
		window.__h1!.edit();
		window.__h1!.validationCounts(0, 0);
		window.__h1!.plans.push({ command: 'save_profile', hold: 'header-save' });
	});
	const header = page.locator('[data-slot="sidebar-inset"] > header');
	const save = header.getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true });
	await expect(save).toBeEnabled();
	await save.click();
	await expect.poll(async () => (await page.evaluate(() => window.__h1!.held())).includes('header-save') || await page.getByRole('dialog').isVisible()).toBe(true);
	const validation = page.getByRole('dialog');
	if (await validation.isVisible()) await validation.getByRole('button', { name: 'Save Anyway', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__h1!.held())).toContain('header-save');
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of ['en', 'ru']) {
		await switchEditor(page, locale);
		await expect(save).toHaveText('Saving...');
		await expectHeaderTooltip(page, save, 'Saving...');
		await activateBlockedHeaderButton(page, save, ['Control+s', 'Meta+s']);
		const discard = header.getByRole('button', { name: 'Discard', exact: true });
		await expectHeaderTooltip(page, discard, 'Discard all unsaved changes (Ctrl/Cmd+Shift+Z)');
		await activateBlockedHeaderButton(page, discard, ['Control+Shift+z', 'Meta+Shift+z']);
		for (const modifier of ['ctrlKey', 'metaKey']) {
			await discard.dispatchEvent('keydown', { key: 'z', shiftKey: true, [modifier]: true });
		}
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(header.getByRole('button', { name: 'Backup', exact: true })).toBeEnabled();
		expect(await snapshot(page)).toEqual(before);
	}
	expectSwitchCalls(await page.evaluate(start => window.__h1!.calls.slice(start), marker), persisted);
	expect(await page.evaluate(() => window.__h1!.calls.filter(({ command }) => command === 'save_profile'))).toHaveLength(1);
	await page.evaluate(() => window.__h1!.release('header-save'));
	await expect(header.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
	await expectHeaderTooltip(page, header.getByRole('button', { name: 'Save', exact: true }), 'No unsaved changes');
	await expect(header.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0);
});

test('S2: keyboard activation closes an enabled tooltip trigger', async ({ page }) => {
	await open(page);
	const theme = page.getByRole('button', { name: 'Toggle theme', exact: true });
	for (const key of ['Enter', 'Space']) {
		await expectFocusedHeaderTooltip(page, theme, 'Toggle dark/light mode', false);
		const wasDark = await page.locator('html').evaluate(element => element.classList.contains('dark'));
		await page.keyboard.press(key);
		await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"]):visible')).toHaveCount(0);
		await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(!wasDark);
	}
});

test('S2: one main landmark and one correctly named Save button survive dirty live locale switches', async ({ page }) => {
	await open(page);
	const header = page.locator('[data-slot="sidebar-inset"] > header');
	const save = header.getByRole('button', { name: 'Save', exact: true });
	await expect(page.getByRole('main')).toHaveCount(1);
	await expect(page.locator('main main')).toHaveCount(0);
	await expect(save).toHaveCount(1);
	await expect(save).toBeDisabled();
	await page.evaluate(() => window.__h1!.edit());
	const dirtySave = header.getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true });
	await expect(dirtySave).toHaveCount(1);
	await expect(dirtySave).toBeEnabled();
	await expectHeaderTooltip(page, dirtySave, 'Save all changes');
	await expect(header.getByRole('button', { name: 'Backup', exact: true })).toBeEnabled();
	await expectHeaderTooltip(page, header.getByRole('button', { name: 'Backup', exact: true }), 'Create manual backup (Ctrl/Cmd+B)');
	await expect(header.getByRole('button', { name: 'Discard', exact: true })).toBeEnabled();
	await expectHeaderTooltip(page, header.getByRole('button', { name: 'Discard', exact: true }), 'Discard all unsaved changes (Ctrl/Cmd+Shift+Z)');
	expect(await dirtySave.evaluate(element => !element.querySelector('button') && !element.parentElement?.closest('button'))).toBe(true);
	await expect(header.locator('button button')).toHaveCount(0);
	const mainNode = await page.getByRole('main').elementHandle();
	const saveNode = await dirtySave.elementHandle();
	const aboutNode = await page.getByRole('button', { name: 'About', exact: true }).elementHandle();
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of ['ru', 'ja', 'de', 'en']) {
		await switchEditor(page, locale);
		const messages = await catalog(locale);
		await expect(page.getByRole('button', { name: messages['settings.about'], exact: true })).toBeVisible();
		expect(await aboutNode!.evaluate((element, name) => element.isConnected && element.textContent?.trim() === name, messages['settings.about'])).toBe(true);
		if (locale === 'ru') expect(messages['settings.about']).toBe('О программе');
		await expect(header.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
		await expect(dirtySave).toHaveCount(1);
		await expect(dirtySave).toBeEnabled();
		expect(await snapshot(page)).toEqual(before);
		expect(await mainNode!.evaluate(element => element.isConnected && element === document.querySelector('main'))).toBe(true);
		expect(await saveNode!.evaluate(element => element.isConnected && element === document.querySelector('header button[aria-label="Unsaved changes. Save all changes."]'))).toBe(true);
	}
	expectSwitchCalls(await page.evaluate(start => window.__h1!.calls.slice(start), marker), persisted);
	await page.evaluate(() => window.__h1!.markStale());
	await expect(dirtySave).toHaveCount(1);
	await expect(dirtySave).toBeDisabled();
	expect((await snapshot(page)).dirty).toEqual(before.dirty);
});

test('S2: About rich text and discard confirmation stay mounted with dirty data on a locale switch', async ({ page }) => {
	await open(page);
	await page.evaluate(() => window.__h1!.edit());
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	await page.getByRole('button', { name: 'About', exact: true }).click();
	const about = page.getByRole('dialog');
	await expect(about.getByRole('heading', { name: 'Hamlet Editor', exact: true })).toBeVisible();
	await expect(about.locator('em')).toHaveCount(2);
	await expect(about.locator('em').first()).toHaveText('Darkest Dungeon');
	await expect(about).toContainText('Always back up your save files before editing.');
	const aboutNode = await about.elementHandle();
	await switchEditor(page, 'ru');
	await expect(about.getByRole('button', { name: (await catalog('ru'))['common.close'], exact: true })).toBeVisible();
	expect(await aboutNode!.evaluate(element => element.isConnected)).toBe(true);
	expect(await snapshot(page)).toEqual(before);
	await about.getByRole('button', { name: (await catalog('ru'))['common.close'], exact: true }).click();

	await switchEditor(page, 'en');
	await page.locator('[data-slot="sidebar-inset"] > header').getByRole('button', { name: 'Discard', exact: true }).click();
	const discard = page.getByRole('dialog');
	await expect(discard.getByRole('heading', { name: 'Discard All Changes', exact: true })).toBeVisible();
	const discardNode = await discard.elementHandle();
	await expect(discard.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
	const cancelNode = await discard.getByRole('button', { name: 'Cancel', exact: true }).elementHandle();
	for (const locale of ['ru', 'en']) {
		await switchEditor(page, locale);
		const messages = await catalog(locale);
		await expect(discard.getByRole('button', { name: messages['settings.cancel'], exact: true })).toBeVisible();
		await expect(discard.getByRole('button', { name: messages['common.close'], exact: true })).toBeVisible();
		await expect(discard.getByRole('button', { name: 'Discard All Changes', exact: true })).toBeEnabled();
		expect(await cancelNode!.evaluate((element, name) => element.isConnected && element.textContent?.trim() === name, messages['settings.cancel'])).toBe(true);
		if (locale === 'ru') expect(messages['settings.cancel']).toBe('Отмена');
		expect(await discardNode!.evaluate(element => element.isConnected)).toBe(true);
		expect(await snapshot(page)).toEqual(before);
	}
	expectSwitchCalls(await page.evaluate(start => window.__h1!.calls.slice(start), marker), persisted);
	await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(await snapshot(page)).toEqual(before);
});

test('S2: the real unsaved guard keeps descriptor action labels and dirty payload through locale switches', async ({ page }) => {
	await open(page);
	await page.evaluate(() => window.__h1!.edit());
	await page.getByTestId('settings-page').getByRole('button', { name: 'Restore', exact: true }).click();
	const restore = page.getByRole('dialog');
	await restore.getByRole('checkbox').check();
	await restore.getByRole('button', { name: 'Restore', exact: true }).click();
	const unsaved = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Unsaved Changes', exact: true }) });
	await expect(unsaved).toBeVisible();
	await expect(unsaved.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
	await expect(unsaved.getByRole('button', { name: 'Discard', exact: true })).toBeVisible();
	const node = await unsaved.elementHandle();
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of ['ru', 'en']) {
		await switchEditor(page, locale);
		const messages = await catalog(locale);
		await expect(unsaved.getByRole('button', { name: messages['settings.cancel'], exact: true })).toBeVisible();
		await expect(unsaved.getByRole('button', { name: messages['common.close'], exact: true })).toBeVisible();
		await expect(unsaved.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
		await expect(unsaved.getByRole('button', { name: 'Discard', exact: true })).toBeVisible();
		expect(await node!.evaluate(element => element.isConnected)).toBe(true);
		expect(await snapshot(page)).toEqual(before);
	}
	expectSwitchCalls(await page.evaluate(start => window.__h1!.calls.slice(start), marker), persisted);
	await unsaved.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(await snapshot(page)).toEqual(before);
	expect(await page.evaluate(() => window.__h1!.calls.filter(({ command }) => ['restore_backup', 'restore_game_backup', 'save_profile'].includes(command)))).toEqual([]);
});

for (const [errors, warnings] of [[1, 1], [2, 2], [0, 1], [0, 2]]) {
	test(`S2: mounted validation plurals for ${errors} errors and ${warnings} warnings in en and ru`, async ({ page }) => {
		await open(page);
		await page.evaluate(([errorCount, warningCount]) => window.__h1!.validationCounts(errorCount, warningCount), [errors, warnings]);
		const before = await snapshot(page);
		await page.locator('[data-slot="sidebar-inset"] > header').getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByRole('heading', { name: 'Pre-Save Validation', exact: true })).toBeVisible();
		const node = await dialog.elementHandle();
		const persisted = await persistedSettings(page);
		const marker = await page.evaluate(() => window.__h1!.calls.length);
		const summary = errors ? `${errors} ${errors === 1 ? 'error' : 'errors'} and ${warnings} ${warnings === 1 ? 'warning' : 'warnings'} found.`
			: `${warnings} ${warnings === 1 ? 'warning' : 'warnings'} found.`;
		// P2 adds keys only to en.json. Selecting Russian exercises the actual per-key fallback.
		for (const locale of ['en', 'ru']) {
			await switchEditor(page, locale);
			await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText(summary);
			await expect(dialog.getByRole('button', { name: `Fix ${warnings} ${warnings === 1 ? 'Issue' : 'Issues'} Automatically`, exact: true })).toBeEnabled();
			await expect(dialog.getByText('Auto-fixable', { exact: true })).toHaveCount(warnings);
			await expect(dialog.getByText('Treatment', { exact: true })).toHaveCount(warnings);
			await expect(dialog.getByText('Gear Rank', { exact: true })).toHaveCount(errors);
			await expect(dialog.getByRole('button', { name: 'Save Anyway', exact: true })).toHaveCount(errors ? 0 : 1);
			const messages = await catalog(locale);
			await expect(dialog.getByRole('button', { name: messages['settings.cancel'], exact: true })).toBeVisible();
			await expect(dialog.getByRole('button', { name: messages['common.close'], exact: true })).toBeVisible();
			expect(await node!.evaluate(element => element.isConnected)).toBe(true);
			expect(await snapshot(page)).toEqual(before);
		}
		expectSwitchCalls(await page.evaluate(start => window.__h1!.calls.slice(start), marker), persisted);
		await dialog.getByRole('button', { name: (await catalog('ru'))['settings.cancel'], exact: true }).click();
		await expect(page.locator('[data-slot="sidebar-inset"] > header').getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true })).toBeEnabled();
		expect(await snapshot(page)).toEqual(before);
		expect(await page.evaluate(() => window.__h1!.calls.filter(({ command }) => ['save_profile', 'create_backup'].includes(command)))).toEqual([]);
	});
}

test('S3: hero, quirk picker and trinket picker stay mounted through real editor and game language switches', async ({ page }, info) => {
	await page.goto('/heroes?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await page.evaluate(() => window.__h1!.edit());
	const heroes = page.getByTestId('heroes-page');
	const row = heroes.getByTestId('hero-row-96');
	await row.click();
	await expect(row).toHaveClass(/bg-accent/);
	const detail = page.getByTestId('hero-detail');
	await detail.getByRole('button', { name: 'Add Positive', exact: true }).click();
	const quirkPicker = page.getByTestId('quirk-picker');
	await quirkPicker.getByPlaceholder('Search quirks...').fill('warrior');
	await expect(quirkPicker.getByText('english:warrior-of-light', { exact: true })).toBeVisible();
	await detail.getByTestId('trinket-picker-trigger').first().click();
	const trinketPicker = page.getByTestId('trinket-picker');
	await expect(trinketPicker).toBeVisible();
	const nodes = await Promise.all([heroes, row, detail, quirkPicker, trinketPicker].map((locator) => locator.elementHandle()));
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of allLocales) {
		await switchEditor(page, locale);
		const messages = await catalog(['en', 'de', 'ru', 'ja'].includes(locale) ? locale : 'en');
		await expect(page.locator('label[for=game-text-language]')).toHaveText(messages['settings.gameLanguage']);
		await expect(detail.getByText('english:crusader', { exact: true })).toBeVisible();
		await expect(quirkPicker.getByText('english:warrior-of-light', { exact: true })).toBeVisible();
		expect(await snapshot(page)).toEqual(before);
	}
	for (const language of gameLanguages) {
		await switchGame(page, language);
		const locale = GAME_TEXT_LOCALES[language as keyof typeof GAME_TEXT_LOCALES];
		for (const name of ['crusader', 'quick-reflexes', 'smite', 'encourage']) {
			await expect(detail.getByText(`${language}:${name}`, { exact: true })).toBeVisible();
			await expect(detail.getByText(`${language}:${name}`, { exact: true })).toHaveAttribute('lang', locale);
		}
		// Both pickers survive the game-text switch with their current query and live results.
		await expect(quirkPicker.getByText(`${language}:warrior-of-light`, { exact: true })).toBeVisible();
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
		const trinketSearch = trinketPicker.getByPlaceholder('Search trinkets...');
		await trinketSearch.fill(`${language}:trinket-a`);
		await expect(trinketPicker.getByText(`${language}:trinket-a`, { exact: true })).toBeVisible();
		await expect(trinketPicker.getByText(`${language}:trinket-a`, { exact: true })).toHaveAttribute('lang', locale);
		await trinketSearch.fill('no-such-trinket');
		await expect(trinketPicker.getByText('No trinket found.', { exact: true })).toBeVisible();
		// Groups without matches are hidden, not left as empty headings.
		await expect(trinketPicker.getByText('In your inventory', { exact: true })).toHaveCount(0);
		await expect(trinketPicker.getByText('Add new from catalogue', { exact: true })).toHaveCount(0);
		await trinketSearch.fill('trinket');
		await expect(trinketSearch).toHaveValue('trinket');
		// The open popover traps focus, so the quirk search is only reachable once it is dismissed.
		await trinketSearch.press('Escape');
		await expect(trinketPicker).toHaveCount(0);
		// The spaced English alias occurs in neither the hyphenated display fixture nor the raw id.
		const quirkQuery = language === 'english' ? 'warrior' : 'Warrior of Light';
		const quirkSearch = quirkPicker.getByPlaceholder('Search quirks...');
		await quirkSearch.fill(quirkQuery);
		await expect(quirkSearch).toHaveValue(quirkQuery);
		await expect(quirkSearch).toBeFocused();
		await expect(quirkPicker.getByText(`${language}:warrior-of-light`, { exact: true })).toBeVisible();
		await expect(quirkPicker.getByText(`${language}:warrior-of-light`, { exact: true })).toHaveAttribute('lang', locale);
		// Reopen the trinket picker so the next switch again happens with both pickers open.
		await detail.getByTestId('trinket-picker-trigger').first().click();
		await expect(trinketPicker).toBeVisible();
		await expect(trinketPicker.getByPlaceholder('Search trinkets...')).toHaveValue('');
		nodes[4] = await trinketPicker.elementHandle();
		await expect(row).toHaveClass(/bg-accent/);
		expect(await snapshot(page)).toEqual(before);
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), persisted);
	expect(await persistedSettings(page)).toEqual(persisted);
	await evidence(info, 's3-heroes-open-pickers.aria.txt', await heroes.ariaSnapshot(), 'text/plain');
});

test('S3: class sorting flips after a game-text switch while the same hero row stays selected', async ({ page }) => {
	await page.goto('/heroes?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await page.evaluate(() => window.__h1!.edit());
	const heroes = page.getByTestId('heroes-page');
	const row = heroes.getByTestId('hero-row-96');
	await row.click();
	const search = heroes.getByRole('textbox', { name: 'Search heroes by name or class', exact: true });
	await search.fill('96');
	await expect(heroes.locator('[data-testid^="hero-row-"]')).toHaveCount(0);
	await search.fill('');
	await heroes.getByRole('combobox').filter({ hasText: 'Sort: Name' }).click();
	await page.getByRole('option', { name: 'Class', exact: true }).click();
	const before = await snapshot(page);
	const crusader = before.heroes.find((hero) => hero.id === '96')!;
	expect(crusader.heroClass).toBe('crusader');
	// The harness fixture has no vestal (its first hero becomes unknown_mod_class); occultist is
	// a single, unedited hero whose English label sorts after english:crusader.
	const occultists = before.heroes.filter((hero) => hero.heroClass === 'occultist');
	expect(occultists).toHaveLength(1);
	const occultist = occultists[0];
	const order = () => heroes.locator('[data-testid^="hero-row-"]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')));
	const englishOrder = await order();
	expect(englishOrder).toContain(`hero-row-${crusader.id}`);
	expect(englishOrder).toContain(`hero-row-${occultist.id}`);
	expect(englishOrder.indexOf(`hero-row-${crusader.id}`)).toBeLessThan(englishOrder.indexOf(`hero-row-${occultist.id}`));
	// The guid-only query above empties and rebuilds the list, so take the node after it.
	await expect(row).toHaveClass(/bg-accent/);
	const selectedNode = await row.elementHandle();
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	await page.evaluate(() => window.__h1!.plans.push({ command: 'load_localization', language: 'japanese', value: {
		table: { ...window.__h1!.gameNames(), hero_class_name_crusader: 'Zulu', hero_class_name_occultist: 'Alpha' },
		english: { hero_class_name_crusader: 'Crusader', hero_class_name_occultist: 'Occultist' }
	} }));
	await switchGame(page, 'japanese');
	await expect.poll(async () => {
		const japaneseOrder = await order();
		return japaneseOrder.indexOf(`hero-row-${occultist.id}`) >= 0 && japaneseOrder.indexOf(`hero-row-${occultist.id}`) < japaneseOrder.indexOf(`hero-row-${crusader.id}`);
	}).toBe(true);
	await expect(heroes.getByTestId(`hero-row-${occultist.id}`).getByText('Alpha', { exact: true })).toBeVisible();
	await expect(row.getByText('Zulu', { exact: true })).toBeVisible();
	await expect(row).toHaveClass(/bg-accent/);
	expect(await selectedNode!.evaluate((element) => element.isConnected && element === document.querySelector('[data-testid="hero-row-96"]'))).toBe(true);
	expect(await snapshot(page)).toEqual(before);
	expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), persisted);
});

test('S3: IME Enter and keyCode 229 retain the hero name draft without committing data', async ({ page }) => {
	await page.goto('/heroes?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await page.evaluate(() => window.__h1!.edit());
	await page.getByTestId('hero-row-96').click();
	const detail = page.getByTestId('hero-detail');
	await detail.getByRole('button', { name: 'Reynauld', exact: true }).click();
	const input = detail.getByRole('textbox', { name: 'Hero name', exact: true });
	await input.fill('名前の途中');
	const before = await snapshot(page);
	const node = await input.elementHandle();
	for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
		await input.dispatchEvent('keydown', { key: 'Enter', bubbles: true, ...init });
		await expect(input).toHaveValue('名前の途中');
		expect(await snapshot(page)).toEqual(before);
		expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	await input.press('Enter');
	await expect(input).toHaveCount(0);
	const after = await snapshot(page);
	const expected = structuredClone(before.data);
	const roster = expected.roster as { base_root: { heroes: Record<string, { hero_file_data: { raw_data: { base_root: { actor: { name: string } } } } }> } };
	const selected = before.heroes.find((hero) => hero.name === 'Reynauld')!;
	roster.base_root.heroes[selected.id].hero_file_data.raw_data.base_root.actor.name = '名前の途中';
	expect(after.data).toEqual(expected);
});
