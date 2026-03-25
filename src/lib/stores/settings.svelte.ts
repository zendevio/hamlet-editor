/**
 * Settings store — persists game/save paths and profile selection.
 *
 * Uses Svelte 5 runes for reactive state. Persistence via tauri-plugin-store
 * will be wired in once the Rust backend is available.
 */

let gamePath = $state<string>('');
let savePath = $state<string>('');
let profileId = $state<string>('');
let isSetupComplete = $state(false);

export function getSettings() {
	return {
		get gamePath() {
			return gamePath;
		},
		get savePath() {
			return savePath;
		},
		get profileId() {
			return profileId;
		},
		get isSetupComplete() {
			return isSetupComplete;
		}
	};
}

export function setGamePath(path: string) {
	gamePath = path;
}

export function setSavePath(path: string) {
	savePath = path;
}

export function setProfileId(id: string) {
	profileId = id;
}

export function completeSetup() {
	isSetupComplete = true;
}

export function resetSetup() {
	gamePath = '';
	savePath = '';
	profileId = '';
	isSetupComplete = false;
}
