import assert from 'node:assert/strict';
import { parse } from 'svelte/compiler';

// Structural attributes are code/data, never translated copy. Every other
// string-valued component prop is checked, including future label props.
const structuralAttributes = new Set([
	'class', 'id', 'for', 'type', 'role', 'href', 'lang', 'variant', 'size', 'weight',
	'data-testid', 'aria-invalid'
]);
const literalAllowlist = new Map([
	['Hamlet Editor', 'Product name is invariant.'],
	['Steam', 'Platform brand is invariant.'],
	['dark', 'mode-watcher comparison token in the checked switch expression.']
]);

export function checkSettingsCopy(source, messageKeys) {
	const keys = new Set(messageKeys);
	function literal(value) {
		if (typeof value !== 'string' || !/\p{L}/u.test(value)) return;
		assert.ok(keys.has(value) || literalAllowlist.has(value), `Hardcoded Settings text: ${value.trim()}`);
	}
	function walk(node, visit) {
		if (!node || typeof node !== 'object') return;
		visit(node);
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
			else if (value && typeof value === 'object') walk(value, visit);
		}
	}
	const bindings = new Map();
	function expressions(node, seen = new Set()) {
		walk(node, (entry) => {
			if (entry.type === 'Identifier' && bindings.has(entry.name) && !seen.has(entry.name)) {
				expressions(bindings.get(entry.name), new Set([...seen, entry.name]));
			}
			if (entry.type === 'Literal') literal(entry.value);
			if (entry.type === 'TemplateElement') literal(entry.value.cooked ?? entry.value.raw);
			if (entry.type === 'Text') literal(entry.data);
		});
	}
	function markup(node) {
		if (!node || typeof node !== 'object') return;
		if (node.type === 'Text') literal(node.data);
		if (node.type === 'ConstTag') expressions(node.declaration);
		if (node.type === 'ExpressionTag') expressions(node.expression);
		for (const attribute of node.attributes ?? []) {
			if (attribute.type !== 'Attribute' || structuralAttributes.has(attribute.name)) continue;
			expressions(attribute.value);
		}
		for (const [key, value] of Object.entries(node)) {
			if (['attributes', 'expression', 'instance', 'module', 'css'].includes(key)) continue;
			if (Array.isArray(value)) value.forEach(markup);
			else if (value && typeof value === 'object') markup(value);
		}
	}
	const ast = parse(source, { modern: true });
	// Follow copy held in simple script bindings, including rune-backed defaults.
	walk(ast.instance, (node) => {
		if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || !node.init) return;
		const init = node.init;
		if (['Literal', 'TemplateLiteral'].includes(init.type) ||
			(init.type === 'CallExpression' && ['$state', '$derived'].includes(init.callee.name) &&
				init.arguments.every((argument) => ['Literal', 'TemplateLiteral'].includes(argument.type)))) {
			bindings.set(node.id.name, init);
		}
	});
	markup(ast.fragment);
	// Script diagnostics are not UI copy. Check the APIs that display text.
	walk(ast.instance, (node) => {
		if (node.type !== 'CallExpression') return;
		const callee = node.callee;
		if (callee.name === 'toast' || (callee.type === 'MemberExpression' && callee.object.name === 'toast')) {
			node.arguments.forEach((argument) => expressions(argument));
		}
		if (callee.name === 'open') {
			for (const argument of node.arguments) {
				if (argument.type !== 'ObjectExpression') continue;
				for (const property of argument.properties) {
					if ((property.key?.name ?? property.key?.value) === 'title') expressions(property.value);
				}
			}
		}
		if (callee.name === 'showPersistentError') {
			// The descriptor's id is a catalog key. The optional third argument
			// is a structural toast id; only the detail argument is UI copy.
			node.arguments.slice(0, 2).forEach((argument) => expressions(argument));
		}
	});
}
