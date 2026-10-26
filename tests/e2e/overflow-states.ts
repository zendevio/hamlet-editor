import { expect, type Locator, type Page } from '@playwright/test';
import type {} from '../../src/lib/dev/harness.js';

/** prepare runs in English before the catalog switch; measure runs after it,
 * for transient UI such as tooltips that must open with the final text. */
export type State = { name: string; path: string; prepare?: (page: Page) => Promise<void>; measure?: (page: Page) => Promise<void>; loading?: boolean; setup?: boolean };
export const header = (page: Page) => page.locator('[data-slot=sidebar-inset] > header');
export async function loaded(page: Page) {
	await expect.poll(() => page.evaluate(() => window.__h1?.snapshot().loaded)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.__h1!.gameText().loading)).toBe(false);
}
/** Marks a control found by its English name, so it can be found again after the catalog switch. */
async function mark(locator: Locator) {
	await locator.evaluate((element) => element.setAttribute('data-h1-overflow-target', ''));
}
async function hoverMarked(page: Page) {
	await page.locator('[data-h1-overflow-target]').hover();
	await expect(page.locator('[data-slot=tooltip-content]')).toBeVisible();
}
export async function hero(page: Page) {
	await page.getByTestId('hero-row-96').click();
	await expect(page.getByTestId('hero-detail')).toBeVisible();
}
async function restore(page: Page) {
	await page.getByTestId('settings-page').getByRole('button', { name: 'Restore', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
}
export const states: State[] = [
	...['/', '/heroes', '/estate', '/town', '/raid', '/settings'].map((path) => ({ name: path === '/' ? 'root-redirect' : path.slice(1), path })),
	{ name: 'empty-profile', path: '/heroes', prepare: async (page) => { await page.evaluate(() => window.__h1!.resetProfile()); } },
	{ name: 'loading-profile', path: '/heroes?profileLoading=read', loading: true },
	{ name: 'hero-detail', path: '/heroes', prepare: hero },
	// The tooltip trigger wraps this button and inherits its name, so the label
	// is the unique handle; wait for the expanded state, not just the click.
	{ name: 'hero-filters', path: '/heroes', prepare: async (page) => { const toggle = page.getByLabel('Toggle filters', { exact: true }); await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true'); } },
	{ name: 'hero-long-name', path: '/heroes', prepare: async (page) => { await page.evaluate(() => window.__h1!.longNames()); await hero(page); } },
	...['Add Positive', 'Add Negative'].map((name): State => ({
		name: `quirk-${name.split(' ')[1].toLowerCase()}`, path: '/heroes', prepare: async (page) => {
			await hero(page); await page.getByTestId('hero-detail').getByRole('button', { name, exact: true }).click();
			await expect(page.getByTestId('quirk-picker')).toBeVisible();
		}
	})),
	{ name: 'trinket-picker', path: '/heroes', prepare: async (page) => { await hero(page); await page.getByTestId('trinket-picker-trigger').first().click(); await expect(page.getByTestId('trinket-picker')).toBeVisible(); } },
	{ name: 'trinket-empty-results', path: '/heroes', prepare: async (page) => { await hero(page); await page.getByTestId('trinket-picker-trigger').first().click(); await page.getByTestId('trinket-picker').getByPlaceholder('Search trinkets...').fill('no-such-trinket'); } },
	{ name: 'dismiss', path: '/heroes', prepare: async (page) => { await hero(page); await page.getByTestId('hero-detail').getByRole('button', { name: /^Dismiss / }).click(); await expect(page.getByRole('dialog')).toBeVisible(); } },
	{ name: 'revive', path: '/heroes', prepare: async (page) => { await page.evaluate(() => window.__h1!.deadHero()); await hero(page); await page.getByTestId('hero-detail').getByRole('button', { name: 'Revive Hero', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); } },
	{ name: 'batch-toolbar', path: '/heroes', prepare: async (page) => { for (const id of ['96', '7']) await page.getByTestId(`hero-row-${id}`).getByRole('checkbox').check(); } },
	{ name: 'batch-level-picker', path: '/heroes', prepare: async (page) => { for (const id of ['96', '7']) await page.getByTestId(`hero-row-${id}`).getByRole('checkbox').check(); await page.locator('[data-slot=select-trigger]').filter({ hasText: 'Set Level' }).click(); await expect(page.getByRole('listbox')).toBeVisible(); } },
	{ name: 'batch-revive', path: '/heroes', prepare: async (page) => { await page.evaluate(() => window.__h1!.deadHero(['96', '7'])); for (const id of ['96', '7']) await page.getByTestId(`hero-row-${id}`).getByRole('checkbox').check(); await page.getByRole('button', { name: 'Revive', exact: true }).last().click(); await expect(page.getByRole('dialog')).toBeVisible(); } },
	// Every building card is opened, so each activity, slot and upgrade layout is measured.
	{ name: 'town-open-buildings', path: '/town', prepare: async (page) => {
		await page.evaluate(() => window.__h1!.estateTownData());
		const triggers = page.locator('[data-testid^=building-] [data-slot=collapsible-trigger][aria-expanded=false]');
		await expect(triggers.first()).toBeVisible();
		while (await triggers.count()) await triggers.first().click();
	} },
	{ name: 'estate-long-names', path: '/estate?longPaths', prepare: async (page) => { await page.evaluate(() => { window.__h1!.estateTownData(); window.__h1!.longNames(); }); } },
	{ name: 'estate-trinket-picker', path: '/estate', prepare: async (page) => { await page.getByTestId('trinket-picker-trigger').click(); await expect(page.getByTestId('trinket-picker')).toBeVisible(); } },
	{ name: 'raid-active', path: '/raid', prepare: async (page) => { await page.evaluate(() => window.__h1!.raidData()); } },
	{ name: 'raid-inconsistent', path: '/raid', prepare: async (page) => { await page.evaluate(() => window.__h1!.raidData(true)); } },
	{ name: 'raid-refusal', path: '/raid', prepare: async (page) => { await page.evaluate(() => { window.__h1!.raidData(); window.__h1!.blockRaidEstate(); }); } },
	{ name: 'abandon', path: '/raid', prepare: async (page) => { await page.evaluate(() => window.__h1!.raidData()); await page.getByTestId('raid-page').getByRole('button', { name: 'Abandon Raid', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); } },
	{ name: 'about', path: '/settings', prepare: async (page) => { await page.getByRole('button', { name: 'About', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); } },
	{ name: 'discard', path: '/settings', prepare: async (page) => { await page.evaluate(() => window.__h1!.edit()); await header(page).getByRole('button', { name: 'Discard', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); } },
	{ name: 'validation', path: '/settings', prepare: async (page) => { await page.evaluate(() => window.__h1!.validationCounts(1, 2)); await header(page).getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); } },
	{ name: 'restore', path: '/settings', prepare: restore },
	{ name: 'restore-game-backup', path: '/settings', prepare: async (page) => { await page.getByTestId('settings-page').getByRole('button', { name: 'Restore Game Backup', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); } },
	{ name: 'unsaved-changes', path: '/settings', prepare: async (page) => { await page.evaluate(() => window.__h1!.edit()); await restore(page); const dialog = page.getByRole('dialog'); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Restore', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Unsaved Changes', exact: true })).toBeVisible(); } },
	{ name: 'restore-recovery', path: '/settings', prepare: async (page) => { await page.evaluate(() => window.__h1!.plans.push({ command: 'restore_backup', fail: { code: 'transaction_rollback', params: { recoveryPath: '/h1/' + 'recovery/'.repeat(20) }, detail: 'fixture recovery diagnostic' } })); await restore(page); const dialog = page.getByRole('dialog'); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Restore', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'fixture recovery diagnostic' })).toBeVisible(); } },
	// The layout polls game status every 5 s, so the badge can take a full poll
	// period to appear; the wait covers that period plus IPC latency.
	...['running', 'uncertain', 'stale'].map((state): State => ({ name: `header-${state}`, path: '/settings', prepare: async (page) => { await page.evaluate((next) => { window.__h1!.edit(); if (next === 'stale') window.__h1!.markStale(); else window.__h1!.gameStatus(next === 'running' ? true : 'uncertain'); }, state); if (state !== 'stale') await expect(header(page).getByText(state === 'running' ? 'DD Running: Save Blocked' : 'Game Status Unknown: Save Blocked', { exact: true })).toBeVisible({ timeout: 10_000 }); } })),
	{ name: 'settings-long-paths', path: '/settings?longPaths' },
	{ name: 'mixed-editor-game-text', path: '/settings', prepare: async (page) => { await page.locator('#game-text-language').selectOption('japanese'); await expect.poll(() => page.evaluate(() => window.__h1!.gameText().effective)).toBe('japanese'); } },
	...['game_running', 'steam_restore_blocked', 'backup_wrong_profile', 'legacy_backup_wrong_profile', 'backup_manifest_mismatch', 'restore_backup_empty', 'future_refusal'].map((code): State => ({ name: `restore-blocked-${code}`, path: '/settings', prepare: async (page) => { await page.evaluate((next) => window.__h1!.plans.push({ command: 'check_restore', value: { adds: 2, removes: 1, blocked_reason: { code: next, params: {}, detail: 'fixture restore blocker' } } }), code); await restore(page); } })),
	// Tooltips open after the catalog switch, so they are sized for the measured text.
	{ name: 'tooltip-save-blocked', path: '/settings', prepare: async (page) => {
		await page.evaluate(() => { window.__h1!.edit(); window.__h1!.gameStatus(true); });
		await expect(header(page).getByText('DD Running: Save Blocked', { exact: true })).toBeVisible({ timeout: 10_000 });
		await mark(header(page).getByRole('button', { name: 'Unsaved changes. Save all changes.', exact: true }));
	}, measure: hoverMarked },
	{ name: 'tooltip-deaths-door', path: '/heroes', prepare: async (page) => {
		await hero(page);
		await mark(page.getByTestId('hero-detail').locator('[data-slot=tooltip-trigger]').filter({ hasText: 'Historical flag' }));
	}, measure: hoverMarked },
	// Persistent notices: startup recovery and read failure, game text load failure, settings write failure.
	{ name: 'notice-settings-recovered', path: '/settings?startup=corrupt', setup: true, prepare: async (page) => { await expect(page.getByRole('alert').filter({ hasText: 'settings.json.corrupt-123/settings.json' })).toBeVisible(); } },
	{ name: 'notice-settings-unreadable', path: '/settings?startup=unreadable', setup: true, prepare: async (page) => { await expect(page.getByRole('alert').filter({ hasText: 'could not be read' })).toBeVisible({ timeout: 4000 }); } },
	{ name: 'notice-game-text-failed', path: '/settings', prepare: async (page) => {
		await page.evaluate(() => window.__h1!.plans.push({ command: 'load_localization', fail: 'fixture: unreadable /h1/' + 'game/'.repeat(12) }));
		await page.locator('#game-text-language').selectOption('koreana');
		await expect(page.getByRole('alert').filter({ hasText: 'fixture: unreadable' })).toBeVisible();
	} },
	{ name: 'notice-persistence-failed', path: '/settings', prepare: async (page) => {
		await page.evaluate(() => window.__h1!.plans.push({ command: 'plugin:store|save', fail: 'fixture: settings write denied' }));
		await page.locator('#game-text-language').selectOption('german');
		await expect(page.locator('[data-sonner-toast]').getByRole('alert').filter({ hasText: 'may not survive a restart' })).toBeVisible();
	} },
	...[1, 2, 3].map((step): State => ({ name: `setup-step-${step}`, path: '/heroes?preSetup&emptyPaths', setup: true, prepare: async (page) => {
		const wizard = page.getByTestId('setup-wizard');
		await expect(wizard).toBeVisible();
		await page.evaluate(() => window.__h1!.plans.push({ command: 'detect_game_installations', value: [{ path: '/h1/' + 'long-game-path/'.repeat(12), source: 'Manual', has_crimson_court: true, has_shieldbreaker: true, has_color_of_madness: true, has_musketeer: true, has_mods: true }] }));
		await wizard.getByRole('button', { name: 'Auto-detect Game Installation', exact: true }).click();
		await expect(wizard.getByRole('button').filter({ hasText: 'long-game-path' })).toBeVisible();
		if (step >= 2) { await wizard.getByRole('button', { name: 'Next', exact: true }).click(); await wizard.getByRole('button', { name: 'Auto-detect Save Files', exact: true }).click(); await expect(wizard.getByText('/h1/profile_0', { exact: true })).toBeVisible(); }
		if (step === 3) await wizard.getByRole('button', { name: 'Next', exact: true }).click();
	} }))
];
