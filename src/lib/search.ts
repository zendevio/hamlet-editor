/** Locale-independent matching across displayed names, English names and raw ids. */
export function normalizeSearch(value: string): string {
	return value.normalize('NFKC').toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ')
		.replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/đ/g, 'd')
		// Fold Latin accents and Cyrillic ё, while retaining й and kana voicing.
		.normalize('NFD').replace(/([\p{Script=Latin}е])[\u0300-\u036f]+/gu, '$1')
		.normalize('NFC').trim();
}

export function matchesSearch(query: string, ...candidates: string[]): boolean {
	const normalized = normalizeSearch(query);
	return candidates.some((candidate) => normalizeSearch(candidate).includes(normalized));
}
