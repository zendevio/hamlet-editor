import { IntlMessageFormat } from 'intl-messageformat';

export type Catalog = Readonly<Record<string, string>>;
export type Params = Readonly<Record<string, string | number>>;
export type RichTag = 'emphasis' | 'code' | 'link';
export type RichPart = string | { tag: RichTag; children: RichPart[] };

const tags: RichTag[] = ['emphasis', 'code', 'link'];

/** ICU owns parsing and slot ordering. The renderer receives only approved slot objects. */
export function createTranslator(catalogs: Readonly<Record<string, Catalog>>) {
	const cache = new Map<string, IntlMessageFormat>();

	function format(locale: string, id: string, params: Params = {}): RichPart[] {
		for (const candidate of new Set([locale, 'en'])) {
			const source = catalogs[candidate]?.[id];
			if (!source?.trim()) continue;
			try {
				const cacheKey = `${candidate}:${id}`;
				let formatter = cache.get(cacheKey);
				if (!formatter) {
					formatter = new IntlMessageFormat(source, candidate);
					cache.set(cacheKey, formatter);
				}
				const slots = Object.fromEntries(tags.map((tag) => [
					tag, (children: RichPart[]) => ({ tag, children })
				]));
				const value = formatter.format<Exclude<RichPart, string>>({ ...params, ...slots });
				const parts = Array.isArray(value) ? value : [value];
				if (parts.length && parts.some((part) => typeof part !== 'string' || part.trim())) {
					return parts.map((part) => typeof part === 'number' ? String(part) : part);
				}
			} catch {
				// A broken translation or missing parameter must never blank a safety message.
			}
		}
		return [readableId(id)];
	}

	function text(locale: string, id: string, params?: Params): string {
		const flatten = (parts: RichPart[]): string => parts.map((part) =>
			typeof part === 'string' ? part : flatten(part.children)
		).join('');
		return flatten(format(locale, id, params));
	}

	return { format, text };
}

export function readableId(id: string): string {
	return id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').trim() || 'Message';
}
