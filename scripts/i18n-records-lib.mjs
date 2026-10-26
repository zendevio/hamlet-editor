import assert from 'node:assert/strict';
import { checkIdentity, sourceHash } from './i18n-contract.mjs';

/** Returns a copy of `record` with `earlier` attached at the end of its `previous` chain, so no evidence is lost. */
function withEarlier(record, earlier) {
	if (!earlier) return structuredClone(record);
	if (!record) return structuredClone(earlier);
	const result = structuredClone(record);
	let node = result;
	while (node.previous) node = node.previous;
	node.previous = structuredClone(earlier);
	return result;
}

/** Only a changed translation may establish a new source association here. */
export function draftRecords(english, catalogs, existing, drafter) {
	const result = structuredClone(existing);
	for (const [locale, records] of Object.entries(existing)) {
		if (locale === 'removed') continue;
		for (const [id, record] of Object.entries(records)) {
			if (Object.hasOwn(english, id) && Object.hasOwn(catalogs[locale] ?? {}, id)) continue;
			// A key removed a second time keeps its earlier archived record as the oldest `previous`.
			const archive = ((result.removed ??= {})[locale] ??= {});
			archive[id] = withEarlier(record, archive[id]);
			delete result[locale][id];
		}
		if (!Object.keys(result[locale]).length) delete result[locale];
	}
	for (const [locale, catalog] of Object.entries(catalogs)) {
		if (locale === 'en') continue;
		for (const [id, translationText] of Object.entries(catalog)) {
			assert.ok(Object.hasOwn(english, id), `${locale}: unknown key ${id}`);
			const sourceText = english[id];
			const old = existing[locale]?.[id];
			const hashes = { sourceHash: sourceHash(sourceText), translationHash: sourceHash(translationText) };
			if (old?.sourceHash === hashes.sourceHash && old?.translationHash === hashes.translationHash) continue;
			// Running the writer cannot establish that unchanged text covers new English.
			// A reviewer may explicitly update the source association after a real pass.
			if (old?.translationHash === hashes.translationHash) continue;
			assert.ok(!(old?.reviewKind === 'human' && old.sourceHash === hashes.sourceHash),
				`${locale}:${id}: human record protected while English is unchanged; record the correction explicitly`);
			// New text has a new author: the previous drafter is never carried over to it.
			assert.ok(drafter, `${locale}:${id}: translation changed; supply --drafter with the actual structured author identity of the new text`);
			checkIdentity(drafter, 'Translation drafter');
			// A re-added key links its archived record, so its history stays in one chain.
			const archived = result.removed?.[locale]?.[id];
			if (archived) {
				delete result.removed[locale][id];
				if (!Object.keys(result.removed[locale]).length) delete result.removed[locale];
				if (!Object.keys(result.removed).length) delete result.removed;
			}
			const previous = withEarlier(old, archived);
			(result[locale] ??= {})[id] = {
				status: 'draft', ...hashes, sourceText, translationText,
				drafter: structuredClone(drafter), reviewer: null, reviewKind: null,
				semanticVerdict: null, safetyVerdict: null, glossaryVersion: null,
				...(previous ? { previous } : {})
			};
		}
	}
	return result;
}
