export const GAME_TEXT_LANGUAGES: Record<string, string> = {
	english: 'English',
	french: 'Français',
	german: 'Deutsch',
	spanish: 'Español',
	italian: 'Italiano',
	brazilian: 'Português (Brasil)',
	polish: 'Polski',
	czech: 'Čeština',
	russian: 'Русский',
	schinese: '简体中文',
	japanese: '日本語',
	koreana: '한국어'
};

/** The only conversion between game language ids and BCP 47 tags. */
export const GAME_TEXT_LOCALES = {
	english: 'en', french: 'fr', german: 'de', spanish: 'es', italian: 'it',
	brazilian: 'pt-BR', polish: 'pl', czech: 'cs', russian: 'ru',
	schinese: 'zh-Hans', japanese: 'ja', koreana: 'ko'
} as const;
