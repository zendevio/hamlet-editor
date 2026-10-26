import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { acceptedKeys, applies, candidate, coverRuns, findingKey, OVERFLOW_LOCALES, OVERFLOW_PROJECTS, OVERFLOW_VIEWPORTS, scopeRuns, summarize, validateBaseline } from '../scripts/overflow-baseline-lib.mjs';

const reason = 'Accepted: fixture path is intentionally longer than any real path.';
const entry = (fields = {}) => ({ state: 'heroes', kind: 'clipped-text', element: '[data-testid=hero-detail] > span "x"', locales: ['pseudo', 'de'], viewports: ['800x600'], projects: ['chromium', 'webkit'], reason, ...fields });
const report = (fields = {}) => ({ state: 'heroes', locale: 'pseudo', viewport: '800x600', project: 'chromium', unexpected: [], baselined: [], ...fields });
const finding = (fields = {}) => ({ kind: 'clipped-text', element: '[data-testid=hero-detail] > span "x"', detail: 'cut by 9px horizontally', ...fields });

test('the committed overflow baseline is valid and every entry has a reviewed reason', async () => {
	const file = JSON.parse(await readFile(new URL('./e2e/overflow-baseline.json', import.meta.url), 'utf8'));
	assert.deepEqual(validateBaseline(file), []);
});

test('the H1 overflow spec gates on the validated baseline', async () => {
	// Guard against the suite silently going back to evidence-only.
	const spec = await readFile(new URL('./e2e/overflow.spec.ts', import.meta.url), 'utf8');
	assert.match(spec, /validateBaseline\(baselineFile\)/);
	assert.equal(spec.match(/expect\(unexpected, describeNew\(unexpected\)\)\.toEqual\(\[\]\)/g)?.length, 2);
});

test('validation rejects placeholder reasons, unknown kinds, informational kinds and bad scopes', () => {
	const errors = (entries) => validateBaseline({ entries });
	assert.deepEqual(errors([entry()]), []);
	assert.match(errors([entry({ reason: '' })])[0], /reason/);
	assert.match(errors([entry({ reason: 'TODO explain this one later please' })])[0], /reason/);
	assert.match(errors([entry({ kind: 'titled-truncation' })])[0], /not a gating kind/);
	assert.match(errors([entry({ kind: 'wobbly' })])[0], /not a gating kind/);
	assert.match(errors([entry({ locales: ['fr'] })])[0], /locales/);
	assert.match(errors([entry({ viewports: [] })])[0], /viewports/);
	assert.match(errors([entry({ projects: ['firefox'] })])[0], /projects/);
	assert.match(errors([entry({ note: 'x' })])[0], /unknown fields/);
	assert.match(errors([entry(), entry({ locales: ['pseudo'] })])[0], /duplicates entries\[0\]/);
	assert.deepEqual(errors([entry({ locales: ['de'] }), entry({ locales: ['pseudo'] })]), []);
	assert.deepEqual(validateBaseline({}), ['baseline must be an object with an entries array']);
});

test('summaries list new findings and stale entries only for scopes that ran', () => {
	const accepted = entry();
	const unused = entry({ element: 'gone' });
	const elsewhere = entry({ state: 'estate' });
	const baseline = { entries: [accepted, unused, elsewhere] };
	const fresh = finding({ element: 'new' });
	const result = summarize([report({ baselined: [finding()], unexpected: [fresh] })], baseline);
	assert.deepEqual(result.unexpected, [{ state: 'heroes', locale: 'pseudo', viewport: '800x600', project: 'chromium', ...fresh }]);
	assert.deepEqual(result.stale, [unused]);
});

test('a candidate keeps reviewed reasons, drops stale entries and scopes new findings', () => {
	const kept = entry();
	const baseline = { $comment: 'c', entries: [kept, entry({ element: 'gone' })] };
	const runs = ['chromium', 'webkit'].flatMap((project) => ['pseudo', 'de'].map((locale) => report({ project, locale, baselined: [finding()],
		unexpected: locale === 'pseudo' ? [finding({ element: 'new' })] : [] })));
	const next = candidate(runs, baseline);
	assert.equal(next.$comment, 'c');
	assert.deepEqual(next.entries, [kept, { state: 'heroes', kind: 'clipped-text', element: 'new', locales: ['pseudo'], viewports: ['800x600'], projects: ['chromium', 'webkit'], reason: '' }]);
	// The new entry cannot pass until a reviewer writes its reason.
	assert.match(validateBaseline(next)[0], /entries\[1\]: reason/);
});

const allRuns = OVERFLOW_LOCALES.flatMap((locale) => OVERFLOW_VIEWPORTS.flatMap((viewport) => OVERFLOW_PROJECTS.map((project) => ({ locale, viewport, project }))));
const key = (run) => `${run.locale}|${run.viewport}|${run.project}`;
const reviewed = (file) => ({ ...file, entries: file.entries.map((item) => ({ ...item, reason })) });
/** The full pseudo/de x 800/1366 x chromium/webkit matrix, with the finding only where `has` says so. */
const matrix = (has) => ['pseudo', 'de'].flatMap((locale) => OVERFLOW_VIEWPORTS.flatMap((viewport) => OVERFLOW_PROJECTS.map((project) =>
	report({ locale, viewport, project, unexpected: has({ locale, viewport, project }) ? [finding({ element: 'new' })] : [] }))));

test('candidates accept only the observed runs, not the product of their locales, viewports and projects', () => {
	// The review's example: two findings in unrelated runs of a full matrix.
	const seen = new Set(['pseudo|800x600|chromium', 'de|1366x768|webkit']);
	const next = reviewed(candidate(matrix((run) => seen.has(key(run))), { entries: [] }));
	assert.deepEqual(next.entries.map(({ locales, viewports, projects }) => ({ locales, viewports, projects })), [
		{ locales: ['pseudo'], viewports: ['800x600'], projects: ['chromium'] },
		{ locales: ['de'], viewports: ['1366x768'], projects: ['webkit'] }
	]);
	assert.deepEqual(validateBaseline(next), []);
	// Previously clean runs now showing the finding are still new findings.
	for (const run of allRuns) {
		const accepted = acceptedKeys(next.entries, { state: 'heroes', ...run }).has(findingKey(finding({ element: 'new' })));
		assert.equal(accepted, seen.has(key(run)), key(run));
	}
});

test('a partial run never widens a candidate to runs that did not execute', () => {
	// Only chromium ran; the finding appeared in every run that executed.
	const runs = matrix(() => true).filter((item) => item.project === 'chromium');
	const [added] = candidate(runs, { entries: [] }).entries;
	assert.deepEqual(added.projects, ['chromium']);
	assert.equal(applies(added, { state: 'heroes', locale: 'pseudo', viewport: '800x600', project: 'webkit' }), false);
});

test('scopes are explicit: an omitted list is rejected and accepts nothing', () => {
	const { projects: _, ...open } = entry();
	assert.match(validateBaseline({ entries: [open] })[0], /projects must be listed explicitly/);
	assert.equal(applies(open, { state: 'heroes', locale: 'pseudo', viewport: '800x600', project: 'chromium' }), false);
	assert.deepEqual(scopeRuns(open), []);
});

test('coverRuns splits every subset of runs into disjoint scopes that cover exactly that subset', () => {
	for (let mask = 1; mask < 1 << allRuns.length; mask++) {
		const subset = allRuns.filter((_, index) => mask & (1 << index));
		const covered = coverRuns(subset).flatMap((scope) => scopeRuns(scope).map(key));
		assert.equal(covered.length, new Set(covered).size, `overlapping scopes for mask ${mask}`);
		assert.deepEqual(covered.sort(), subset.map(key).sort(), `mask ${mask}`);
	}
});

test('an entry that ran clean in some runs is stale there and its candidate keeps only the other runs', () => {
	const wide = entry({ viewports: ['800x600', '1366x768'] });
	// Only 800x600 ran; the finding is gone in de on webkit.
	const runs = matrix(() => false).filter((item) => item.viewport === '800x600')
		.map((item) => ({ ...item, baselined: item.locale === 'de' && item.project === 'webkit' ? [] : [finding()] }));
	const { stale, staleRuns } = summarize(runs, { entries: [wide] });
	assert.deepEqual(stale, [wide]);
	assert.deepEqual(staleRuns[0].runs, [{ locale: 'de', viewport: '800x600', project: 'webkit' }]);
	const next = candidate(runs, { entries: [wide] });
	assert.ok(next.entries.every((item) => item.reason === reason));
	assert.deepEqual(validateBaseline(next), []);
	// 1366x768 did not run, so it is kept; only the clean run is removed.
	assert.deepEqual(next.entries.flatMap(scopeRuns).map(key).sort(), scopeRuns(wide).map(key).filter((run) => run !== 'de|800x600|webkit').sort());
	// An entry clean in every run that executed is dropped.
	assert.deepEqual(candidate(matrix(() => false), { entries: [entry()] }).entries, []);
});
