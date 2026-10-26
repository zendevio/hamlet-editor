import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { loaded, hero } from './overflow-states.js';

// P3's concise localized placeholders must fit visibly. A full accessible name
// is checked separately and cannot excuse clipped placeholder text. English's
// existing layout/copy is held against the owner's before screenshots.
const locales = ['fr', 'de', 'es', 'it', 'pt-BR', 'pl', 'cs', 'ru', 'zh-Hans', 'ja', 'ko'] as const;
for (const locale of locales) {
	const messages = JSON.parse(readFileSync(new URL(`../../src/lib/i18n/catalogs/${locale}.json`, import.meta.url), 'utf8'));
	for (const viewport of [{ width: 800, height: 600 }, { width: 1366, height: 768 }]) {
		test(`localized hero search placeholder fits ${locale} ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
			await page.setViewportSize(viewport);
			await page.goto('/heroes?h1&overflow');
			await loaded(page);
			await hero(page);
			const before = await page.evaluate(() => window.__h1!.snapshot());
			await page.evaluate(next => window.__h1!.catalog(next), locale);
			await page.evaluate(() => document.fonts.ready);
			const input = page.getByTestId('heroes-page').getByRole('textbox', { name: messages['heroes.searchHeroesByNameOrClass'], exact: true });
			await expect(input).toBeVisible();
			await expect(input).toHaveAttribute('placeholder', messages['heroes.searchHeroes']);
			const metrics = await input.evaluate(element => {
				const input = element as HTMLInputElement;
				const style = getComputedStyle(input);
				const placeholder = getComputedStyle(input, '::placeholder');
				const canvas = document.createElement('canvas');
				const context = canvas.getContext('2d')!;
				context.font = `${placeholder.fontStyle} ${placeholder.fontWeight} ${placeholder.fontSize} ${placeholder.fontFamily}`;
				const spacing = parseFloat(placeholder.letterSpacing) || 0;
				return {
					placeholder: input.placeholder,
					textWidth: context.measureText(input.placeholder).width + spacing * Math.max(0, Array.from(input.placeholder).length - 1),
					availableWidth: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
				};
			});
			writeFileSync(info.outputPath('placeholder-metrics.json'), JSON.stringify({ locale, viewport, ...metrics }, null, 2));
			expect(metrics.textWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.availableWidth + 1);
			expect(await page.evaluate(() => window.__h1!.snapshot())).toEqual(before);
		});
	}
}
