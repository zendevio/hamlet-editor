import en from './catalogs/en.json';
import de from './catalogs/de.json';
import ru from './catalogs/ru.json';
import ja from './catalogs/ja.json';
import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';
import { createTranslator, type Params } from './core.js';
import type { MessageKey, MessageParams, MessageDescriptor } from './messages.generated.js';

export type { MessageKey, MessageParams, MessageDescriptor } from './messages.generated.js';
export type EditorLocale = (typeof GAME_TEXT_LOCALES)[keyof typeof GAME_TEXT_LOCALES];
const translator = createTranslator({ en, de, ru, ja });
let locale = $state<EditorLocale>('en');

export function getEditorLocale(): EditorLocale {
	return locale;
}

/** Session locale only. P1b owns persisted modes and detection. */
export function setEditorLocale(next: string): void {
	if (Object.values(GAME_TEXT_LOCALES).includes(next as EditorLocale)) locale = next as EditorLocale;
}

type Arguments<K extends MessageKey> = keyof MessageParams[K] extends never
	? [params?: never] : [params: MessageParams[K]];

export function t<K extends MessageKey>(id: K, ...args: Arguments<K>): string {
	return translator.text(locale, id, args[0] as Params | undefined);
}

export function describeMessage(descriptor: MessageDescriptor): string {
	return translator.text(locale, descriptor.id, descriptor.params);
}

export function richMessage<K extends MessageKey>(id: K, params: MessageParams[K]) {
	return translator.format(locale, id, params as Params);
}
