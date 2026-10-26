import { sourceHash } from './i18n-contract.mjs';

/** Generate only the runtime freshness bits. Review evidence stays out of bundles. */
export function freshKeys(catalogs, records) {
	return Object.fromEntries(Object.entries(catalogs).sort(([a], [b]) => a.localeCompare(b)).map(([locale, catalog]) => [locale,
		Object.entries(catalog).filter(([id, message]) => {
			if (locale === 'en') return true;
			const record = records[locale]?.[id];
			return record?.sourceText === catalogs.en[id] && record?.translationText === message &&
				record.sourceHash === sourceHash(record.sourceText) && record.translationHash === sourceHash(message);
		}).map(([id]) => id).sort()
	]));
}
