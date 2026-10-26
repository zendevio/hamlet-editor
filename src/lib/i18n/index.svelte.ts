import { formatNumber } from './intl.js';
import { runtimeCatalogs as catalogs } from './catalogs.js';
import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';
import { createTranslator, type Params } from './core.js';
import type { MessageKey, MessageParams, MessageDescriptor } from './messages.generated.js';

export type { MessageKey, MessageParams, MessageDescriptor } from './messages.generated.js';
export type EditorLocale = (typeof GAME_TEXT_LOCALES)[keyof typeof GAME_TEXT_LOCALES];
let translator = $state.raw(createTranslator(catalogs));
if (import.meta.env.DEV && typeof window !== 'undefined') {
	void import('../dev/catalog-override.js').then(({ registerCatalogOverride }) => {
		registerCatalogOverride((catalog) => { translator = createTranslator(catalog ? { en: catalog } : catalogs); });
	});
}
let locale = $state<EditorLocale>('en');

export function getEditorLocale(): EditorLocale {
	return locale;
}

/** Internal catalog state. Settings owns persisted choices and resolution. */
export function setEditorLocale(next: string): void {
	if (Object.values(GAME_TEXT_LOCALES).includes(next as EditorLocale)) locale = next as EditorLocale;
}

type Arguments<K extends MessageKey> = keyof MessageParams[K] extends never
	? [params?: never] : [params: MessageParams[K]];

export function t<K extends MessageKey>(id: K, ...args: Arguments<K>): string {
	return translator.text(locale, id, args[0] as Params | undefined);
}

/** Format locale-sensitive slots in the catalog locale, including per-key fallback. */
export function tWithLocaleParams<K extends MessageKey>(id: K, params: (locale: string) => MessageParams[K]): string {
	return translator.text(locale, id, (candidate) => params(candidate) as Params);
}

function displayParams(params: Params = {}): Params {
	return Object.fromEntries(Object.entries(params).map(([key, value]) =>
		[key, key.endsWith('Text') && typeof value === 'number' ? formatNumber(value) : value]));
}

export function describeMessage(descriptor: MessageDescriptor): string {
	return translator.text(locale, descriptor.id, displayParams(descriptor.params));
}

export function richMessage<K extends MessageKey>(id: K, params: MessageParams[K]) {
	return translator.format(locale, id, displayParams(params as Params));
}
