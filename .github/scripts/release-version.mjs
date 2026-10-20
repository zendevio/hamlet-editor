import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';

const tag = process.env.TAG;
assert.match(tag ?? '', /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, 'Expected a version tag such as v1.0.0');
const version = tag.slice(1);
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"$/m)?.[1];
for (const [name, actual] of [['Tauri', config.version], ['npm', pkg.version], ['Cargo', cargo]]) {
	assert.equal(actual, version, `${name} version must match ${tag}`);
}
const prerelease = version.split('+')[0].includes('-');
if (prerelease) {
	assert.match(config.bundle?.windows?.wix?.version ?? '', /^\d+\.\d+\.\d+(?:\.\d+)?$/, 'Prereleases require a numeric bundle.windows.wix.version for MSI');
}
appendFileSync(process.env.GITHUB_OUTPUT, `is_prerelease=${prerelease}\n`);
