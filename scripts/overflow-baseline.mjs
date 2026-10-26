// Reports an H1 overflow run against the reviewed baseline.
//
//   node scripts/overflow-baseline.mjs <H1 output dir>          summary; exit 1 on new findings or an invalid baseline
//   node scripts/overflow-baseline.mjs <H1 output dir> --write  write a candidate baseline
//
// --write keeps every reviewed reason, narrows or drops entries whose runs ran
// clean and adds each new finding, scoped to exactly the runs where it
// occurred, with an empty reason. The H1 suite and pnpm test reject an empty
// reason, so a person must review the screenshot and explain each entry.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidate, summarize, validateBaseline } from './overflow-baseline-lib.mjs';

const baselinePath = fileURLToPath(new URL('../tests/e2e/overflow-baseline.json', import.meta.url));
const [dir, ...flags] = process.argv.slice(2);
if (!dir) {
	console.error('usage: node scripts/overflow-baseline.mjs <H1 output dir> [--write]');
	process.exit(2);
}
const reports = [];
const walk = (folder) => {
	for (const name of readdirSync(folder)) {
		const path = join(folder, name);
		if (statSync(path).isDirectory()) walk(path);
		else if (name.endsWith('.json')) {
			const report = JSON.parse(readFileSync(path, 'utf8'));
			// Overflow reports carry the gate summary; other H1 evidence is skipped.
			if (report.gate && Array.isArray(report.unexpected)) reports.push({ ...report, file: path });
		}
	}
};
walk(dir);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const errors = validateBaseline(baseline);
const { unexpected, stale, staleRuns } = summarize(reports, baseline);

console.log(`${reports.length} overflow reports, ${baseline.entries.length} baseline entries, ${unexpected.length} new findings, ${stale.length} stale entries`);
for (const finding of unexpected) console.log(`NEW   ${finding.project} ${finding.locale} ${finding.viewport} ${finding.state} ${finding.kind}: ${finding.element}${finding.target ? ` | ${finding.target}` : ''} (${finding.detail})`);
// Stale entries warn: they no longer hide anything, but the baseline should shrink.
const warn = process.env.GITHUB_ACTIONS ? '::warning title=Stale overflow baseline entry::' : 'STALE ';
for (const { entry, runs } of staleRuns) console.log(`${warn}${entry.state} ${entry.kind}: ${entry.element}${entry.target ? ` | ${entry.target}` : ''} (clean in ${runs.map((run) => `${run.project} ${run.locale} ${run.viewport}`).join(', ')})`);
for (const error of errors) console.log(`INVALID ${error}`);

if (flags.includes('--write')) {
	writeFileSync(baselinePath, JSON.stringify(candidate(reports, baseline), null, '\t') + '\n');
	console.log(`wrote ${baselinePath}; fill in every empty reason before committing`);
}
process.exit(unexpected.length || errors.length ? 1 : 0);
