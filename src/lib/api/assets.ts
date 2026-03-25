/**
 * Tauri command wrappers for game asset loading.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Load a raw game asset from the installation directory and return it as a
 * data URL suitable for use as an `<img>` src.
 *
 * @param gamePath      - The resolved game data root path (from detectGameInstallations).
 * @param relativePath  - Forward-slash path relative to the data root,
 *                        e.g. "heroes/crusader/skins/default/crusader.icon.png".
 * @returns A `data:image/...;base64,…` URL, or an empty string on any error.
 */
export async function loadGameAsset(gamePath: string, relativePath: string): Promise<string> {
	try {
		const bytes = await invoke<number[]>('load_game_asset', {
			gamePath,
			assetRelativePath: relativePath
		});

		const uint8 = new Uint8Array(bytes);
		const binary = uint8.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
		const base64 = btoa(binary);
		const mimeType = guessMimeType(relativePath);

		return `data:${mimeType};base64,${base64}`;
	} catch {
		return '';
	}
}

/** Infer a MIME type from the file extension for the data URL header. */
function guessMimeType(path: string): string {
	const lower = path.toLowerCase();
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.gif')) return 'image/gif';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.svg')) return 'image/svg+xml';
	return 'application/octet-stream';
}
