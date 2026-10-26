import en from '#lib/i18n/catalogs/en.json';
import { pseudoCatalog } from './pseudo-locale.js';

type Catalog = Readonly<Record<string, string>>;
let apply: ((catalog: Catalog | null) => void) | undefined;
let ready: () => void;
const registered = new Promise<void>((resolve) => { ready = resolve; });

export function registerCatalogOverride(callback: (catalog: Catalog | null) => void) {
	apply = callback;
	ready();
}

/** This module is reachable only through the dev-gated H1 import. */
export async function usePseudoLocale(enabled: boolean) {
	await registered;
	apply!(enabled ? pseudoCatalog(en) : null);
}
