import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'svelte/compiler';
import ts from 'typescript';

// These attributes carry structure, styles or persisted identifiers. All other
// string-valued props, including new label and accessibility props, count as copy.
const structuralAttributes = new Set([
	'class', 'id', 'for', 'type', 'role', 'href', 'src', 'lang', 'variant', 'size', 'weight',
	'value', 'style', 'key', 'target', 'rel', 'side', 'align', 'orientation', 'dir',
	'inputmode', 'autocomplete', 'step', 'min', 'max', 'pattern', 'data-testid', 'aria-invalid',
	'aria-live', 'aria-current', 'aria-hidden', 'direction', 'relativePath', 'gameAssetPath'
]);
const styleCalls = new Set(['cn', 'clsx', 'cva', 'tv']);
const brands = { 'Hamlet Editor': 'Product name.', Steam: 'Platform brand.' };
const emptyAllowlist = { literals: brands, files: {}, patterns: [] };

function counter(messageKeys, allowlist, filename, seen) {
	const keys = new Set(messageKeys);
	const found = new Map();
	return {
		literal(value, position, scope = 'script') {
			if (typeof value !== 'string' || !/\p{L}/u.test(value)) return;
			const copy = value.trim();
			seen?.add(copy);
			if (keys.has(copy) || Object.hasOwn(brands, copy) ||
				Object.hasOwn(allowlist.literals ?? {}, copy) ||
				(scope === 'script' && Object.hasOwn(allowlist.files?.[filename] ?? {}, copy)) ||
				(allowlist.patterns ?? []).some(({ pattern, reason }) => reason && new RegExp(pattern, 'u').test(copy))) return;
			found.set(position, copy);
		},
		get literals() { return [...found.values()]; }
	};
}

/** Count syntax occurrences, not words. Logic literals count even when a helper
 * returns or throws them indirectly; a new file cannot hide English in .ts.
 * The conservative script scan also counts unlisted protocol ids. Exceptions
 * belong in the reviewed allowlist, with a reason, rather than a text heuristic.
 */
export function countCopy(source, filename, messageKeys = [], allowlist = emptyAllowlist, seen) {
	const count = counter(messageKeys, allowlist, filename, seen);
	if (filename.endsWith('.svelte')) {
		const ast = parse(source, { modern: true });
		function expression(node, scope = 'script') {
			if (!node || typeof node !== 'object') return;
			if (node.type === 'TSEnumDeclaration') {
				for (const member of node.members) expression(member.initializer, scope);
				return;
			}
			if (node.type?.startsWith('TS')) { if (node.expression) expression(node.expression, scope); return; }
			if (/Import.*|ExportSpecifier/.test(node.type ?? '')) return;
			if (node.type === 'CallExpression' && styleCalls.has(node.callee?.name)) return;
			if ((node.type === 'Property' || node.type === 'MethodDefinition') && !node.computed) {
				expression(node.value, scope);
				return;
			}
			if (node.type === 'Literal') count.literal(node.value, node.start, scope);
			if (node.type === 'TemplateElement') count.literal(node.value.cooked ?? node.value.raw, node.start, scope);
			for (const [key, value] of Object.entries(node)) {
				if (['loc', 'typeAnnotation', 'attributes'].includes(key)) continue;
				if (Array.isArray(value)) value.forEach((entry) => expression(entry, scope));
				else if (value && typeof value === 'object') expression(value, scope);
			}
		}
		function visibleExpression(node) {
			while (node?.type?.startsWith('TS') && node.expression) node = node.expression;
			if (node?.type === 'ConditionalExpression') {
				expression(node.test);
				visibleExpression(node.consequent);
				visibleExpression(node.alternate);
			} else if (node?.type === 'LogicalExpression') {
				visibleExpression(node.left);
				visibleExpression(node.right);
			} else if (node?.type === 'TemplateLiteral') {
				node.quasis.forEach((quasi) => expression(quasi, 'markup'));
				node.expressions.forEach(visibleExpression);
			} else if (node?.type === 'CallExpression' && node.callee?.name === 'String') {
				node.arguments.forEach(visibleExpression);
			} else expression(node, node?.type === 'Literal' ? 'markup' : 'script');
		}
		function markup(node) {
			if (!node || typeof node !== 'object') return;
			if (node.type === 'Text') count.literal(node.data, node.start, 'markup');
			if (node.expression) {
				if (['ExpressionTag', 'HtmlTag'].includes(node.type)) visibleExpression(node.expression);
				else expression(node.expression);
			}
			if (node.type === 'ConstTag') expression(node.declaration);
			if (node.type === 'SnippetBlock') node.parameters.forEach((parameter) => expression(parameter));
			const typeValue = node.attributes?.find((attribute) => attribute.name === 'type')?.value;
			const inputType = Array.isArray(typeValue) ? typeValue[0] : typeValue;
			const visibleValue = node.name === 'input' && ['submit', 'button', 'reset'].includes(
				inputType?.data ?? inputType?.expression?.value);
			for (const attribute of node.attributes ?? []) {
				if (['SpreadAttribute', 'OnDirective', 'UseDirective', 'AttachTag', 'TransitionDirective', 'AnimateDirective'].includes(attribute.type)) {
					expression(attribute.expression);
					continue;
				}
				if (attribute.type !== 'Attribute' || (structuralAttributes.has(attribute.name) && !(attribute.name === 'value' && visibleValue)) ||
					attribute.name.startsWith('data-') ||
					(attribute.name === 'name' && /^[a-z]/.test(node.name ?? ''))) continue;
				for (const entry of Array.isArray(attribute.value) ? attribute.value : [attribute.value]) {
					if (entry?.type === 'Text') count.literal(entry.data, entry.start, 'markup');
					else visibleExpression(entry?.expression ?? entry);
				}
			}
			for (const [key, value] of Object.entries(node)) {
				if (['attributes', 'expression', 'declaration', 'parameters', 'instance', 'module', 'css'].includes(key)) continue;
				if (Array.isArray(value)) value.forEach(markup);
				else if (value && typeof value === 'object') markup(value);
			}
		}
		expression(ast.instance?.content);
		expression(ast.module?.content);
		markup(ast.fragment);
	} else {
		const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
		function visit(node) {
			if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && styleCalls.has(node.expression.text)) return;
			if ((ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) && !ts.isComputedPropertyName(node.name)) {
				if (ts.isPropertyAssignment(node)) visit(node.initializer);
				else {
					node.parameters.forEach(visit);
					if (ts.canHaveDecorators(node)) ts.getDecorators(node)?.forEach(visit);
					if (node.body) visit(node.body);
				}
				return;
			}
			if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
				count.literal(node.text, node.pos);
			}
			ts.forEachChild(node, visit);
		}
		visit(ast);
	}
	return count.literals;
}

/** Retain the zero-copy Settings pilot gate alongside the repository ratchet. */
export function checkSettingsCopy(source, messageKeys) {
	const literals = countCopy(source, 'src/routes/settings/+page.svelte', messageKeys, {
		...emptyAllowlist, files: { 'src/routes/settings/+page.svelte': { dark: 'mode-watcher token.', 'game-text-load': 'Persistent toast identifier.' } }
	});
	assert.equal(literals.length, 0, `Hardcoded Settings text: ${literals.join(' | ')}`);
}

export function checkBaseline(literals, baseline) {
	for (const [file, current] of Object.entries(literals)) {
		const remaining = [...(baseline[file] ?? [])];
		for (const literal of current) {
			const index = remaining.indexOf(literal);
			assert.ok(index >= 0, `New hardcoded copy: ${file}: ${JSON.stringify(literal)}`);
			remaining.splice(index, 1);
		}
		assert.equal(remaining.length, 0,
			`Hardcoded copy decreased: ${file}: lower the baseline to ${current.length} literals by removing ${JSON.stringify(remaining)}`);
	}
	for (const file of Object.keys(baseline)) {
		assert.ok(Object.hasOwn(literals, file), `Stale hardcoded-copy baseline: ${file}: remove the unscanned file`);
	}
}

export async function scanCopy(root, messageKeys, allowlist) {
	const counts = {};
	const raw = {};
	async function visit(directory) {
		for (const entry of (await readdir(new URL(directory, root), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
			const file = `${directory}${entry.name}`;
			if (/^src\/lib\/dev(\/|$)/.test(file) || /(^|\/)(__tests__|tests)(\/|$)/.test(file)) continue;
			if (entry.isDirectory()) { await visit(`${file}/`); continue; }
			if (!/\.(svelte|ts)$/.test(file) || /(?:\.d\.ts|\.generated\.|\.(test|spec)\.)/.test(file)) continue;
			if (file.startsWith('src/lib/i18n/') && !file.endsWith('.svelte')) continue;
			const source = await readFile(new URL(file, root), 'utf8');
			raw[file] = new Set();
			counts[file] = countCopy(source, file, messageKeys, allowlist, raw[file]).sort();
		}
	}
	await visit('src/');
	checkAllowlist(raw, allowlist);
	return counts;
}

export function checkAllowlist(raw, allowlist) {
	const stale = [];
	for (const [file, entries] of Object.entries(allowlist.files ?? {})) {
		for (const [literal, reason] of Object.entries(entries)) {
			assert.ok(typeof reason === 'string' && reason.trim(), `${file}: allowlist reason missing for ${JSON.stringify(literal)}`);
			if (!raw[file]?.has(literal)) stale.push(`${file}: ${JSON.stringify(literal)}`);
		}
	}
	assert.equal(stale.length, 0, `Stale copy allowlist entries (no matching literal):\n${stale.join('\n')}`);
}
