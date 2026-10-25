import type { ClientInit } from '@sveltejs/kit/hooks';

export const init: ClientInit = async () => {
	// The mounted harness is installed before settings bootstrap imports any state.
	if (import.meta.env.DEV) {
		const params = new URL(window.location.href).searchParams;
		if (params.has('h1')) await (await import('#lib/dev/harness.js')).installHarness();
	}
};
