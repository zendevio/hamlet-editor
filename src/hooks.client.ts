import type { ClientInit } from '@sveltejs/kit/hooks';

export const init: ClientInit = async () => {
	// Temporary P1a seams. Remove when P1b adds persisted editor language settings.
	if (import.meta.env.DEV) {
		const params = new URL(window.location.href).searchParams;
		if (params.has('h1')) await (await import('#lib/dev/harness.js')).installHarness();
		const locale = params.get('editorLocale');
		if (locale) (await import('#lib/i18n/index.svelte.js')).setEditorLocale(locale);
	}
};
