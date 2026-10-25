import assert from 'node:assert/strict';
import { IntlMessageFormat } from 'intl-messageformat';
const tags = ['emphasis', 'code', 'link'];

/** The revival title counts selected heroes, a nonnegative integer domain. */
export function requiredPluralCategories(locale, id, node) {
	const categories = new Intl.PluralRules(locale, { type: node.pluralType }).resolvedOptions().pluralCategories;
	// Exact =1 consumes the only English cardinal one count in this domain.
	// Other locales still need their full category set, including one at 21 or 0.
	if (locale === 'en' && id === 'heroes.reviveTitle' && node.value === 'count' &&
		node.pluralType === 'cardinal' && node.offset === 0 && node.options['=1']) {
		return categories.filter((category) => category !== 'one');
	}
	return categories;
}

// The AST comes from the exact same FormatJS parser as the runtime.
export function contract(nodes, params = {}, slots = new Set()) {
	for (const node of nodes) {
		if ([2, 3, 4].includes(node.type)) throw new Error('Inline number/date/time formatters are forbidden');
		if (node.type === 1) params[node.value] ??= 'string | number';
		if (node.type === 5 || node.type === 6) {
			params[node.value] = node.type === 6 ? 'number' : 'string';
			for (const option of Object.values(node.options)) contract(option.value, params, slots);
		}
		if (node.type === 8) {
			assert.ok(tags.includes(node.value), `Unapproved slot: ${node.value}`);
			slots.add(node.value);
			contract(node.children, params, slots);
		}
	}
	return { params: Object.fromEntries(Object.entries(params).sort()), slots: [...slots].sort() };
}


/** P2 allows absent translations, never unknown keys or incompatible contracts. */
export function checkCatalogKeys(locale, catalog, english) {
	for (const id of Object.keys(catalog)) assert.ok(Object.hasOwn(english, id), `${locale}: unknown key ${id}`);
	return Object.keys(english).filter((id) => !Object.hasOwn(catalog, id));
}
export function checkMessageContract(locale, id, message, english) {
	const source = contract(new IntlMessageFormat(english, 'en').getAst());
	const actual = contract(new IntlMessageFormat(message, locale).getAst());
	assert.deepEqual(actual, source, `${locale}:${id}: message contract`);
}
