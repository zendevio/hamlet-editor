// Shared rules for the H1 overflow gate and its reviewed baseline
// (tests/e2e/overflow-baseline.json). The Playwright helper, the baseline CLI
// and the unit tests all use this module, so matching never drifts.

/** Kinds the detector reports. Informational kinds never fail the gate. */
export const GATING_KINDS = Object.freeze(['clipped-text', 'clipped-control', 'truncated-text', 'text-spill', 'text-overlap', 'occluded-control', 'unreachable-control', 'horizontal-scroll', 'document-horizontal-overflow', 'possible-missing-glyph']);
export const INFORMATIONAL_KINDS = Object.freeze(['titled-truncation', 'occluded-until-scrolled']);
export const OVERFLOW_LOCALES = Object.freeze(['pseudo', 'de', 'ja-pseudo']);
export const OVERFLOW_VIEWPORTS = Object.freeze(['800x600', '1366x768']);
export const OVERFLOW_PROJECTS = Object.freeze(['chromium', 'webkit']);

export const findingKey = (finding) => `${finding.kind}|${finding.element}|${finding.target ?? ''}`;

const AXES = Object.freeze([['locales', 'locale', OVERFLOW_LOCALES], ['viewports', 'viewport', OVERFLOW_VIEWPORTS], ['projects', 'project', OVERFLOW_PROJECTS]]);
const runKey = (run) => `${run.locale}|${run.viewport}|${run.project}`;

/**
 * An entry accepts a run only when its state matches and the run's locale,
 * viewport and project are each listed. Scopes are explicit: a missing list
 * accepts nothing, never "all".
 */
export function applies(entry, context) {
	return entry.state === context.state && AXES.every(([field, axis]) => Array.isArray(entry[field]) && entry[field].includes(context[axis]));
}

/** Keys of the findings that the baseline accepts in one run. */
export function acceptedKeys(entries, context) {
	return new Set(entries.filter((entry) => applies(entry, context)).map(findingKey));
}

/** Every (locale, viewport, project) run an entry accepts: the product of its three lists. */
export function scopeRuns(entry) {
	const [locales, viewports, projects] = AXES.map(([field]) => Array.isArray(entry[field]) ? entry[field] : []);
	return locales.flatMap((locale) => viewports.flatMap((viewport) => projects.map((project) => ({ locale, viewport, project }))));
}

/**
 * Splits observed runs into disjoint scopes whose products contain only those
 * runs, so no scope accepts a combination that was not observed. Runs are
 * grouped by project set per (locale, viewport), then by viewport set per
 * locale, then by locale set; each step merges only identical sets.
 */
export function coverRuns(runs) {
	const observed = new Set(runs.map(runKey));
	const byLocale = [];
	for (const locale of OVERFLOW_LOCALES) {
		const viewportsByProjects = new Map();
		for (const viewport of OVERFLOW_VIEWPORTS) {
			const projects = OVERFLOW_PROJECTS.filter((project) => observed.has(runKey({ locale, viewport, project })));
			if (!projects.length) continue;
			const key = projects.join(',');
			viewportsByProjects.set(key, { projects, viewports: [...(viewportsByProjects.get(key)?.viewports ?? []), viewport] });
		}
		for (const group of viewportsByProjects.values()) byLocale.push({ locale, ...group });
	}
	const scopes = new Map();
	for (const { locale, viewports, projects } of byLocale) {
		const key = `${viewports.join(',')}|${projects.join(',')}`;
		scopes.set(key, { locales: [...(scopes.get(key)?.locales ?? []), locale], viewports, projects });
	}
	return [...scopes.values()];
}

/** Returns every problem in a parsed baseline file; an empty list means valid. */
export function validateBaseline(file) {
	const errors = [];
	if (!file || !Array.isArray(file.entries)) return ['baseline must be an object with an entries array'];
	const scopes = { locales: OVERFLOW_LOCALES, viewports: OVERFLOW_VIEWPORTS, projects: OVERFLOW_PROJECTS };
	const seen = new Map();
	file.entries.forEach((entry, index) => {
		const at = `entries[${index}]`;
		for (const field of ['state', 'kind', 'element']) {
			if (typeof entry[field] !== 'string' || !entry[field].trim()) errors.push(`${at}: ${field} must be a non-empty string`);
		}
		if (!GATING_KINDS.includes(entry.kind)) errors.push(`${at}: kind ${JSON.stringify(entry.kind)} is not a gating kind`);
		if (entry.target !== undefined && (typeof entry.target !== 'string' || !entry.target.trim())) errors.push(`${at}: target must be a non-empty string when present`);
		// A reason is the review record: it says why the finding is acceptable.
		if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20 || /^(todo|tbd|fixme)\b/i.test(entry.reason.trim())) errors.push(`${at}: reason must explain the accepted finding (at least 20 characters, not a placeholder)`);
		for (const [field, allowed] of Object.entries(scopes)) {
			if (entry[field] === undefined) {
				errors.push(`${at}: ${field} must be listed explicitly; an omitted scope accepts nothing`);
				continue;
			}
			if (!Array.isArray(entry[field]) || !entry[field].length || entry[field].some((value) => !allowed.includes(value)) || new Set(entry[field]).size !== entry[field].length) {
				errors.push(`${at}: ${field} must be a non-empty list of distinct values from ${allowed.join(', ')}`);
			}
		}
		const unknown = Object.keys(entry).filter((key) => !['state', 'kind', 'element', 'target', 'locales', 'viewports', 'projects', 'reason'].includes(key));
		if (unknown.length) errors.push(`${at}: unknown fields ${unknown.join(', ')}`);
		// Two entries for one finding must not cover the same run.
		const key = `${entry.state}|${findingKey(entry)}`;
		for (const [other, otherIndex] of seen.get(key) ?? []) {
			const overlaps = Object.keys(scopes).every((field) => Array.isArray(entry[field]) && Array.isArray(other[field]) && entry[field].some((value) => other[field].includes(value)));
			if (overlaps) errors.push(`${at}: duplicates entries[${otherIndex}] for an overlapping scope`);
		}
		seen.set(key, [...(seen.get(key) ?? []), [entry, index]]);
	});
	return errors;
}

/**
 * Summarises the JSON reports of one H1 run against the baseline.
 * unexpected: findings that fail the gate. stale: entries with at least one
 * accepted run that ran without the finding, so the baseline can shrink;
 * staleRuns lists those clean runs per stale entry.
 */
export function summarize(reports, baseline) {
	const unexpected = [];
	const clean = new Map();
	for (const report of reports) {
		const context = { state: report.state, locale: report.locale, viewport: report.viewport, project: report.project };
		for (const entry of baseline.entries) {
			if (!applies(entry, context) || report.baselined.some((finding) => findingKey(finding) === findingKey(entry))) continue;
			clean.set(entry, [...(clean.get(entry) ?? []), { locale: context.locale, viewport: context.viewport, project: context.project }]);
		}
		for (const finding of report.unexpected) unexpected.push({ ...context, ...finding });
	}
	const stale = baseline.entries.filter((entry) => clean.has(entry));
	return { reports: reports.length, unexpected, stale, staleRuns: stale.map((entry) => ({ entry, runs: clean.get(entry) })) };
}

const identity = ({ state, kind, element, target }) => ({ state, kind, element, ...(target !== undefined ? { target } : {}) });

/**
 * Builds a candidate baseline. Reviewed entries keep their reasons but lose
 * every run that ran clean (an entry with none left is dropped). Each new
 * finding becomes one or more entries whose scopes cover exactly the runs where
 * it occurred, with an empty reason that the validator rejects until a
 * reviewer writes one.
 */
export function candidate(reports, baseline) {
	const { unexpected, staleRuns } = summarize(reports, baseline);
	const kept = baseline.entries.flatMap((entry) => {
		const clean = new Set((staleRuns.find((stale) => stale.entry === entry)?.runs ?? []).map(runKey));
		if (!clean.size) return [entry];
		return coverRuns(scopeRuns(entry).filter((run) => !clean.has(runKey(run)))).map((scope) => ({ ...identity(entry), ...scope, reason: entry.reason }));
	});
	const groups = new Map();
	for (const finding of unexpected) {
		const key = `${finding.state}|${findingKey(finding)}`;
		const group = groups.get(key) ?? { entry: identity(finding), runs: [] };
		group.runs.push({ locale: finding.locale, viewport: finding.viewport, project: finding.project });
		groups.set(key, group);
	}
	const added = [...groups.values()].flatMap(({ entry, runs }) => coverRuns(runs).map((scope) => ({ ...entry, ...scope, reason: '' })));
	return { ...baseline, entries: [...kept, ...added] };
}
