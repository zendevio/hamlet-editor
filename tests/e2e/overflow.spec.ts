import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { overflowEvidence, type BaselineEntry, type Finding } from './overflow.js';
import { validateBaseline } from '../../scripts/overflow-baseline-lib.mjs';
import { states, loaded, hero } from './overflow-states.js';

// The gate: every finding must be accepted, with a reason, in the reviewed
// baseline. Informational kinds (titled truncation) are recorded, never gated.
const baselineFile = JSON.parse(readFileSync(new URL('./overflow-baseline.json', import.meta.url), 'utf8'));
const baselineErrors = validateBaseline(baselineFile);
if (baselineErrors.length) throw new Error(`tests/e2e/overflow-baseline.json is invalid:\n${baselineErrors.join('\n')}`);
const baseline: BaselineEntry[] = baselineFile.entries;
const describeNew = (findings: Finding[]) => `New overflow findings (fix them, or add a reviewed entry with a reason to tests/e2e/overflow-baseline.json):\n${findings.map((finding) => `  ${finding.kind}: ${finding.element}${finding.target ? ` | ${finding.target}` : ''} (${finding.detail})`).join('\n')}`;
// Pseudo locales also expand the harness game-name table, the way German,
// Russian or Polish class, quirk, trinket and building names are longer.
const url = (path: string, locale: string) => `${path}${path.includes('?') ? '&' : '?'}h1&overflow${locale.endsWith('pseudo') ? '&pseudoNames' : ''}`;
const viewports = [{ width: 800, height: 600 }, { width: 1366, height: 768 }];
// Every real locale covers both supported sizes; ja-pseudo additionally
// stresses CJK typography at the minimum window.
const runs = [
	...(['pseudo', 'en', 'fr', 'de', 'es', 'it', 'pt-BR', 'pl', 'cs', 'ru', 'zh-Hans', 'ja', 'ko'] as const).flatMap((locale) => viewports.map((viewport) => ({ locale, viewport }))),
	{ locale: 'ja-pseudo' as const, viewport: viewports[0] }
];

for (const { locale, viewport } of runs) {
	const size = `${viewport.width}x${viewport.height}`;
	for (const state of states) {
		test(`overflow ${locale} ${size} ${state.name}`, async ({ page }, info) => {
			await page.setViewportSize(viewport);
			await page.goto(url(state.path, locale));
			if (state.loading) await expect.poll(() => page.evaluate(() => window.__h1?.held())).toContain('profile-read');
			else if (!state.setup) await loaded(page);
			await state.prepare?.(page);
			const before = await page.evaluate(() => window.__h1!.snapshot());
			await page.evaluate((next) => window.__h1!.catalog(next), locale);
			await state.measure?.(page);
			const unexpected = await overflowEvidence(page, info, { state: state.name, locale, viewport: size, project: info.project.name }, baseline);
			expect(await page.evaluate(() => window.__h1!.snapshot())).toEqual(before);
			expect(unexpected, describeNew(unexpected)).toEqual([]);
		});
	}
	// Every custom select in each page gets its open state captured. Native
	// selects expose their options in JSON; OS popups need packaged QA.
	for (const route of ['heroes', 'settings']) {
		test(`overflow ${locale} ${size} ${route} pickers`, async ({ page }, info) => {
			await page.setViewportSize(viewport);
			await page.goto(url(`/${route}?profiles`, locale));
			await loaded(page);
			if (route === 'heroes') { await page.evaluate(() => window.__h1!.vampireHero()); await hero(page); }
			await page.evaluate((next) => window.__h1!.catalog(next), locale);
			const unexpected: Finding[] = [];
			const measure = async (state: string) => unexpected.push(...await overflowEvidence(page, info, { state, locale, viewport: size, project: info.project.name }, baseline));
			const triggers = page.locator('[data-slot=select-trigger]');
			for (let index = 0; index < await triggers.count(); index++) {
				if (!await triggers.nth(index).isVisible() || !await triggers.nth(index).isEnabled()) continue;
				await triggers.nth(index).click();
				await expect(page.getByRole('listbox')).toBeVisible();
				await measure(`${route}-select-${index}`);
				await page.keyboard.press('Escape');
			}
			for (const id of ['editor-language', 'game-text-language']) {
				if (!await page.locator(`#${id}`).count()) continue;
				await page.locator(`#${id}`).focus();
				await measure(`${route}-${id}`);
			}
			expect(unexpected, describeNew(unexpected)).toEqual([]);
		});
	}
}
