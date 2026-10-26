import { readFile, rm } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { measureOverflow, overflowEvidence } from './overflow.js';

// Synthetic pages for the overflow detector itself: each case is a false green
// found in review, so the detector must report it, plus the designed cases it
// must keep accepting. No app or dev server state is involved.
const measure = async (page: Page, body: string, before?: () => void, htmlAttributes = '') => {
	await page.setViewportSize({ width: 800, height: 600 });
	await page.setContent(`<!doctype html><html lang="en" ${htmlAttributes}><head><style>
		body { margin: 0; font: 14px/20px sans-serif; }
		button { width: 120px; height: 32px; font: inherit; }
		.cover { left: 0; top: 0; width: 300px; height: 100px; background: #222; }
		.clip { display: block; width: 60px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	</style></head><body>${body}</body></html>`);
	if (before) await page.evaluate(before);
	return (await page.evaluate(measureOverflow, {})).findings.map(({ kind, element, target }) => ({ kind, element, ...(target ? { target } : {}) }));
};

test.describe('overflow detector: unreachable controls', () => {
	test('a fixed control wholly below the window is clipped by the viewport', async ({ page }) => {
		expect(await measure(page, '<button style="position: fixed; left: 0; top: 700px">Below</button>')).toEqual([
			{ kind: 'clipped-control', element: 'body > button "Below"', target: 'viewport' }
		]);
	});

	test('absolute content inside a fixed box is clipped by the viewport', async ({ page }) => {
		expect(await measure(page, '<div style="position: fixed; left: 0; top: 0"><button style="position: absolute; left: 0; top: 650px">Inside</button></div>')).toEqual([
			{ kind: 'clipped-control', element: 'body > button "Inside"', target: 'viewport' }
		]);
	});

	test('document content below the window is reachable by scrolling the document', async ({ page }) => {
		expect(await measure(page, '<div style="height: 900px"></div><button>Later</button>')).toEqual([]);
	});

	// Legal scroll positions never reveal content above or left of the document's scroll origin.
	for (const [name, style] of [['above', 'top: -100px'], ['left of', 'left: -200px'], ['partly above', 'top: -12px']] as const) {
		test(`a control ${name} the document's scrollable area is clipped by the viewport`, async ({ page }) => {
			expect(await measure(page, `<div style="height: 900px"></div><button style="position: absolute; left: 10px; top: 10px; ${style}">Out of reach</button>`)).toEqual([
				{ kind: 'clipped-control', element: 'body > button "Out of reach"', target: 'viewport' }
			]);
		});
	}

	test('a control above a scroll container\'s scrollable area is clipped by that container', async ({ page }) => {
		expect(await measure(page, '<div style="position: relative; height: 200px; width: 300px; overflow-y: auto"><button style="position: absolute; top: -60px">Above box</button><div style="height: 400px"></div></div>')).toEqual([
			{ kind: 'clipped-control', element: 'body > button "Above box"', target: 'body > div' }
		]);
	});

	test('a control below a document that cannot scroll is clipped by the viewport', async ({ page }) => {
		for (const htmlAttributes of ['style="overflow-y: hidden"', '']) {
			const body = htmlAttributes ? '' : '<style>body { overflow: hidden }</style>';
			expect(await measure(page, `${body}<div style="height: 900px"></div><button>Below</button>`, undefined, htmlAttributes)).toEqual([
				{ kind: 'clipped-control', element: 'body > button "Below"', target: 'viewport' }
			]);
		}
	});

	test('in a right-to-left document, content left of the window is reachable', async ({ page }) => {
		// The scroll origin is on the right, so the document scrolls left to it: no clip, only the wide document.
		expect(await measure(page, '<button style="position: absolute; top: 10px; left: -200px">Start side</button>', undefined, 'dir="rtl"')).toEqual([
			{ kind: 'document-horizontal-overflow', element: 'body > html' }
		]);
	});

	// Floating content (position: absolute, like bits-ui's wrapper) follows its anchor. The root cannot scroll, as in the app.
	const anchored = (anchorTop: number, contentTop: number) => `<div style="height: 200px; width: 300px; overflow-y: auto"><div style="height: ${anchorTop}px"></div><button aria-controls="pop">Anchor</button><div style="height: 600px"></div></div>` +
		`<div data-bits-floating-content-wrapper style="position: absolute; left: 0; top: ${contentTop}px; z-index: 5"><div id="pop" data-slot="popover-content"><button>Follows</button></div></div>`;

	test('floating content whose anchor is scrolled away is measured where the anchor shows', async ({ page }) => {
		// The anchor's box is scrolled so the anchor sits above it; the content went with it, above the window.
		expect(await measure(page, anchored(0, -300), () => { document.querySelector('div')!.scrollTop = 300; }, 'style="overflow: hidden"')).toEqual([]);
	});

	test('floating content cut by a window that cannot scroll, with its anchor in view, is clipped', async ({ page }) => {
		expect(await measure(page, anchored(0, 580), undefined, 'style="overflow: hidden"')).toEqual([
			{ kind: 'clipped-control', element: 'div[popover-content] > button "Follows"', target: 'viewport' }
		]);
	});

	test('a control whose hit tests all return nothing is reported', async ({ page }) => {
		// Stands in for a browser that returns no element for the control's points.
		expect(await measure(page, '<button>Nowhere</button>', () => { document.elementFromPoint = () => null; })).toEqual([
			{ kind: 'unreachable-control', element: 'body > button "Nowhere"' }
		]);
	});
});

test.describe('overflow detector: occlusion by fixed and sticky boxes', () => {
	for (const position of ['static', 'fixed', 'sticky']) {
		test(`an opaque ${position} box over a page control is occlusion`, async ({ page }) => {
			const cover = position === 'static'
				? '<div class="cover" style="position: relative; margin-top: -40px; z-index: 1"></div>'
				: `<div class="cover" style="position: ${position}; ${position === 'sticky' ? 'margin-top: -40px; ' : ''}z-index: 1"></div>`;
			expect(await measure(page, `<button>Covered</button>${cover}`)).toEqual([
				{ kind: 'occluded-control', element: 'body > button "Covered"', target: 'body > div' }
			]);
		});
	}

	test('open floating content may cover page controls', async ({ page }) => {
		expect(await measure(page, '<button>Under tooltip</button><div data-bits-floating-content-wrapper class="cover" style="position: fixed; z-index: 5"><div data-slot="tooltip-content" data-state="delayed-open">Tip</div></div>')).toEqual([]);
	});

	test('a fixed box over a control inside floating content is still occlusion', async ({ page }) => {
		expect(await measure(page, '<div data-bits-floating-content-wrapper style="position: fixed; left: 0; top: 0; z-index: 5"><div data-slot="popover-content"><button>In popover</button></div></div><div class="cover" style="position: fixed; z-index: 9"></div>')).toEqual([
			{ kind: 'occluded-control', element: 'div[popover-content] > button "In popover"', target: 'body > div' }
		]);
	});

	test('the marked loading overlay may cover the page; an unmarked status box may not', async ({ page }) => {
		expect(await measure(page, '<button>Waiting</button><div data-slot="loading-overlay" role="status" class="cover" style="position: fixed; z-index: 5">Loading</div>')).toEqual([]);
		expect(await measure(page, '<button>Waiting</button><div role="status" class="cover" style="position: fixed; z-index: 5">Loading</div>')).toEqual([
			{ kind: 'occluded-control', element: 'body > button "Waiting"', target: 'body > div(status) "Loading"' }
		]);
	});

	// A 200px scroll box at the top left; a fixed box covers its top 80px.
	const scroller = (content: string) => `<div style="height: 200px; width: 300px; overflow-y: auto">${content}</div><div class="cover" style="position: fixed; height: 80px; z-index: 1"></div>`;

	test('a control that scrolls clear of a fixed box is recorded, not gated, and scroll positions are restored', async ({ page }) => {
		// Scrolled so the button sits under the fixed box; scrolling back up clears it.
		expect(await measure(page, scroller('<div style="height: 150px"></div><button>Scrolls clear</button><div style="height: 400px"></div>'), () => { document.querySelector('div')!.scrollTop = 140; })).toEqual([
			{ kind: 'occluded-until-scrolled', element: 'body > button "Scrolls clear"', target: 'body > div' }
		]);
		expect(await page.evaluate(() => document.querySelector('div')!.scrollTop)).toBe(140);
	});

	test('a control a fixed box covers at every scroll position is occlusion', async ({ page }) => {
		// The scroll box cannot move the button below the fixed box's 80px band.
		expect(await measure(page, scroller('<button style="height: 70px">Always under</button><div style="height: 150px"></div>'))).toEqual([
			{ kind: 'occluded-control', element: 'body > button "Always under"', target: 'body > div' }
		]);
	});

	test('a control under a fixed box is occlusion when only an overflow: hidden box could move it', async ({ page }) => {
		expect(await measure(page, '<div style="height: 200px; width: 300px; overflow: hidden"><button>Hidden scroll</button><div style="height: 400px"></div></div><div class="cover" style="position: fixed; height: 80px; z-index: 1"></div>')).toEqual([
			{ kind: 'occluded-control', element: 'body > button "Hidden scroll"', target: 'body > div' }
		]);
	});

	// The document is scrolled so the button sits under a fixed box; only a user-scrollable document could clear it.
	const underCover = (setup: string) => `${setup}<div style="height: 150px"></div><button>Under cover</button><div style="height: 2000px"></div><div class="cover" style="position: fixed; height: 80px; z-index: 1"></div>`;
	const scrollDocument = () => { document.scrollingElement!.scrollTop = 140; };

	test('a document a user can scroll may scroll a control clear of a fixed box', async ({ page }) => {
		expect(await measure(page, underCover(''), scrollDocument)).toEqual([
			{ kind: 'occluded-until-scrolled', element: 'body > button "Under cover"', target: 'body > div' }
		]);
	});

	for (const [name, htmlAttributes, setup] of [
		['the root has overflow-y: hidden', 'style="overflow-y: hidden"', ''],
		['the body has overflow: hidden', '', '<style>body { overflow: hidden }</style>']
	] as const) {
		test(`a document is not scrolled clear of a fixed box when ${name}`, async ({ page }) => {
			expect(await measure(page, underCover(setup), scrollDocument, htmlAttributes)).toEqual([
				{ kind: 'occluded-control', element: 'body > button "Under cover"', target: 'body > div' }
			]);
			expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(140);
		});
	}

	test('a scroll lock keeps the document still for a control inside the open overlay', async ({ page }) => {
		// bits-ui's lock: body pointer-events none. The document itself could scroll, but not while the lock holds.
		const popover = '<div data-bits-floating-content-wrapper style="position: absolute; left: 0; top: 150px; pointer-events: auto"><div data-slot="popover-content"><button>Locked</button></div></div>';
		const cover = '<div class="cover" style="position: fixed; height: 80px; z-index: 9; pointer-events: auto"></div>';
		expect(await measure(page, `<style>body { pointer-events: none }</style>${popover}<div style="height: 2000px"></div>${cover}`, scrollDocument)).toEqual([
			{ kind: 'occluded-control', element: 'div[popover-content] > button "Locked"', target: 'body > div' }
		]);
	});

	test('a scroll container moves only on the axis a user can scroll', async ({ page }) => {
		// overflow-x: auto (with real overflow) and overflow-y: hidden: only a vertical move, which users cannot make, would clear the cover.
		const box = '<div style="height: 200px; width: 300px; overflow-x: auto; overflow-y: hidden"><div style="width: 900px"><div style="height: 150px"></div><button>Hidden axis</button><div style="height: 400px"></div></div></div>';
		expect(await measure(page, `${box}<div class="cover" style="position: fixed; height: 80px; z-index: 1"></div>`, () => { document.querySelector('div')!.scrollTop = 140; })).toEqual([
			{ kind: 'occluded-control', element: 'body > button "Hidden axis"', target: 'body > div' },
			{ kind: 'horizontal-scroll', element: 'body > div #1' }
		]);
		expect(await page.evaluate(() => document.querySelector('div')!.scrollTop)).toBe(140);
	});

	test('with a dialog open only the dialog is measured, and it may cover the page', async ({ page }) => {
		expect(await measure(page, '<button>Behind</button><div role="dialog" data-state="open" class="cover" style="position: fixed; z-index: 5"><button>Inside dialog</button></div>')).toEqual([]);
	});
});

test.describe('overflow detector: titled truncation needs the full text', () => {
	const text = 'A long label that cannot fit';
	const span = `body > span "${text}"`;
	for (const [name, title] of [['an empty', ''], ['a blank', '   '], ['an unrelated', 'irrelevant'], ['a partial', 'A long label']] as const) {
		test(`${name} title leaves truncated text gating`, async ({ page }) => {
			expect(await measure(page, `<span class="clip" title="${title}">${text}</span>`)).toEqual([
				{ kind: 'truncated-text', element: span, target: span }
			]);
		});
	}

	test('an empty nearer title hides a full title further up', async ({ page }) => {
		expect(await measure(page, `<div title="${text}"><span class="clip" title="">${text}</span></div>`)).toEqual([
			{ kind: 'truncated-text', element: span, target: span }
		]);
	});

	test('a title holding the full text, whitespace aside, is designed truncation', async ({ page }) => {
		expect(await measure(page, `<div title="  A long  label that\ncannot fit "><span class="clip">${text}</span></div>`)).toEqual([
			{ kind: 'titled-truncation', element: span, target: span }
		]);
	});
});

test.describe('overflow detector: scroll sampling follows what a user can scroll', () => {
	const sampled = async (page: Page, info: import('@playwright/test').TestInfo, state: string, htmlAttributes: string, setup = '') => {
		await page.setViewportSize({ width: 800, height: 600 });
		await page.setContent(`<!doctype html><html lang="en" ${htmlAttributes}><head><style>body { margin: 0 }</style>${setup}</head><body><div style="height: 2000px"></div></body></html>`);
		await overflowEvidence(page, info, { state, locale: 'pseudo', viewport: '800x600', project: info.project.name }, []);
		const report = JSON.parse(await readFile(info.outputPath(`${state}.json`), 'utf8')) as { samples: { position: string }[] };
		// A synthetic page is not app evidence: scripts/overflow-baseline.mjs must not count it.
		await rm(info.outputPath(`${state}.json`));
		return { positions: report.samples.map((sample) => sample.position), top: await page.evaluate(() => document.scrollingElement!.scrollTop) };
	};

	test('a document a user can scroll is sampled at each step', async ({ page }, info) => {
		const { positions, top } = await sampled(page, info, 'scrollable-document', '');
		expect(positions.length).toBeGreaterThan(1);
		expect(top).toBe(0);
	});

	for (const [name, htmlAttributes, setup] of [
		['root overflow hidden', 'style="overflow: hidden"', ''],
		['body overflow hidden', '', '<style>body { overflow: hidden }</style>'],
		['a scroll lock', 'style="overflow-y: auto"', '<style>body { pointer-events: none }</style>']
	] as const) {
		test(`a document under ${name} is not scrolled by the sampler`, async ({ page }, info) => {
			const { positions, top } = await sampled(page, info, `locked-${name.replaceAll(' ', '-')}`, htmlAttributes, setup);
			expect(positions).toEqual(['initial', 'restored']);
			expect(top).toBe(0);
		});
	}
});

test.describe('overflow detector: floating content excused while its anchor is away must come back', () => {
	// As in the app: the root cannot scroll, the anchor sits in a scroll box and
	// the floating wrapper is positioned against the window. On every scroll of
	// that box, "stranded" content leaves with its anchor and stays above the
	// window; "following" content tracks the anchor, as floating-ui autoUpdate does.
	const floating = async (page: Page, info: import('@playwright/test').TestInfo, state: string, follows: boolean) => {
		await page.setViewportSize({ width: 800, height: 600 });
		await page.setContent(`<!doctype html><html lang="en" style="overflow: hidden"><head><style>body { margin: 0 } button { width: 120px; height: 32px }</style></head><body>` +
			`<div id="box" style="height: 200px; width: 300px; overflow-y: auto"><button id="anchor" aria-controls="pop">Anchor</button><div style="height: 600px"></div></div>` +
			`<div data-bits-floating-content-wrapper style="position: absolute; left: 320px; top: 0; z-index: 5"><div id="pop" data-slot="popover-content"><button>Follows</button></div></div>` +
			`<script>
				const wrapper = document.querySelector('[data-bits-floating-content-wrapper]');
				document.getElementById('box').addEventListener('scroll', () => {
					wrapper.style.top = ${follows ? "document.getElementById('anchor').getBoundingClientRect().top + 'px'" : "'-300px'"};
				});
			</script></body></html>`);
		const unexpected = await overflowEvidence(page, info, { state, locale: 'pseudo', viewport: '800x600', project: info.project.name }, []);
		const report = JSON.parse(await readFile(info.outputPath(`${state}.json`), 'utf8')) as { samples: { position: string }[] };
		// A synthetic page is not app evidence: scripts/overflow-baseline.mjs must not count it.
		await rm(info.outputPath(`${state}.json`));
		return { unexpected: unexpected.map(({ kind, element, target, samples }) => ({ kind, element, target, samples })), positions: report.samples.map((sample) => sample.position) };
	};

	test('content stranded after its anchor scrolls back into view is clipped in the restored state', async ({ page }, info) => {
		const { unexpected, positions } = await floating(page, info, 'floating-stranded', false);
		// The box was stepped, so the content was excused in at least one sample.
		expect(positions.filter((position) => position.startsWith('scroll-')).length).toBeGreaterThan(0);
		expect(unexpected).toEqual([{ kind: 'clipped-control', element: 'div[popover-content] > button "Follows"', target: 'viewport', samples: ['restored'] }]);
	});

	test('content that comes back with its anchor keeps the exemption', async ({ page }, info) => {
		const { unexpected, positions } = await floating(page, info, 'floating-follows', true);
		expect(positions.filter((position) => position.startsWith('scroll-')).length).toBeGreaterThan(0);
		expect(positions.at(-1)).toBe('restored');
		expect(unexpected).toEqual([]);
	});
});
