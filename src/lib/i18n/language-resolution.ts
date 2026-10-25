import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';

export type GameLanguage = keyof typeof GAME_TEXT_LOCALES;
export type EditorLanguage = 'system' | GameLanguage;
export type GameTextMode = 'match-game' | 'same-as-editor' | 'explicit';
export type SourceStatus = 'ok' | 'absent' | 'unreadable' | 'timed_out';
export interface Evidence<T> { status: SourceStatus; value: T | null }
export interface GameOption { language: string | null; path_kind: string; verified: boolean }
export interface LanguageEvidence {
	os_locales: Evidence<string[]>;
	game_options: Evidence<GameOption>;
	steam_manifest: Evidence<string>;
}
export type LanguageSource = 'system' | 'game' | 'game-settings' | 'steam' | 'editor-fallback' | 'editor' | 'choice' | 'english' | 'startup-fallback';
export interface Resolution { language: GameLanguage; source: LanguageSource }
export const emptyEvidence = (): LanguageEvidence => ({
	os_locales: { status: 'absent', value: null },
	game_options: { status: 'absent', value: null },
	steam_manifest: { status: 'absent', value: null }
});
export function isGameLanguage(value: unknown): value is GameLanguage {
	return typeof value === 'string' && Object.hasOwn(GAME_TEXT_LOCALES, value);
}

/** Explicit scripts take precedence over region, including contradictory tags. */
export function osLanguage(raw: string): GameLanguage | undefined {
	const tag = raw.trim().split('.')[0].split('@')[0].replaceAll('_', '-').toLowerCase();
	if (!tag || tag === 'c' || tag === 'posix') return;
	const [primary, ...subtags] = tag.split('-');
	if (primary === 'zh') {
		const script = subtags.find((part) => /^[a-z]{4}$/.test(part));
		if (script) return script === 'hans' ? 'schinese' : undefined;
		const region = subtags.find((part) => /^[a-z]{2}$/.test(part) || /^\d{3}$/.test(part));
		return !region || ['cn', 'sg', 'my'].includes(region) ? 'schinese' : undefined;
	}
	return (Object.entries(GAME_TEXT_LOCALES).find(([, locale]) => locale.toLowerCase().split('-')[0] === primary)?.[0]) as GameLanguage | undefined;
}

function gameSignal(evidence: LanguageEvidence): Resolution | undefined {
	const options = evidence.game_options;
	if (options.status === 'ok' && isGameLanguage(options.value?.language)) {
		return { language: options.value.language, source: 'game-settings' };
	}
	const steam = evidence.steam_manifest;
	const language = steam.value === 'latam' ? 'spanish' : steam.value;
	if (steam.status === 'ok' && isGameLanguage(language)) return { language, source: 'steam' };
}
export function resolveEditor(choice: EditorLanguage, evidence: LanguageEvidence): Resolution {
	if (choice !== 'system') return { language: choice, source: 'choice' };
	if (evidence.os_locales.status === 'ok') {
		for (const locale of evidence.os_locales.value ?? []) {
			const language = osLanguage(locale);
			if (language) return { language, source: 'system' };
		}
	}
	const game = gameSignal(evidence);
	return game ? { language: game.language, source: 'game' } : { language: 'english', source: 'english' };
}
export function resolveGameText(mode: GameTextMode, explicit: GameLanguage | undefined, editor: GameLanguage, evidence: LanguageEvidence): Resolution {
	if (mode === 'explicit' && explicit) return { language: explicit, source: 'choice' };
	if (mode === 'same-as-editor') return { language: editor, source: 'editor' };
	return gameSignal(evidence) ?? { language: editor, source: 'editor-fallback' };
}

/** A path change invalidates earlier evidence; resolution always reads current choices. */
export function createDetectionSequence() {
	let sequence = 0;
	return {
		next: () => ++sequence,
		isCurrent: (request: number) => request === sequence,
		cancel: () => { sequence++; }
	};
}
