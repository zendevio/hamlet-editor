import { chromium, type FullConfig, type Page } from '@playwright/test';
import type {} from '../../src/lib/dev/harness.js';

// The webServer check only proves the dev server answers HTTP. On a cold cache
// Vite still has to transform the app and may discover and optimize more
// dependencies, then reload open pages. Tests that started in that window saw a
// blank page. Playwright runs this after the webServer is up and before any
// worker starts (https://playwright.dev/docs/test-global-setup-teardown), so
// every route the suite mounts is compiled, optimized and proven ready first.
const routes = ['/settings', '/heroes', '/estate', '/town', '/raid'];
// Readiness is a wait for the app, not a test budget: a cold CI runner can need
// well over the 5 s expect timeout to compile the first route.
const readyTimeout = 180_000;
const maxPasses = 4;

// Polls across reloads: an optimizer reload destroys the execution context,
// which is a reason to look again, not a failure.
async function ready(page: Page) {
	const deadline = Date.now() + readyTimeout;
	let last: unknown = 'not polled';
	while (Date.now() < deadline) {
		try {
			if (await page.evaluate(() => window.__h1?.snapshot().loaded === true && window.__h1.gameText().loading === false)) return;
			last = 'harness not loaded';
		} catch (error) {
			last = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`H1 warm-up: ${page.url()} was not ready after ${readyTimeout} ms (${String(last)})`);
}

async function visit(page: Page, url: string, prepare?: (page: Page) => Promise<void>) {
	await page.goto(url, { timeout: readyTimeout });
	await ready(page);
	if (prepare) {
		await prepare(page);
		await ready(page);
	}
	// Let a pending optimizer reload start before this visit is counted.
	await page.waitForLoadState('networkidle', { timeout: readyTimeout });
}

export default async function globalSetup(config: FullConfig) {
	const baseURL = config.projects[0]?.use.baseURL ?? config.webServer?.url;
	if (!baseURL) throw new Error('H1 warm-up needs a baseURL');
	const started = Date.now();
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ baseURL });
		let loads = 0;
		page.on('load', () => { loads += 1; });
		const visits: [string, ((page: Page) => Promise<void>)?][] = [
			// ?h1 mounts the invariant fixture (a dynamic import); the pseudo and
			// German catalogs load the dev catalog override used by the overflow suite.
			...routes.map((route): [string] => [`${route}?h1`]),
			[`/heroes?h1&overflow&pseudoNames`, async (page) => {
				await page.evaluate(() => window.__h1!.catalog('ja-pseudo'));
				await page.evaluate(() => window.__h1!.catalog('de'));
			}]
		];
		// A pass is clean when every visit loaded exactly once: no dependency
		// optimization reloaded a page, so later pages will not be reloaded either.
		for (let pass = 1; pass <= maxPasses; pass += 1) {
			const before = loads;
			for (const [url, prepare] of visits) await visit(page, url, prepare);
			const reloads = loads - before - visits.length;
			console.log(`H1 warm-up pass ${pass}: ${visits.length} routes ready, ${reloads} reload(s), ${Math.round((Date.now() - started) / 1000)} s`);
			if (reloads === 0) return;
		}
		throw new Error(`H1 warm-up: the dev server still reloaded pages after ${maxPasses} passes`);
	} finally {
		await browser.close();
	}
}
