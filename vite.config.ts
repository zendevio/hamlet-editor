import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// Pre-bundle modules reached only via dynamic import or the dev harness, so a
	// cold dev server does not discover them mid-test and reload the page.
	optimizeDeps: {
		include: [
			'@tauri-apps/api/mocks',
			'@tauri-apps/api/app',
			'@tauri-apps/api/window',
			'@tauri-apps/plugin-dialog',
			'@tauri-apps/plugin-store'
		]
	},
	// Lower JavaScript to Safari 15.4 (the oldest webview whose CSS layers can style
	// the UI), so newer syntax such as class static blocks cannot blank the window.
	// CSS keeps Vite's default target so the shipped styles are unchanged.
	build: {
		target: ['chrome111', 'edge111', 'firefox114', 'safari15.4', 'ios15.4'],
		cssTarget: ['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4']
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter({ fallback: 'index.html' })
		})
	]
});
