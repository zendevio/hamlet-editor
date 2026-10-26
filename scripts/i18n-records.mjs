import { readFile, readdir, writeFile } from 'node:fs/promises';
import { draftRecords } from './i18n-records-lib.mjs';

const root = new URL('../src/lib/i18n/', import.meta.url);
const read = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const catalogs = Object.fromEntries(await Promise.all((await readdir(new URL('catalogs/', root)))
	.filter((file) => file.endsWith('.json')).map(async (file) => [file.slice(0, -5), await read(`catalogs/${file}`)])));
const argument = process.argv.find((value) => value.startsWith('--drafter='))?.slice('--drafter='.length);
const drafter = argument ? JSON.parse(argument) : undefined;
const records = draftRecords(catalogs.en, catalogs, await read('pilot-status.json'), drafter);
await writeFile(new URL('pilot-status.json', root), JSON.stringify(records, null, '\t') + '\n');
console.log('Review records updated. Unchanged translations keep their source association and author; changed translations are drafts with previous evidence; obsolete records are archived under removed. Run pnpm i18n:generate.');
