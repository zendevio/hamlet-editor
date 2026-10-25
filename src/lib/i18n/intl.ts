import { getEditorLocale } from './index.svelte.js';

const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat>(
	kind: string, options: object, create: (locale: string) => T
): T {
	const locale = getEditorLocale();
	const key = `${locale}:${kind}:${JSON.stringify(options)}`;
	let formatter = formatters.get(key);
	if (!formatter) {
		formatter = create(locale);
		formatters.set(key, formatter);
	}
	return formatter as T;
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
	return cached('number', options, (locale) => new Intl.NumberFormat(locale, options)).format(value);
}

export function formatDate(value: string | Date, options: Intl.DateTimeFormatOptions = {}): string {
	const date = typeof value === 'string' ? new Date(value) : value;
	if (!Number.isFinite(date.getTime())) return String(value);
	return cached('date', options, (locale) => new Intl.DateTimeFormat(locale, options)).format(date);
}

export function formatList(values: Iterable<string>, options: Intl.ListFormatOptions = {}): string {
	return cached('list', options, (locale) => new Intl.ListFormat(locale, options)).format(values);
}
