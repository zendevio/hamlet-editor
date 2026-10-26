import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { IntlMessageFormat } from 'intl-messageformat';
import { GAME_TEXT_LANGUAGES, GAME_TEXT_LOCALES } from '../../src/lib/data/game-text-languages.js';
import type {} from '../../src/lib/dev/harness.js';
import { pseudoMessage } from '../../src/lib/dev/pseudo-locale.js';
// svelte-sonner keeps stacking state (data-front, data-expanded, data-visible)
// on the toast list item that wraps our alert content. A replaced toast stays
// in the DOM with data-removed while it animates out, so it is skipped.
function toastOf(page: Page, content: Locator) {
	return page.locator('[data-sonner-toast][data-removed="false"]').filter({ has: content });
}
// Evidence is written once into the test's output folder. Attaching it as well
// would copy every file again into the shared attachments folder.
async function evidence(info: TestInfo, name: string, body: string | Uint8Array) {
	await writeFile(info.outputPath(name), body);
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
// Stable locators keep resolving the same mounted control as its accessible
// name changes. switchEditor separately checks the exact active-locale Save name.
const messagesByLocale = Object.fromEntries(allLocales.map(locale => [locale,
	JSON.parse(readFileSync(new URL(`../../src/lib/i18n/catalogs/${locale}.json`, import.meta.url), 'utf8'))]));
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const copyNames = (key: string) => {
	const values = allLocales.map(locale => {
		const value = messagesByLocale[locale][key];
		if (typeof value !== 'string') throw new Error(`Missing locator message ${locale}:${key}`);
		return value;
	});
	return new RegExp(`^(?:${[...new Set(values)].map(escapeRegex).join('|')})$`);
};
// Direct ICU reference rendering uses explicit test inputs, independent of the
// application's translator, descriptor normalization and locale resolution.
const copy = (locale: string, key: string, params: Record<string, string | number> = {}) => {
	const plain = (chunks: unknown[]) => chunks.join('');
	const result = new IntlMessageFormat(messagesByLocale[locale][key], locale).format({ ...params, emphasis: plain, code: plain, link: plain });
	return Array.isArray(result) ? result.join('') : String(result);
};
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
	const header = page.locator('[data-slot="sidebar-inset"] > header');
	if (await header.count()) {
		const dirty = (await snapshot(page)).dirtyFiles.length > 0;
		await expect(header.getByRole('button', { name: messagesByLocale[locale][dirty ? 'shell.dirtySave' : 'shell.save'], exact: true, includeHidden: true })).toHaveCount(1);
	}
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
		await expect(page.getByTestId('settings-page').locator('a[href="https://github.com/zendevio/hamlet-editor"]')).toHaveText(renderedCopy[locale].repository);
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
		await expect(rich.locator('a')).toHaveAttribute('href', 'https://github.com/zendevio/hamlet-editor');
		await evidence(info, `settings-${locale}.png`, await page.screenshot());
		await evidence(info, `settings-${locale}.aria.txt`, await page.getByTestId('settings-page').ariaSnapshot());
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
	}), allLocales), null, 2));
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
	await evidence(info, 'russian-settings-plurals.aria.txt', await page.getByTestId('settings-page').ariaSnapshot());
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
	await page.getByTestId('settings-page').getByTestId('browse-game').click();
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
		await evidence(info, `save-payload-${switches ? 'switched' : 'baseline'}.json`, JSON.stringify(calls[0].args, null, 2));
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
	await expect(page.getByRole('button', { name: copyNames('shell.dirtySave'), exact: true })).toBeDisabled();
	await expect(page.getByText((await catalog('de'))['shell.stale'], { exact: true })).toBeVisible();
	await page.evaluate(() => window.__h1!.plans.push({ command: 'plugin:dialog|open', value: '/h1/another-profile' }));
	await page.getByTestId('settings-page').getByTestId('browse-save').click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.getByRole('dialog').getByRole('button', { name: copyNames('shell.save'), exact: true })).toHaveCount(0);
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
				// The row holds a selection checkbox and one detail button. The button is named by its content (hero name,
				// level badge, class line), so its name starts with the hero name. The portrait is decorative: when its
				// asset fails to load, as in the harness, the placeholder must not add text to that name.
				const row = page.getByTestId(/^hero-row-/).filter({ hasText: 'Backups' }).filter({ hasText: 'unknown_mod_class' });
				const rowButton = row.getByRole('button');
				await expect(rowButton).toHaveAccessibleName(/^Backups\b/);
				await expect(rowButton).not.toHaveAccessibleName(/Image unavailable/);
				await rowButton.click();
				selectedRow = await row.elementHandle();
				await expect(row).toHaveClass(/bg-accent/);
				// The detail portrait is not decorative: loaded or not, it keeps its own label.
				await expect(page.getByTestId('hero-detail').getByRole('img', { name: 'Backups portrait', exact: true })).toBeVisible();
				await page.getByTestId('hero-detail').getByRole('button', { name: 'Backups', exact: true }).click();
			}
			const input = route === 'heroes' ? page.getByRole('textbox', { name: copyNames('heroes.heroName'), exact: true }) : page.getByPlaceholder(copyNames('estate.namePlaceholder'));
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
					else await expect(page.getByTestId('estate-trinket-h1_trinket_a').locator('p[lang]')).toHaveText(`${language}:trinket-a`);
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
			const saveButton = page.getByRole('button', { name: copyNames('shell.dirtySave'), exact: true });
			await expect(saveButton).toBeEnabled();
			await saveButton.click();
			await expect.poll(async () =>
				await page.evaluate(() => window.__h1!.calls.some(({ command }) => command === 'save_profile')) ||
				await page.getByRole('dialog').filter({ hasText: 'Pre-Save Validation' }).isVisible()
			).toBe(true);
			const validation = page.getByRole('dialog').filter({ hasText: 'Pre-Save Validation' });
			if (await validation.isVisible()) await validation.getByRole('button', { name: copyNames('validation.saveAnyway'), exact: true }).click();
			await expect.poll(() => page.evaluate(() => window.__h1!.calls.filter(({ command }) => command === 'save_profile').length)).toBe(1);
			const call = await page.evaluate(() => window.__h1!.calls.find(({ command }) => command === 'save_profile')!);
			expect(call.args.data).toEqual(edited.dirty);
			payloads.push(call.args);
			await evidence(info, `${route}-${switches ? 'switched' : 'baseline'}-save.json`, JSON.stringify(call.args, null, 2));
			await evidence(info, `${route}-${switches ? 'switched' : 'baseline'}.aria.txt`, await page.getByRole('main').ariaSnapshot());
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
		await evidence(info, `bootstrap-${scenario}.json`, JSON.stringify({ elapsedMs: elapsed, persistedUnchanged: true }));
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
	await page.getByTestId('settings-page').getByTestId('browse-game').click();
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
	await expect(page.getByRole('button', { name: copyNames('shell.dirtySave'), exact: true, includeHidden: true })).toBeDisabled();
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
	await page.getByTestId('settings-page').getByTestId('browse-game').click();
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
				await evidence(info, `p1c-${locale}-${viewport.width}-${kind}-path.png`, await page.screenshot());
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
	await page.getByRole('button', { name: copyNames('shell.dirtySave'), exact: true }).click();
	const validation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Pre-Save Validation' }) });
	await expect.poll(async () => await validation.isVisible() || await page.evaluate(() => window.__h1!.snapshot().stale)).toBe(true);
	if (await validation.isVisible()) await validation.getByRole('button', { name: copyNames('validation.saveAnyway'), exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__h1!.snapshot().stale)).toBe(true);
	const after = await snapshot(page);
	expect(after.dirty).toEqual(before.dirty);
	expect(after.dirtyFiles).toEqual(before.dirtyFiles);
	await expect(page.getByRole('button', { name: copyNames('shell.dirtySave'), exact: true, includeHidden: true })).toBeDisabled();
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

/**
 * Retries a tooltip interaction with toPass and records how many attempts it
 * took as a `tooltip-attempts` annotation (also logged when above one), so a
 * rise from synthetic-input timing to a real intermittent defect shows up.
 */
async function countAttempts(pass: 'hover' | 'keyboard', reason: string, attempt: () => Promise<void>) {
	let attempts = 0;
	try {
		await expect(async () => {
			attempts++;
			await attempt();
		}).toPass({ timeout: 10_000 });
	} finally {
		const description = `${pass} ${JSON.stringify(reason)}: ${attempts} attempt${attempts === 1 ? '' : 's'}`;
		test.info().annotations.push({ type: 'tooltip-attempts', description });
		if (attempts > 1) console.log(`tooltip-attempts ${description}`);
	}
}

async function expectFocusedHeaderTooltip(page: Page, button: Locator, reason: string, close = true) {
	await page.mouse.move(0, 0);
	await page.keyboard.press('Escape');
	// A blocked button stays in the tab order: aria-disabled, never disabled.
	await expect(button).not.toHaveAttribute('disabled', /.*/);
	await expect(button).toHaveAttribute('tabindex', '0');
	// Back-to-back synthetic Shift+Tab and Tab can land inside bits-ui's close
	// transition of the tooltip opened by focus(); a person cannot tab that fast,
	// so the whole keyboard pass is retried.
	await countAttempts('keyboard', reason, async () => {
		// Focus left on this button by an earlier pass would make focus() fire no
		// event, so clear it first.
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await button.focus();
		// Return through the actual tab order.
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Tab');
		await expect(button).toBeFocused();
		await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"]):visible')).toHaveText(reason, { timeout: 1000 });
	});
	await expect(button).toHaveAttribute('aria-describedby', /.+/);
	if (close) {
		await page.keyboard.press('Escape');
		await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"]):visible')).toHaveCount(0);
	}
}

async function expectHeaderTooltip(page: Page, button: Locator, reason: string) {
	await button.scrollIntoViewIfNeeded();
	// bits-ui can ignore the first synthetic pointer jump right after another
	// tooltip was dismissed with Escape; a real pointer keeps moving, so retry.
	await countAttempts('hover', reason, async () => {
		await page.mouse.move(0, 0);
		await button.hover();
		await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"]):visible')).toHaveText(reason, { timeout: 1000 });
	});
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

for (const [state, reason, englishReason] of [
	['no edits', 'error.save_no_changes', 'No unsaved changes'],
	['stale', 'error.profile_stale', 'Save files may have changed. Reload the profile before saving.'],
	['running', 'error.save_game_running', 'DD Running. Close the game before saving.'],
	['uncertain', 'error.game_detection_uncertain', 'Unable to detect game status. Save blocked as precaution.'],
	['paths changed', 'error.profile_paths_changed', 'Paths changed. Reload the profile before saving.'],
	['no profile', 'shell.noProfile', 'No profile loaded']
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
		const save = header.getByRole('button', { name: copyNames(dirty ? 'shell.dirtySave' : 'shell.save'), exact: true });
		await expect(save).toBeDisabled({ timeout: 10_000 });
		const node = await save.elementHandle();
		const before = await snapshot(page);
		const persisted = await persistedSettings(page);
		const marker = await page.evaluate(() => window.__h1!.calls.length);
		for (const locale of ['en', 'ru']) {
			await switchEditor(page, locale);
			await expect(save).toHaveAccessibleName(copy(locale, dirty ? 'shell.dirtySave' : 'shell.save'));
			await expect(save).toHaveCount(1);
			await expect(header.locator('button button')).toHaveCount(0);
			await expectHeaderTooltip(page, save, locale === 'en' ? englishReason : copy(locale, reason));
			await activateBlockedHeaderButton(page, save, ['Control+s', 'Meta+s']);
			await expect(page.getByRole('dialog')).toHaveCount(0);
			const backup = header.getByRole('button', { name: copyNames('shell.backup'), exact: true });
			if (state === 'no profile') {
				await expectHeaderTooltip(page, backup, copy(locale, 'shell.noProfile'));
				await activateBlockedHeaderButton(page, backup, ['Control+b', 'Meta+b']);
			} else await expect(backup).toBeEnabled();
			await expect(header.getByRole('button', { name: copyNames('shell.discard'), exact: true })).toHaveCount(dirty ? 1 : 0);
			if (dirty) await expect(header.getByRole('button', { name: copyNames('shell.discard'), exact: true })).toBeEnabled();
			if (state === 'stale') await expect(header.getByRole('button', { name: copyNames('shell.reload'), exact: true })).toBeEnabled();
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
		const save = header.getByRole('button', { name: copyNames(phase === 'read' ? 'shell.save' : 'shell.dirtySave'), exact: true });
		const before = await snapshot(page);
		for (const locale of ['en', 'ru']) {
			await switchEditor(page, locale);
			await expect(save).toBeDisabled();
			await expectFocusedHeaderTooltip(page, save, locale === 'en' ? 'Loading profile...' : copy(locale, 'shell.loadingProfile'));
			await save.focus();
			for (const key of ['Enter', 'Space', 'Control+s', 'Meta+s']) await page.keyboard.press(key);
			expect(await snapshot(page)).toEqual(before);
		}
		expect(await page.evaluate(() => window.__h1!.calls.filter(({ command }) => ['save_profile', 'create_backup'].includes(command)))).toEqual([]);
		await page.evaluate(id => window.__h1!.release(id), held);
		await expect(page.getByRole('status', { name: copy('ru', 'shell.loadingProfile') })).toHaveCount(0);
		if (phase === 'read') {
			// A clean profile remains blocked by its no-changes reason after loading.
			await expect(save).toBeDisabled();
			await expectHeaderTooltip(page, save, copy('ru', 'error.save_no_changes'));
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
	const save = header.getByRole('button', { name: copyNames('shell.dirtySave'), exact: true });
	await expect(save).toBeEnabled();
	await save.click();
	await expect.poll(async () => (await page.evaluate(() => window.__h1!.held())).includes('header-save') || await page.getByRole('dialog').isVisible()).toBe(true);
	const validation = page.getByRole('dialog');
	if (await validation.isVisible()) await validation.getByRole('button', { name: copyNames('validation.saveAnyway'), exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__h1!.held())).toContain('header-save');
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of ['en', 'ru']) {
		await switchEditor(page, locale);
		await expect(save).toHaveText(locale === 'en' ? 'Saving...' : copy(locale, 'shell.saving'));
		await expectHeaderTooltip(page, save, locale === 'en' ? 'Saving...' : copy(locale, 'shell.saving'));
		await activateBlockedHeaderButton(page, save, ['Control+s', 'Meta+s']);
		const discard = header.getByRole('button', { name: copyNames('shell.discard'), exact: true });
		await expectHeaderTooltip(page, discard, locale === 'en' ? 'Discard all unsaved changes (Ctrl/Cmd+Shift+Z)' : copy(locale, 'shell.discardHelp'));
		await activateBlockedHeaderButton(page, discard, ['Control+Shift+z', 'Meta+Shift+z']);
		for (const modifier of ['ctrlKey', 'metaKey']) {
			await discard.dispatchEvent('keydown', { key: 'z', shiftKey: true, [modifier]: true });
		}
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(header.getByRole('button', { name: copyNames('shell.backup'), exact: true })).toBeEnabled();
		expect(await snapshot(page)).toEqual(before);
	}
	expectSwitchCalls(await page.evaluate(start => window.__h1!.calls.slice(start), marker), persisted);
	expect(await page.evaluate(() => window.__h1!.calls.filter(({ command }) => command === 'save_profile'))).toHaveLength(1);
	await page.evaluate(() => window.__h1!.release('header-save'));
	await expect(header.getByRole('button', { name: copyNames('shell.save'), exact: true })).toBeDisabled();
	await expectHeaderTooltip(page, header.getByRole('button', { name: copyNames('shell.save'), exact: true }), copy('ru', 'error.save_no_changes'));
	await expect(header.getByRole('button', { name: copyNames('shell.discard'), exact: true })).toHaveCount(0);
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
	const save = header.getByRole('button', { name: copyNames('shell.save'), exact: true });
	await expect(page.getByRole('main')).toHaveCount(1);
	await expect(page.locator('main main')).toHaveCount(0);
	await expect(save).toHaveCount(1);
	await expect(save).toBeDisabled();
	await page.evaluate(() => window.__h1!.edit());
	const dirtySave = header.getByRole('button', { name: copyNames('shell.dirtySave'), exact: true });
	await expect(dirtySave).toHaveCount(1);
	await expect(dirtySave).toBeEnabled();
	await expectHeaderTooltip(page, dirtySave, 'Save all changes');
	await expect(header.getByRole('button', { name: copyNames('shell.backup'), exact: true })).toBeEnabled();
	await expectHeaderTooltip(page, header.getByRole('button', { name: copyNames('shell.backup'), exact: true }), 'Create manual backup (Ctrl/Cmd+B)');
	await expect(header.getByRole('button', { name: copyNames('shell.discard'), exact: true })).toBeEnabled();
	await expectHeaderTooltip(page, header.getByRole('button', { name: copyNames('shell.discard'), exact: true }), 'Discard all unsaved changes (Ctrl/Cmd+Shift+Z)');
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
		await expect(header.getByRole('heading', { name: messages['shell.settings'], exact: true })).toBeVisible();
		await expect(dirtySave).toHaveCount(1);
		await expect(dirtySave).toBeEnabled();
		expect(await snapshot(page)).toEqual(before);
		expect(await mainNode!.evaluate(element => element.isConnected && element === document.querySelector('main'))).toBe(true);
		expect(await saveNode!.evaluate((element, name) => element.isConnected && element === Array.from(document.querySelectorAll('header button')).find(button => button.getAttribute('aria-label') === name), messages['shell.dirtySave'])).toBe(true);
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
	const linkText = (locale: string) => catalog(locale).then(messages => /<link>(.*)<\/link>/.exec(messages['shell.translationDisclosure'])![1]);
	const report = about.getByRole('link', { name: await linkText('en'), exact: true });
	await expect(report).toHaveAttribute('href', 'https://github.com/zendevio/hamlet-editor/issues');
	const linkMarker = await page.evaluate(() => window.__h1!.calls.length);
	await report.click();
	await expect(page).toHaveURL(/\/settings/);
	expect(await page.evaluate((start) => window.__h1!.calls.slice(start).filter(call => call.command === 'open_project_link'), linkMarker))
		.toEqual([{ command: 'open_project_link', args: { link: 'issues' } }]);
	const aboutNode = await about.elementHandle();
	await switchEditor(page, 'ru');
	await expect(about.getByRole('button', { name: (await catalog('ru'))['common.close'], exact: true })).toBeVisible();
	await expect(about.getByRole('link', { name: await linkText('ru'), exact: true })).toHaveAttribute('href', 'https://github.com/zendevio/hamlet-editor/issues');
	expect(await aboutNode!.evaluate(element => element.isConnected)).toBe(true);
	expect(await snapshot(page)).toEqual(before);
	await about.getByRole('button', { name: (await catalog('ru'))['common.close'], exact: true }).click();

	await switchEditor(page, 'en');
	await page.locator('[data-slot="sidebar-inset"] > header').getByRole('button', { name: copyNames('shell.discard'), exact: true }).click();
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
		await expect(discard.getByRole('button', { name: messages['discard.title'], exact: true })).toBeEnabled();
		expect(await cancelNode!.evaluate((element, name) => element.isConnected && element.textContent?.trim() === name, messages['settings.cancel'])).toBe(true);
		if (locale === 'ru') expect(messages['settings.cancel']).toBe('Отмена');
		expect(await discardNode!.evaluate(element => element.isConnected)).toBe(true);
		expect(await snapshot(page)).toEqual(before);
	}
	expectSwitchCalls(await page.evaluate(start => window.__h1!.calls.slice(start).filter(call => call.command !== 'open_project_link'), marker), persisted);
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
	const unsaved = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: copyNames('unsaved.title'), exact: true }) });
	await expect(unsaved.getByRole('heading')).toHaveText('Unsaved Changes');
	await expect(unsaved).toBeVisible();
	await expect(unsaved.getByRole('button', { name: copyNames('shell.save'), exact: true })).toBeVisible();
	await expect(unsaved.getByRole('button', { name: copyNames('shell.discard'), exact: true })).toBeVisible();
	const node = await unsaved.elementHandle();
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of ['ru', 'en']) {
		await switchEditor(page, locale);
		const messages = await catalog(locale);
		await expect(unsaved.getByRole('heading')).toHaveText(messages['unsaved.title']);
		await expect(unsaved.getByRole('button', { name: messages['shell.save'], exact: true })).toBeVisible();
		await expect(unsaved.getByRole('button', { name: messages['shell.discard'], exact: true })).toBeVisible();
		await expect(unsaved.getByRole('button', { name: messages['settings.cancel'], exact: true })).toBeVisible();
		await expect(unsaved.getByRole('button', { name: messages['common.close'], exact: true })).toBeVisible();
		await expect(unsaved.getByRole('button', { name: copyNames('shell.save'), exact: true })).toBeVisible();
		await expect(unsaved.getByRole('button', { name: copyNames('shell.discard'), exact: true })).toBeVisible();
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
		await page.locator('[data-slot="sidebar-inset"] > header').getByRole('button', { name: copyNames('shell.dirtySave'), exact: true }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByRole('heading', { name: 'Pre-Save Validation', exact: true })).toBeVisible();
		const node = await dialog.elementHandle();
		const persisted = await persistedSettings(page);
		const marker = await page.evaluate(() => window.__h1!.calls.length);
		const summary = errors ? `${errors} ${errors === 1 ? 'error' : 'errors'} and ${warnings} ${warnings === 1 ? 'warning' : 'warnings'} found.`
			: `${warnings} ${warnings === 1 ? 'warning' : 'warnings'} found.`;
		// Both complete catalogs must render the same quantities with their own grammar.
		for (const locale of ['en', 'ru']) {
			await switchEditor(page, locale);
			const messages = await catalog(locale);
			const localizedSummary = locale === 'en' ? summary : errors ? `Обнаружено: ${errors} ${errors === 1 ? 'ошибка' : 'ошибки'} и ${warnings} ${warnings === 1 ? 'предупреждение' : 'предупреждения'}.` : `Обнаружено ${warnings} ${warnings === 1 ? 'предупреждение' : 'предупреждения'}.`;
			await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText(localizedSummary);
			await expect(dialog.getByRole('button', { name: locale === 'en' ? `Fix ${warnings} ${warnings === 1 ? 'Issue' : 'Issues'} Automatically` : copy(locale, 'validation.fixCount', { count: warnings, countText: String(warnings) }), exact: true })).toBeEnabled();
			await expect(dialog.getByText(messages['validation.autoFixable'], { exact: true })).toHaveCount(warnings);
			await expect(dialog.getByText(messages['validation.category.treatment'], { exact: true })).toHaveCount(warnings);
			await expect(dialog.getByText(messages['validation.category.gear'], { exact: true })).toHaveCount(errors);
			await expect(dialog.getByRole('button', { name: copyNames('validation.saveAnyway'), exact: true })).toHaveCount(errors ? 0 : 1);
			await expect(dialog.getByRole('button', { name: messages['settings.cancel'], exact: true })).toBeVisible();
			await expect(dialog.getByRole('button', { name: messages['common.close'], exact: true })).toBeVisible();
			expect(await node!.evaluate(element => element.isConnected)).toBe(true);
			expect(await snapshot(page)).toEqual(before);
		}
		expectSwitchCalls(await page.evaluate(start => window.__h1!.calls.slice(start), marker), persisted);
		await dialog.getByRole('button', { name: (await catalog('ru'))['settings.cancel'], exact: true }).click();
		await expect(page.locator('[data-slot="sidebar-inset"] > header').getByRole('button', { name: copyNames('shell.dirtySave'), exact: true })).toBeEnabled();
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
	await row.getByRole('button').click();
	await expect(row).toHaveClass(/bg-accent/);
	const detail = page.getByTestId('hero-detail');
	await detail.getByRole('button', { name: 'Add Positive', exact: true }).click();
	const quirkPicker = page.getByTestId('quirk-picker');
	await quirkPicker.getByPlaceholder(copyNames('heroes.searchQuirks')).fill('warrior');
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
		const messages = await catalog(locale);
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
		const trinketSearch = trinketPicker.getByPlaceholder(copyNames('heroes.searchTrinkets'));
		await trinketSearch.fill(`${language}:trinket-a`);
		await expect(trinketPicker.getByText(`${language}:trinket-a`, { exact: true })).toBeVisible();
		await expect(trinketPicker.getByText(`${language}:trinket-a`, { exact: true })).toHaveAttribute('lang', locale);
		await trinketSearch.fill('no-such-trinket');
		await expect(trinketPicker.getByText(copy('ko', 'heroes.noTrinketFound'), { exact: true })).toBeVisible();
		// Groups without matches are hidden, not left as empty headings.
		await expect(trinketPicker.getByText(copy('ko', 'heroes.inventoryHeading'), { exact: true })).toHaveCount(0);
		await expect(trinketPicker.getByText(copy('ko', 'heroes.catalogueHeading'), { exact: true })).toHaveCount(0);
		await trinketSearch.fill('trinket');
		await expect(trinketSearch).toHaveValue('trinket');
		// The open popover traps focus, so the quirk search is only reachable once it is dismissed.
		await trinketSearch.press('Escape');
		await expect(trinketPicker).toHaveCount(0);
		// The spaced English alias occurs in neither the hyphenated display fixture nor the raw id.
		const quirkQuery = language === 'english' ? 'warrior' : 'Warrior of Light';
		const quirkSearch = quirkPicker.getByPlaceholder(copyNames('heroes.searchQuirks'));
		await quirkSearch.fill(quirkQuery);
		await expect(quirkSearch).toHaveValue(quirkQuery);
		await expect(quirkSearch).toBeFocused();
		await expect(quirkPicker.getByText(`${language}:warrior-of-light`, { exact: true })).toBeVisible();
		await expect(quirkPicker.getByText(`${language}:warrior-of-light`, { exact: true })).toHaveAttribute('lang', locale);
		// Reopen the trinket picker so the next switch again happens with both pickers open.
		await detail.getByTestId('trinket-picker-trigger').first().click();
		await expect(trinketPicker).toBeVisible();
		await expect(trinketPicker.getByPlaceholder(copyNames('heroes.searchTrinkets'))).toHaveValue('');
		nodes[4] = await trinketPicker.elementHandle();
		await expect(row).toHaveClass(/bg-accent/);
		expect(await snapshot(page)).toEqual(before);
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), persisted);
	expect(await persistedSettings(page)).toEqual(persisted);
	await evidence(info, 's3-heroes-open-pickers.aria.txt', await heroes.ariaSnapshot());
});

test('S3: class sorting flips after a game-text switch while the same hero row stays selected', async ({ page }) => {
	await page.goto('/heroes?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await page.evaluate(() => window.__h1!.edit());
	const heroes = page.getByTestId('heroes-page');
	const row = heroes.getByTestId('hero-row-96');
	await row.getByRole('button').click();
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
	await page.getByTestId('hero-row-96').getByRole('button').click();
	const detail = page.getByTestId('hero-detail');
	await detail.getByRole('button', { name: 'Reynauld', exact: true }).click();
	const input = detail.getByRole('textbox', { name: copyNames('heroes.heroName'), exact: true });
	await input.fill('名前の途中');
	const before = await snapshot(page);
	const node = await input.elementHandle();
	for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
		for (const key of ['Enter', 'Escape']) {
			await input.dispatchEvent('keydown', { key, bubbles: true, ...init });
			await expect(input).toHaveValue('名前の途中');
			await expect(input).toBeFocused();
			expect(await snapshot(page)).toEqual(before);
		}
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

test('S4: dirty estate names, wallet errors, invitations and trinkets stay mounted through both real pickers', async ({ page }, info) => {
	await page.goto('/estate?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await page.evaluate(() => window.__h1!.estateTownData());
	const estate = page.getByTestId('estate-page');
	await estate.getByRole('button', { name: 'Edit english:gold: 1,234,567', exact: true }).click();
	const amount = estate.getByRole('spinbutton').first();
	await amount.fill('-1');
	await amount.press('Enter');
	await expect(estate.getByRole('alert')).toBeVisible();
	const search = estate.getByRole('textbox', { name: copyNames('estate.searchStorage'), exact: true });
	await search.fill('ＴＲＩＮＫＥＴ');
	const name = estate.getByRole('textbox', { name: copyNames('estate.name'), exact: true });
	await name.fill('名前の途中');
	const trinket = estate.getByTestId('estate-trinket-h1_trinket_a');
	const nodes = await Promise.all([estate, name, amount, trinket].map((locator) => locator.elementHandle()));
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of allLocales) {
		await switchEditor(page, locale);
		const messages = await catalog(locale);
		await expect(page.locator('label[for=editor-language]')).toHaveText(messages['settings.editorLanguage']);
		await expect(estate.getByRole('heading', { name: messages['estate.wallet'], exact: true })).toBeVisible();
		await expect(estate.getByRole('alert')).toContainText(new Intl.NumberFormat(locale).format(999999999));
		await expect(estate.getByText('english:baron-invitation', { exact: true })).toBeVisible();
		await expect(name).toHaveValue('名前の途中');
		await expect(amount).toHaveValue('-1');
		expect(await snapshot(page)).toEqual(before);
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	for (const language of gameLanguages) {
		await switchGame(page, language);
		const locale = GAME_TEXT_LOCALES[language as keyof typeof GAME_TEXT_LOCALES];
		for (const suffix of ['gold', 'shards', 'blueprint', 'blood', 'baron-invitation']) {
			const label = estate.getByText(`${language}:${suffix}`, { exact: true });
			await expect(label).toBeVisible();
			await expect(label.locator('xpath=ancestor-or-self::*[@lang][1]')).toHaveAttribute('lang', locale);
		}
		await expect(trinket.getByText(`${language}:trinket-a`, { exact: true })).toHaveAttribute('lang', locale);
		await expect(amount).toHaveAttribute('lang', locale);
		for (const [id, suffix] of [['inv-a', 'baron-invitation'], ['inv-b', 'viscount-invitation'], ['inv-c', 'countess-invitation']]) {
			await expect(estate.locator(`#${id}`)).toHaveAttribute('aria-label', `${language}:${suffix}`);
			await expect(estate.locator(`#${id}`)).toHaveAttribute('lang', locale);
		}
		for (const suffix of ['blood', 'blueprint']) {
			const caption = estate.getByText(`${language}:${suffix}`, { exact: true });
			await expect(caption.locator('..')).toHaveAttribute('lang', locale);
		}
		await expect(estate.getByText(copy('ko', 'estate.heirloomCaption', { kind: 'bust' }), { exact: true })).toBeVisible();
		await expect(name).toHaveValue('名前の途中');
		await expect(amount).toHaveValue('-1');
		await expect(search).toHaveValue('ＴＲＩＮＫＥＴ');
		expect(await snapshot(page)).toEqual(before);
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), persisted);
	expect(await persistedSettings(page)).toEqual(persisted);
	await evidence(info, 's4-estate-dirty.aria.txt', await estate.ariaSnapshot());
	// The spaced English alias occurs in neither the current display label nor the raw id.
	await search.fill('English Jewel');
	await expect(estate.getByTestId('estate-trinket-h1_trinket_a')).toBeVisible();
	await expect(estate.getByTestId('estate-trinket-h1_trinket_b')).toBeVisible();
	await search.fill('missing-jewel');
	await expect(estate.getByText(copy('ko', 'estate.noMatches'), { exact: true })).toBeVisible();
});

test('S4: dirty town treatment, upgrade and district names follow game text while expanded cards survive editor switches', async ({ page }, info) => {
	await page.goto('/town?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await page.evaluate(() => window.__h1!.estateTownData());
	const town = page.getByTestId('town-page');
	const abbey = town.getByTestId('building-abbey');
	const forge = town.getByTestId('building-blacksmith');
	await abbey.getByRole('button').first().click();
	await forge.getByRole('button').first().click();
	const district = town.getByTestId('district-bank');
	const nodes = await Promise.all([town, abbey, forge, district, abbey.getByRole('button', { name: copyNames('town.release'), exact: true })].map((locator) => locator.elementHandle()));
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of allLocales) {
		await switchEditor(page, locale);
		const messages = await catalog(locale);
		await expect(page.locator('label[for=editor-language]')).toHaveText(messages['settings.editorLanguage']);
		await expect(town.getByRole('heading', { name: messages['town.treatmentBuildings'], exact: true })).toBeVisible();
		await expect(abbey.getByRole('button', { name: messages['town.release'], exact: true })).toBeVisible();
		await expect(abbey.getByRole('button', { name: copyNames('town.release'), exact: true })).toBeVisible();
		await expect(town.getByText(copy(locale, 'town.unknownUpgrade', { tree: '-123456789', instance: '1234', tier: 'opaque', purchased: 'yes' }), { exact: true })).toBeVisible();
		await expect(abbey.getByText('english:prayer', { exact: true })).toBeVisible();
		expect(await snapshot(page)).toEqual(before);
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	for (const language of gameLanguages) {
		await switchGame(page, language);
		const locale = GAME_TEXT_LOCALES[language as keyof typeof GAME_TEXT_LOCALES];
		for (const [container, suffix] of [[abbey, 'abbey'], [abbey, 'prayer'], [abbey, 'transept'], [forge, 'furnace'], [district, 'bank'], [town, 'puppet-theatre']] as const) {
			const label = container.getByText(`${language}:${suffix}`, { exact: true });
			await expect(label).toBeVisible();
			await expect(label).toHaveAttribute('lang', locale);
		}
		await expect(abbey.getByRole('button', { name: copyNames('town.release'), exact: true })).toBeVisible();
		expect(await snapshot(page)).toEqual(before);
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), persisted);
	expect(await persistedSettings(page)).toEqual(persisted);
	await evidence(info, 's4-town-dirty.aria.txt', await town.ariaSnapshot());
	// The store cascade changes only this raw tree, with its list in the active Korean message locale.
	await forge.getByRole('switch', { name: copy('ko', 'town.toggleTier', { name: 'koreana:furnace', tier: 'a' }), exact: true }).click();
	await expect(page.getByText(copy('ko', 'town.cascade', { count: 2, tiers: new Intl.ListFormat('ko').format(['b', 'c']), requiredTier: 'a' }), { exact: true })).toBeVisible();
	const after = await snapshot(page);
	const expected = structuredClone(before.data);
	const purchases = (expected.upgrades as { base_root: { purchases: Record<string, { is_purchased: boolean }> } }).base_root.purchases;
	for (const id of ['1', '2', '3']) purchases[id].is_purchased = false;
	expect(after.data).toEqual(expected);
});

test('S4: estate name ignores composing Enter, Escape and keyCode 229, then commits ordinary Enter exactly once', async ({ page }) => {
	await page.goto('/estate?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await page.evaluate(() => window.__h1!.edit());
	const input = page.getByRole('textbox', { name: copyNames('estate.name'), exact: true });
	await input.fill('名前の途中');
	const before = await snapshot(page);
	const node = await input.elementHandle();
	for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
		for (const key of ['Enter', 'Escape']) {
			await input.dispatchEvent('keydown', { key, bubbles: true, ...init });
			await expect(input).toHaveValue('名前の途中');
			await expect(input).toBeFocused();
			expect(await snapshot(page)).toEqual(before);
		}
		await expect(input).toHaveValue('名前の途中');
		await expect(input).toBeFocused();
		expect(await snapshot(page)).toEqual(before);
		expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	await input.press('Enter');
	const expected = structuredClone(before.data);
	(expected.game as { base_root: { estatename: string } }).base_root.estatename = '名前の途中';
	expect((await snapshot(page)).data).toEqual(expected);
	await input.press('Enter');
	expect((await snapshot(page)).data).toEqual(expected);
});

for (const route of ['estate', 'town'] as const) {
	test(`S4/D7: /${route} entity ordering changes with game labels while identities and dirty data survive`, async ({ page }) => {
		await page.goto(`/${route}?h1`);
		await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
		await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
		await page.evaluate(() => window.__h1!.estateTownData());
		const screen = page.getByTestId(`${route}-page`);
		const identity = screen.getByTestId(route === 'estate' ? 'estate-trinket-h1_trinket_a' : 'building-abbey');
		if (route === 'town') await identity.getByRole('button').first().click();
		const node = await identity.elementHandle();
		const selector = route === 'estate' ? '[data-testid^="estate-trinket-"]' : '[data-testid^="district-"]';
		const order = () => screen.locator(selector).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')));
		const prefix = route === 'estate' ? 'estate-trinket-' : 'district-';
		const a = route === 'estate' ? 'h1_trinket_a' : 'bank';
		const b = route === 'estate' ? 'h1_trinket_b' : 'buskers_corner';
		expect(await order()).toEqual([prefix + a, prefix + b]);
		const before = await snapshot(page);
		const persisted = await persistedSettings(page);
		const marker = await page.evaluate(() => window.__h1!.calls.length);
		await page.evaluate(() => window.__h1!.plans.push({ command: 'load_localization', language: 'japanese', value: {
			table: { ...window.__h1!.gameNames(), str_inventory_title_trinketh1_trinket_a: 'Zulu', str_inventory_title_trinketh1_trinket_b: 'Alpha',
				str_bank_title: 'Zulu', str_buskers_corner_title: 'Alpha', town_name_abbey: 'Zulu', town_name_tavern: 'Alpha' }, english: {}
		} }));
		await switchGame(page, 'japanese');
		await expect.poll(order).toEqual([prefix + b, prefix + a]);
		if (route === 'town') {
			await expect(identity.getByRole('button', { name: copyNames('town.release'), exact: true })).toBeVisible();
			const buildings = await screen.locator('[data-testid^="building-"]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')));
			expect(buildings.indexOf('building-tavern')).toBeLessThan(buildings.indexOf('building-abbey'));
		}
		expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
		expect(await snapshot(page)).toEqual(before);
		expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), persisted);
	});
}

test('S5: dirty raid, invalid buffer, same party slots and checked abandon dialog survive both real picker cycles', async ({ page }, info) => {
	await page.goto('/raid?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await page.evaluate(() => { window.__h1!.edit(); window.__h1!.raidData(); });
	const raid = page.getByTestId('raid-page');
	const buffer = raid.locator('#hunger-buffer');
	await buffer.fill('-1');
	await buffer.dispatchEvent('change');
	await expect(raid.locator('p[role=alert]')).toBeVisible();
	await page.getByLabel('Harness uncommitted name').fill('未確定 raid draft');
	await page.getByLabel('Harness selected hero').selectOption('7');
	await raid.getByRole('button', { name: copyNames('raid.abandon'), exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('checkbox').check();
	const nodes = await Promise.all([raid, buffer, raid.getByRole('group', { includeHidden: true }).first(), dialog, dialog.getByRole('checkbox')].map((locator) => locator.elementHandle()));
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of allLocales) {
		await switchEditor(page, locale);
		await expect(dialog.getByRole('heading', { name: copy(locale, 'raid.abandon'), exact: true })).toBeVisible();
		await expect(dialog.getByRole('checkbox')).toBeChecked();
		await expect(dialog.getByRole('button', { name: copy(locale, 'raid.abandon'), exact: true })).toBeEnabled();
		await expect(dialog).toContainText(copy(locale, 'raid.returnedTrinkets', { count: 2, countText: new Intl.NumberFormat(locale).format(2) }));
		await expect(raid.locator('p[role=alert]')).toContainText(new Intl.NumberFormat(locale).format(2147483647));
		await expect(raid.getByText(new Intl.ListFormat(locale).format(['goal_a', 'goal_b', 'mod_goal']), { exact: true })).toHaveCount(1);
		await expect(buffer).toHaveValue('-1');
		await expect(page.getByLabel('Harness uncommitted name')).toHaveValue('未確定 raid draft');
		await expect(page.getByLabel('Harness selected hero')).toHaveValue('7');
		expect(await snapshot(page)).toEqual(before);
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	for (const language of gameLanguages) {
		await switchGame(page, language);
		const locale = GAME_TEXT_LOCALES[language as keyof typeof GAME_TEXT_LOCALES];
		for (const name of ['ruins', 'apprentice', 'medium', 'crusader']) {
			await expect(raid.getByText(`${language}:${name}`, { exact: true })).toHaveAttribute('lang', locale);
		}
		await expect(raid.getByText(`${language}:herbs`, { exact: true })).toHaveAttribute('lang', locale);
		await expect(dialog.getByText(`${language}:herbs`, { exact: true })).toHaveAttribute('lang', locale);
		await expect(raid.getByText('Unknown Mod Item', { exact: true })).toHaveCount(1);
		await expect(buffer).toHaveValue('-1');
		await expect(dialog.getByRole('checkbox')).toBeChecked();
		expect(await snapshot(page)).toEqual(before);
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), persisted);
	expect(await persistedSettings(page)).toEqual(persisted);
	await evidence(info, 's5-raid-dirty.aria.txt', await dialog.ariaSnapshot());
});

test('S5: inconsistent raid warning keeps its code slot mounted through editor changes without data IPC', async ({ page }) => {
	await page.goto('/raid?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await page.evaluate(() => window.__h1!.raidData(true));
	const code = page.locator('code').filter({ hasText: 'inraid: true' });
	await expect(code).toHaveCount(1);
	const node = await code.elementHandle();
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of ['en', 'de', 'ru']) {
		await switchEditor(page, locale);
		await expect(code).toHaveText('inraid: true');
		await expect(page.getByText(copy(locale, 'raid.inconsistentTitle'), { exact: true }).last()).toBeVisible();
		expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
		expect(await snapshot(page)).toEqual(before);
	}
	expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), persisted);
});

test('S6/D12: the same mounted raid safety refusal follows the H1 pseudo catalog without mutation', async ({ page }) => {
	await page.goto('/raid?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await page.evaluate(() => { window.__h1!.raidData(); window.__h1!.blockRaidEstate(); });
	const refusal = page.getByTestId('raid-safety-refusal');
	const english = (await catalog('en'))['raid.block.estate'];
	await expect(refusal).toHaveText(english);
	const node = await refusal.elementHandle();
	const before = await snapshot(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of ['pseudo', 'en', 'pseudo', 'de', 'en'] as const) {
		await page.evaluate((next) => window.__h1!.catalog(next), locale);
		await expect(refusal).toHaveText(locale === 'pseudo' ? pseudoMessage(english) : copy(locale, 'raid.block.estate'));
		expect(await node!.evaluate((element) => element.isConnected && element === document.querySelector('[data-testid=raid-safety-refusal]'))).toBe(true);
		expect(await snapshot(page)).toEqual(before);
	}
	expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), await persistedSettings(page));
});

const setupInstall = { path: '/h1/detected-game', source: 'Gog', has_crimson_court: true, has_shieldbreaker: true,
	has_color_of_madness: true, has_musketeer: true, has_mods: true };
const setupSave = { path: '/h1/detected-profile', source: 'Epic', steam_user_id: null, profile_id: 'raw_profile_id', has_active_raid: true };
async function detectSetup(page: Page) {
	await page.evaluate(({ install, save }) => window.__h1!.plans.push(
		{ command: 'detect_game_installations', value: [install] }, { command: 'detect_save_locations', value: [save] }
	), { install: setupInstall, save: setupSave });
	await page.getByTestId('setup-wizard').getByRole('button', { name: 'Auto-detect Game Installation', exact: true }).click();
	await expect(page.getByTestId('setup-wizard').getByText('/h1/detected-game', { exact: true })).toBeVisible();
}

test('S5: all wizard steps render with no game path in en and de; selections and payload stay mounted through real pickers', async ({ page }, info) => {
	await page.goto('/heroes?h1&preSetup&emptyPaths');
	const wizard = page.getByTestId('setup-wizard');
	await expect(wizard).toBeVisible();
	await expect(page.locator('#editor-language')).toHaveCount(1);
	await detectSetup(page);
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const wizardNode = await wizard.elementHandle();
	for (const [step, heading] of [[1, 'setup.gameTitle'], [2, 'setup.saveTitle'], [3, 'setup.confirmation']] as const) {
		if (step === 2) {
			await wizard.getByRole('button', { name: copyNames('setup.next'), exact: true }).click();
			await wizard.getByRole('button', { name: copyNames('setup.detectSave'), exact: true }).click();
		}
		if (step === 3) await wizard.getByRole('button', { name: copyNames('setup.next'), exact: true }).click();
		const stepNode = await wizard.getByRole('heading', { name: copyNames(heading), exact: true }).elementHandle();
		const marker = await page.evaluate(() => window.__h1!.calls.length);
		for (const locale of ['en', 'de']) {
			await switchEditor(page, locale);
			await expect(wizard.getByRole('heading', { name: copy(locale, heading), exact: true })).toBeVisible();
			if (step !== 2) for (const id of ['crimson_court', 'shieldbreaker', 'color_of_madness', 'musketeer']) {
				const dlc = copy(locale, 'setup.dlcName', { dlc: id });
				await expect(wizard.getByText(dlc, { exact: true })).toBeVisible();
				await expect(wizard.getByText(dlc, { exact: true })).toHaveAttribute('lang', locale);
			}
			if (step !== 1) await expect(wizard.getByText(copy(locale, 'setup.inRaid'), { exact: true })).toBeVisible();
			if (step === 3) await expect(wizard.getByRole('button', { name: copy(locale, 'setup.openProfile'), exact: true })).toBeEnabled();
			expect(await wizardNode!.evaluate((element) => element.isConnected)).toBe(true);
			expect(await stepNode!.evaluate((element) => element.isConnected)).toBe(true);
			expect(await snapshot(page)).toEqual(before);
			expect(await page.evaluate(() => window.__h1!.getSettings().gamePath)).toBe('');
		}
		for (const language of ['german', 'english']) await switchGame(page, language);
		const calls = await page.evaluate((start) => window.__h1!.calls.slice(start), marker);
		expectSwitchCalls(calls, persisted);
		expect(calls.filter(({ command }) => command === 'load_localization')).toEqual([]);
		await evidence(info, `s5-wizard-no-path-step-${step}.aria.txt`, await wizard.ariaSnapshot());
	}
	expect(await persistedSettings(page)).toEqual(persisted);
	expect(await page.evaluate(() => window.__h1!.calls.filter(({ command }) => ['load_profile', 'set_name_table', 'save_profile'].includes(command)))).toEqual([]);
});

test('S5: wizard DLC names follow both real picker cycles with an available table and retain selected install', async ({ page }) => {
	await page.goto('/heroes?h1&preSetup');
	const wizard = page.getByTestId('setup-wizard');
	await expect(wizard).toBeVisible();
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	await detectSetup(page);
	const nodes = await Promise.all([wizard, wizard.getByRole('button').filter({ hasText: '/h1/detected-game' })].map((locator) => locator.elementHandle()));
	const before = await snapshot(page);
	const persisted = await persistedSettings(page);
	const marker = await page.evaluate(() => window.__h1!.calls.length);
	for (const locale of allLocales) {
		await switchEditor(page, locale);
		await expect(wizard.getByRole('heading', { name: copy(locale, 'setup.gameTitle'), exact: true })).toBeVisible();
		expect(await snapshot(page)).toEqual(before);
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	for (const language of gameLanguages) {
		await switchGame(page, language);
		for (const dlc of ['crimson-court', 'shieldbreaker', 'color-of-madness', 'musketeer']) {
			await expect(wizard.getByText(`${language}:${dlc}`, { exact: true })).toHaveAttribute('lang', GAME_TEXT_LOCALES[language as keyof typeof GAME_TEXT_LOCALES]);
		}
		expect(await snapshot(page)).toEqual(before);
		for (const node of nodes) expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
	}
	expectSwitchCalls(await page.evaluate((start) => window.__h1!.calls.slice(start), marker), persisted);
	expect(await persistedSettings(page)).toEqual(persisted);
	await expect(wizard.getByRole('button', { name: copyNames('setup.next'), exact: true })).toBeEnabled();
});

test('S6: Settings tooltip actions have one element and busy detection keeps accessible help', async ({ page }) => {
	await open(page);
	const settings = page.getByTestId('settings-page');
	await expect(settings.locator('button button')).toHaveCount(0);
	const messages = await catalog('en');
	for (const [id, help] of [['browse-game', 'browseGameHelp'], ['browse-save', 'browseSaveHelp'], ['detect-game', 'detectGameHelp'], ['detect-save', 'detectSaveHelp']]) {
		const button = settings.getByTestId(id);
		await expect(button).toHaveAccessibleName(messages[id.startsWith('browse') ? 'settings.browse' : 'settings.detect']);
		await expectHeaderTooltip(page, button, messages[`settings.${help}`]);
	}
	for (const [id, command, help] of [['detect-game', 'detect_game_installations', 'detectGameHelp'], ['detect-save', 'detect_save_locations', 'detectSaveHelp']]) {
		await page.evaluate((command) => window.__h1!.plans.push({ command, hold: 's6-detect', value: [] }), command);
		const button = settings.getByTestId(id);
		await button.click();
		await expect.poll(() => page.evaluate(() => window.__h1!.held())).toContain('s6-detect');
		await expect(button).toBeDisabled();
		const count = await page.evaluate((command) => window.__h1!.calls.filter((call) => call.command === command).length, command);
		await expectHeaderTooltip(page, button, messages[`settings.${help}`]);
		await button.press('Enter');
		await button.press('Space');
		expect(await page.evaluate((command) => window.__h1!.calls.filter((call) => call.command === command).length, command)).toBe(count);
		await page.evaluate(() => window.__h1!.release('s6-detect'));
		await expect(button).toBeEnabled();
	}
});

test('S6: hero tooltips share their action element, including blocked skill toggles', async ({ page }) => {
	await page.goto('/heroes?h1');
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
	const heroes = page.getByTestId('heroes-page');
	const filters = heroes.getByRole('button', { name: 'Toggle filters', exact: true });
	await expect(filters).toHaveCount(1);
	await expectHeaderTooltip(page, filters, 'Toggle filters');
	await filters.click();
	await expect(filters).toHaveAttribute('aria-expanded', 'true');
	await filters.click();
	await page.getByTestId('hero-row-96').getByRole('checkbox').check();
	for (const [name, help] of [['Heal All', 'healAllHelp'], ['Clear Stress', 'clearStressHelp']]) {
		const button = heroes.getByRole('button', { name, exact: true });
		await expect(button).toHaveCount(1);
		await expectHeaderTooltip(page, button, (await catalog('en'))[`heroes.${help}`]);
	}
	await page.getByTestId('hero-row-96').getByRole('button').click();
	const detail = page.getByTestId('hero-detail');
	await expectHeaderTooltip(page, detail.getByRole('button', { name: 'Reset', exact: true }), (await catalog('en'))['heroes.resetHelp']);
	await detail.getByRole('button', { name: 'Select english:smite', exact: true }).click();
	const combat = detail.getByRole('button', { name: 'Deselect english:smite', exact: true });
	await expect(combat).toHaveCount(1);
	await expect(combat).toBeDisabled();
	await expectHeaderTooltip(page, combat, (await catalog('en'))['heroes.combatMinimum']);
	const before = await snapshot(page);
	await combat.press('Enter');
	await combat.press('Space');
	expect(await snapshot(page)).toEqual(before);
	await expect(detail.getByRole('button', { name: /^(Select|Deselect) english:encourage$/, exact: true })).toHaveCount(1);
	await expect(heroes.locator('button button')).toHaveCount(0);
	await page.evaluate(() => window.__h1!.deadHero());
	const revive = heroes.getByRole('button', { name: 'Revive', exact: true });
	await expect(revive).toHaveCount(1);
	await expectHeaderTooltip(page, revive, (await catalog('en'))['heroes.reviveHelp']);
});
