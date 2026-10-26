import assert from 'node:assert/strict';
import { IntlMessageFormat } from 'intl-messageformat';
import { createHash } from 'node:crypto';
const tags = ['emphasis', 'code', 'link'];

// Pinned cardinal contract for the supported webviews. Host changes need review.
export const cardinalCategories = {
	en: ['one', 'other'], fr: ['many', 'one', 'other'], de: ['one', 'other'],
	es: ['many', 'one', 'other'], it: ['many', 'one', 'other'], 'pt-BR': ['many', 'one', 'other'],
	pl: ['few', 'many', 'one', 'other'], cs: ['few', 'many', 'one', 'other'], ru: ['few', 'many', 'one', 'other'],
	'zh-Hans': ['other'], ja: ['other'], ko: ['other']
};

export function checkCardinalCategories(locale, actual = new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
	assert.deepEqual([...actual].sort(), cardinalCategories[locale], `${locale}: ICU drift in cardinal categories`);
}

/** The revival title counts selected heroes, a nonnegative integer domain. */
export function requiredPluralCategories(locale, id, node) {
	const categories = new Intl.PluralRules(locale, { type: node.pluralType }).resolvedOptions().pluralCategories;
	if (node.pluralType === 'cardinal') checkCardinalCategories(locale, categories);
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
export function checkCatalogKeys(locale, catalog, english, complete = false) {
	for (const id of Object.keys(catalog)) assert.ok(Object.hasOwn(english, id), `${locale}: unknown key ${id}`);
	const missing = Object.keys(english).filter((id) => !Object.hasOwn(catalog, id));
	assert.ok(!complete || !missing.length, `${locale}: complete locale missing keys: ${missing.join(', ')}`);
	return missing;
}
export function checkMessageContract(locale, id, message, english) {
	const source = contract(new IntlMessageFormat(english, 'en').getAst());
	const actual = contract(new IntlMessageFormat(message, locale).getAst());
	assert.deepEqual(actual, source, `${locale}:${id}: message contract`);
}

export function checkPluralCoverage(locale, id, nodes) {
	for (const node of nodes) {
		if (node.type === 6) {
			for (const category of requiredPluralCategories(locale, id, node)) {
				assert.ok(node.options[category], `${locale}:${id}: missing plural category ${category}`);
			}
		}
		if (node.type === 5 || node.type === 6) Object.values(node.options).forEach((option) => checkPluralCoverage(locale, id, option.value));
		if (node.type === 8) checkPluralCoverage(locale, id, node.children);
	}
}

export const pluralSamples = [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 1.5, 1000000];

/** Witnesses follow this CI host's ICU, including offsets and exact selectors. */
export function pluralWitnesses(locale, node) {
	const rules = new Intl.PluralRules(locale, { type: node.pluralType });
	const values = new Set(pluralSamples.map((value) => value + node.offset));
	for (const selector of Object.keys(node.options)) if (selector.startsWith('=')) values.add(Number(selector.slice(1)));
	for (const category of rules.resolvedOptions().pluralCategories) {
		const witness = [...pluralSamples, ...Array.from({ length: 201 }, (_, index) => index), -1, 0.1, 2.1, 1000001]
			.find((value) => rules.select(value) === category && !node.options[`=${value + node.offset}`]);
		if (witness !== undefined) values.add(witness + node.offset);
	}
	return [...values];
}

export const sourceHash = (message) => createHash('sha256').update(message).digest('hex');

/**
 * Closed vocabulary of author and reviewer families (docs/translation-readiness.md). A model family names the
 * vendor whose models share training lineage; `human` is a person, who must be named. Extend this list, and the
 * doc, only for a vendor that actually drafts or reviews.
 */
export const identityFamilies = Object.freeze(['anthropic', 'openai', 'google', 'human']);

/**
 * Validates a structured identity and returns its independence keys: the agent session or thread
 * instance (case-insensitive), plus the normalised person for `human`. Instances are self-declared.
 * Two identities are independent only when they share no key, so one person cannot review their own work.
 */
export function checkIdentity(identity, role) {
	assert.ok(identity && typeof identity === 'object' && !Array.isArray(identity), `${role} needs a structured identity`);
	assert.ok(identityFamilies.includes(identity.family), `${role} identity family must be one of ${identityFamilies.join(', ')}`);
	const filled = (field) => typeof identity[field] === 'string' && identity[field].trim() !== '';
	assert.ok(filled('date'), `${role} identity missing date`);
	assert.match(identity.date, /^\d{4}-\d{2}-\d{2}$/, `${role} identity date must be YYYY-MM-DD`);
	const human = identity.family === 'human';
	assert.ok(filled(human ? 'person' : 'model'), `${role} identity missing ${human ? 'person' : 'model'}`);
	for (const field of ['model', 'person']) if (identity[field] !== undefined) assert.ok(filled(field), `${role} identity missing ${field}`);
	assert.ok(filled('instance'), `${role} identity missing instance`);
	const keys = [`instance:${identity.instance.trim().toLowerCase()}`];
	if (human) keys.push(`human:${identity.person.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()}`);
	return keys;
}

const shares = (a, b) => a.some((key) => b.includes(key));

export function translationState(record, english, translated, safety = false) {
	if (!record) return 'missing-review-record';
	assert.ok(['draft', 'reviewed', 'final'].includes(record.status), `Invalid review status: ${record.status}`);
	const drafterKeys = checkIdentity(record.drafter, 'Translation drafter');
	if (record.status !== 'draft') {
		assert.ok(record.reviewer && record.semanticVerdict === 'pass' && record.glossaryVersion, 'Reviewed translation needs reviewer, semantic verdict and glossary version');
		const reviewerKeys = checkIdentity(record.reviewer, 'Semantic reviewer');
		assert.ok(!shares(reviewerKeys, drafterKeys), 'Semantic reviewer must differ in instance from the drafter, and in person when both are human');
		assert.equal(record.reviewedSourceHash, record.sourceHash, 'Reviewed source hash is stale; review the source delta');
		assert.equal(record.reviewedTranslationHash, record.translationHash, 'Reviewed translation hash is stale; review the translation delta');
		if (safety) {
			const verdict = record.safetyVerdict;
			assert.equal(verdict?.verdict, 'pass', 'Safety translation needs a passing independent safety verdict');
			assert.equal(verdict.independent, true, 'Safety verdict must record an independent third check');
			assert.equal(verdict.sourceHash, record.sourceHash, 'Safety verdict source hash is stale');
			assert.equal(verdict.translationHash, record.translationHash, 'Safety verdict translation hash is stale');
			const safetyKeys = checkIdentity(verdict.reviewer, 'Safety reviewer');
			for (const field of ['action', 'object', 'conditions', 'reversibility', 'scope', 'codePath', 'workflow']) {
				assert.ok(typeof verdict[field] === 'string' && verdict[field].trim(), `Safety verdict missing ${field}`);
			}
			assert.ok(!shares(safetyKeys, drafterKeys) && !shares(safetyKeys, reviewerKeys),
				'Safety verdict needs a third independent reviewer instance, and another person when human');
		}
	}
	assert.ok(typeof record.sourceText === 'string' && typeof record.translationText === 'string', 'Missing review snapshots; record the exact source and translation inputs');
	assert.equal(sourceHash(record.sourceText), record.sourceHash, 'Source snapshot hash differs from recorded input');
	assert.equal(sourceHash(record.translationText), record.translationHash, 'Translation snapshot hash differs from recorded input');
	if (record.sourceHash !== sourceHash(english)) return 'stale-source';
	if (record.translationHash !== sourceHash(translated)) return 'stale-translation';
	return record.status;
}

/** Missing/stale copy is a main-branch warning; release approval remains strict. */
export function checkLocaleReadiness(locale, catalog, english, records, complete, release = false, safetyKeys = [], reviewRecords = {}) {
	const missing = checkCatalogKeys(locale, catalog, english, release && complete);
	const warnings = missing.map((id) => `${locale}:${id}: missing-translation`);
	const failures = [];
	if (locale !== 'en') for (const id of safetyKeys.filter((id) => Object.hasOwn(catalog, id))) {
		let failure;
		try {
			assert.equal(reviewRecords[id]?.status, 'final', 'needs a recorded final safety review');
			assert.equal(translationState(reviewRecords[id], english[id], catalog[id], true), 'final', 'needs a current passing safety verdict');
		} catch (error) {
			failure = `${locale}:${id}: ${error.message.split('\n')[0]}`;
		}
		if (failure) (release ? failures : warnings).push(failure);
	}
	for (const [id, state] of Object.entries(records)) {
		const stale = state.startsWith('stale-');
		if ((stale && release) || state === 'missing-review-record') failures.push(`${locale}:${id}: ${state}`);
		if (stale) warnings.push(`${locale}:${id}: ${state}`);
		if (complete && locale !== 'en' && !stale && !safetyKeys.includes(id) && state !== 'final') failures.push(`${locale}:${id}: complete locale needs final review`);
	}
	assert.equal(failures.length, 0, failures.join('\n'));
	return warnings;
}

/** Explicit manifest plus contexts flags must cover every known safety family. */
export function checkSafetyKeys(keys, contexts, english) {
	assert.ok(keys.length > 0 && new Set(keys).size === keys.length, 'Safety manifest must be non-empty with unique keys');
	const required = /^(?:hero\.safety\.|heroes\.(?:dismiss|reviv|reset(?:Help)?$)|error\.backup_rollback$|store\.revive|raid\.(?:abandon|block\.|confirm$|returnedTrinkets$)|settings\.(?:restore|gameRestore)|discard\.|unsaved\.)/;
	for (const id of Object.keys(english).filter((id) => required.test(id)).concat(['error.steam_restore_blocked', 'setup.cloudWarning'])) {
		assert.ok(keys.includes(id), `Safety manifest missing ${id}`);
	}
	for (const id of keys) assert.ok(Object.hasOwn(english, id), `Unknown safety key ${id}`);
	assert.deepEqual(Object.keys(contexts).filter((id) => contexts[id].safety === true).sort(), [...keys].sort(), 'Safety context flags must match manifest');
}

function literalLength(nodes) {
	return nodes.reduce((total, node) => total + (node.type === 0 ? [...node.value].length : node.type === 8
		? literalLength(node.children) : node.type === 5 || node.type === 6
			? Math.max(...Object.values(node.options).map((option) => literalLength(option.value))) : 0), 0);
}

/** Ignore ICU syntax and variable names when estimating short-label expansion. */
export function lengthBudgetWarning(english, translated, locale) {
	const source = literalLength(new IntlMessageFormat(english, 'en').getAst());
	const target = literalLength(new IntlMessageFormat(translated, locale).getAst());
	return source > 0 && source <= 40 && target > source * 1.8
		? { sourceLength: source, translatedLength: target, ratio: Number((target / source).toFixed(2)) } : null;
}
