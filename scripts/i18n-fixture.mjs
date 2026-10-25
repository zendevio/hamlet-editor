import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Offline, deterministic payload fixture. H1 compares both actual captured
// save_profile payloads against it; Rust encodes this same file.
const server = await createServer({
	configFile: false, cacheDir: 'node_modules/.vite/i18n-fixture',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error'
});
try {
	const { createHarnessProfile, applyFixtureEdits } = await server.ssrLoadModule('/src/lib/dev/fixture.ts');
	const store = await server.ssrLoadModule('/src/lib/stores/save-data.svelte.ts');
	store.loadRoster(createHarnessProfile()['persist.roster.json']);
	applyFixtureEdits(store);
	assert.equal(store.getHeroes()[0].name, 'Backups');
	await writeFile(new URL('../tests/fixtures/i18n-save-payload.json', import.meta.url), JSON.stringify(store.getDirtyData(), null, '\t') + '\n');
} finally { await server.close(); }
