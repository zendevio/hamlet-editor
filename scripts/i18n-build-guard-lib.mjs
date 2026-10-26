import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';

const markers = /__h1|installHarness|PilotProof|InvariantFixture|rich-fixture|Pilot editor locale|mockIPC|pseudo-locale|catalog-override|⟦|⟧|\\u27e[67]/i;

const textExtensions = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.json', '.map', '.svg', '.txt', '.xml', '.webmanifest']);

export async function checkProductionBuild(root) {
	let files = 0;
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
			assert.ok(!markers.test(entry.name), `Dev i18n artifact in production: ${path.pathname}`);
			if (entry.isDirectory()) await visit(path);
			else {
				files++;
				if (textExtensions.has(extname(entry.name).toLowerCase())) {
					assert.ok(!markers.test(await readFile(path, 'utf8')), `Dev i18n content in production: ${path.pathname}`);
				}
			}
		}
	}
	await visit(root);
	assert.ok(files > 0, 'Production build is empty');
	return files;
}
