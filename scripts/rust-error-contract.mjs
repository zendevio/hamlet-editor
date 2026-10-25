import assert from 'node:assert/strict';

// Tokenize strings and comments before examining constructor chains so braces,
// parentheses and AppError examples inside diagnostics cannot affect the gate.
function tokens(source) {
	return [...source.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|r(#{0,})"[\s\S]*?"\1|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'|[A-Za-z_][A-Za-z_0-9]*|::|[^\s]/g)]
		.filter(([value]) => !value.startsWith('//') && !value.startsWith('/*'))
		.map(([value]) => value);
}

function groupEnd(items, start) {
	const close = { '(': ')', '[': ']', '{': '}' }[items[start]];
	assert.ok(close, `Expected opening delimiter at ${items[start]}`);
	for (let i = start + 1; i < items.length; i++) {
		if (items[i] === close) return i;
		if (['(', '[', '{'].includes(items[i])) i = groupEnd(items, i);
	}
	assert.fail(`Unclosed delimiter ${items[start]}`);
}

function requiresTest(items) {
	if (items.length === 1) return items[0] === 'test';
	if (items[0] !== 'all' || items[1] !== '(') return false;
	for (let i = 2; i < items.length - 1; i++) {
		if (items[i] === 'test' && [',', ')'].includes(items[i + 1])) return true;
		if (items[i + 1] === '(') i = groupEnd(items, i + 1);
	}
	return false;
}

/** Check every production constructor, rather than constructing errors from
 * the fixture and comparing that fixture with itself. Literal chains are the
 * supported producer convention; dynamic codes/parameter keys fail closed.
 */
export function checkRustErrorProducers(source, contracts, fixtures, filename) {
	const items = tokens(source);
	const producers = [];
	const registeredParams = new Set([
		...fixtures.flatMap(({ params }) => Object.keys(params)), 'backupPath', 'saveFile', 'recoveryPath'
	]);
	for (let i = 0; i < items.length; i++) {
		if (items[i] === '#' && items[i + 1] === '[' && items[i + 2] === 'cfg') {
			const end = groupEnd(items, i + 1);
			if (requiresTest(items.slice(i + 4, end - 1))) {
				let next = end + 1;
				while (items[next] === '#' && items[next + 1] === '[') next = groupEnd(items, next + 1) + 1;
				if (items[next] === 'pub') {
					next++;
					if (items[next] === '(') next = groupEnd(items, next) + 1;
				}
				if (items[next] === 'mod') {
					i = items[next + 2] === ';' ? next + 2 : groupEnd(items, next + 2);
					continue;
				}
			}
		}
		let before = i - 1;
		while (items[before] === '::' && /^[A-Za-z_][A-Za-z_0-9]*$/.test(items[before - 1])) before -= 2;
		const returnType = items[before] === '>' && items[before - 1] === '-';
		if (items[i] === 'AppError' && items[i + 1] === '{' && !returnType && !/(^|[\\/])error\.rs$/.test(filename)) {
			assert.fail(`${filename}: AppError struct literals must use a checked constructor`);
		}
		if (items[i] === '.' && items[i + 1] === 'param' && items[i + 2] === '(') {
			assert.match(items[i + 3], /^"[A-Za-z_0-9]+"$/, `${filename}: param key must be a literal`);
			const key = JSON.parse(items[i + 3]);
			assert.ok(registeredParams.has(key), `${filename}: unregistered param ${key}`);
		}
		if (items.slice(i, i + 4).join(' ') !== 'AppError :: new (') continue;
		const codeToken = items[i + 4];
		assert.match(codeToken, /^"[a-z_0-9]+"$/, `${filename}: AppError code must be a stable literal`);
		assert.equal(items[i + 5], ')', `${filename}: unsupported AppError constructor`);
		const code = JSON.parse(codeToken);
		assert.ok(Object.hasOwn(contracts, code), `${filename}: unknown AppError code ${code}`);
		const fixture = fixtures.find((entry) => entry.code === code);
		assert.ok(fixture, `${filename}: missing error fixture for ${code}`);
		const params = new Set();
		let next = i + 6;
		while (items[next] === '.' && items[next + 2] === '(') {
			if (items[next + 1] === 'param') {
				assert.match(items[next + 3], /^"[A-Za-z_0-9]+"$/, `${filename}: ${code} param key must be a literal`);
				const key = JSON.parse(items[next + 3]);
				assert.ok(Object.hasOwn(fixture.params, key),
					`${filename}: ${code} has unregistered param ${key}`);
				params.add(key);
			}
			next = groupEnd(items, next + 2) + 1;
		}
		for (const key of contracts[code].params) {
			assert.ok(Object.hasOwn(fixture.params, key), `${filename}: ${code} fixture missing ${key}`);
			assert.ok(params.has(key), `${filename}: ${code} producer missing ${key}`);
		}
		producers.push(code);
	}
	return producers;
}
