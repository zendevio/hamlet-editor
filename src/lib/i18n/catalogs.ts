import fr from './catalogs/fr.json' with { type: 'json' };
import es from './catalogs/es.json' with { type: 'json' };
import it from './catalogs/it.json' with { type: 'json' };
import ptBR from './catalogs/pt-BR.json' with { type: 'json' };
import pl from './catalogs/pl.json' with { type: 'json' };
import cs from './catalogs/cs.json' with { type: 'json' };
import zhHans from './catalogs/zh-Hans.json' with { type: 'json' };
import ko from './catalogs/ko.json' with { type: 'json' };
import en from './catalogs/en.json' with { type: 'json' };
import de from './catalogs/de.json' with { type: 'json' };
import ru from './catalogs/ru.json' with { type: 'json' };
import ja from './catalogs/ja.json' with { type: 'json' };
import freshKeys from './fresh-keys.generated.json' with { type: 'json' };
import type { Catalog } from './core.js';

// The checker compares this map with every catalog file, including new locales.
export const catalogs: Readonly<Record<string, Catalog>> = { en, de, ru, ja, fr, es, it, 'pt-BR': ptBR, pl, cs, 'zh-Hans': zhHans, ko };
/** The checker binds this generated key list to the exact review snapshots. */
export function currentCatalogs(input: Readonly<Record<string, Catalog>>, fresh: Readonly<Record<string, readonly string[]>>) {
	return Object.fromEntries(Object.entries(input).map(([locale, catalog]) => [locale, locale === 'en' ? catalog :
		Object.fromEntries(Object.entries(catalog).filter(([id]) => fresh[locale]?.includes(id)))]));
}

export const runtimeCatalogs = currentCatalogs(catalogs, freshKeys);
