import en from './catalogs/en.json' with { type: 'json' };
import de from './catalogs/de.json' with { type: 'json' };
import ru from './catalogs/ru.json' with { type: 'json' };
import ja from './catalogs/ja.json' with { type: 'json' };
import freshKeys from './fresh-keys.generated.json' with { type: 'json' };
import type { Catalog } from './core.js';

// The checker compares this map with every catalog file, including new locales.
export const catalogs: Readonly<Record<string, Catalog>> = { en, de, ru, ja };
/** The checker binds this generated key list to the exact review snapshots. */
export function currentCatalogs(input: Readonly<Record<string, Catalog>>, fresh: Readonly<Record<string, readonly string[]>>) {
	return Object.fromEntries(Object.entries(input).map(([locale, catalog]) => [locale, locale === 'en' ? catalog :
		Object.fromEntries(Object.entries(catalog).filter(([id]) => fresh[locale]?.includes(id)))]));
}

export const runtimeCatalogs = currentCatalogs(catalogs, freshKeys);
