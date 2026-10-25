import en from './catalogs/en.json';
import de from './catalogs/de.json';
import ru from './catalogs/ru.json';
import ja from './catalogs/ja.json';
import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';
import { createTranslator, type Params } from './core.js';
import type { MessageKey, MessageParams, MessageDescriptor } from './messages.generated.js';
import { describeError } from '#lib/errors.js';

export type { MessageKey, MessageParams, MessageDescriptor } from './messages.generated.js';
export type EditorLocale = (typeof GAME_TEXT_LOCALES)[keyof typeof GAME_TEXT_LOCALES];
const translator = createTranslator({ en, de, ru, ja });
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

export function describeMessage(descriptor: MessageDescriptor): string {
	return translator.text(locale, descriptor.id, descriptor.params);
}

export function richMessage<K extends MessageKey>(id: K, params: MessageParams[K]) {
	return translator.format(locale, id, params as Params);
}

/** Compatibility for logic owned by later slices that still returns English. */
export type ActionMessage = string | MessageDescriptor;
export function describeActionMessage(message: ActionMessage): string {
	if (typeof message === 'string') return message;
	if (message && typeof message === 'object' && 'id' in message && typeof message.id === 'string') {
		return describeMessage(message);
	}
	const error = describeError(message);
	return [describeMessage(error.message), error.detail, ...error.recovery.map(describeMessage)].filter(Boolean).join('\n');
}
