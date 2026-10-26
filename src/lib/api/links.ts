import { invoke } from '@tauri-apps/api/core';

export type ProjectLink = 'repository' | 'issues';

/** Open a fixed project page in the system browser; the webview never navigates away. */
export async function openProjectLink(link: ProjectLink): Promise<void> {
	await invoke<void>('open_project_link', { link });
}
