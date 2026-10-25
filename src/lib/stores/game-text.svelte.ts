import { loadLocalization } from '#lib/api/names.js';
import { setNameTable, getGameData } from './game-data.svelte.js';
import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';

type GameLanguage = keyof typeof GAME_TEXT_LOCALES;
let revision = 0;
let requestedLanguage = $state<GameLanguage>('english');
let loading = $state(false);
let error = $state(false);
let errorDetail = $state('');
let failedRequest = $state(0);

export function getGameTextState() {
	const data = getGameData();
	return {
		get requestedLanguage() { return requestedLanguage; },
		get effectiveLanguage() { return data.displayLanguage; },
		get effectiveLocale() { return GAME_TEXT_LOCALES[data.displayLanguage]; },
		get effectivePath() { return data.displayGamePath; },
		get loading() { return loading; },
		get error() { return error; },
		get errorDetail() { return errorDetail; },
		get failedRequest() { return failedRequest; }
	};
}

/** Display requests never touch the DSON identifier table or profile loading. */
export function requestGameText(gamePath: string, language: string): () => void {
	const request = ++revision;
	const requested = Object.hasOwn(GAME_TEXT_LOCALES, language) ? language as GameLanguage : 'english';
	requestedLanguage = requested;
	error = false;
	errorDetail = '';
	loading = Boolean(gamePath);
	if (gamePath) {
		loadLocalization(gamePath, requested).then((table) => {
			if (request !== revision) return;
			const nonempty = Object.fromEntries(Object.entries(table).filter(([, value]) => typeof value === 'string' && value.trim()));
			if (!Object.keys(nonempty).length) throw new Error('Empty game text table');
			setNameTable(nonempty, requested, gamePath);
		}).catch((cause: unknown) => {
			if (request !== revision) return;
			errorDetail = String(cause);
			failedRequest = request;
			error = true;
		}).finally(() => {
			if (request === revision) loading = false;
		});
	}
	return () => { if (request === revision) revision++; };
}
