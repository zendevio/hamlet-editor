import type { SaveLocation } from '#lib/api/detect.js';

/** Keep a manually selected or currently loaded profile visible after detection. */
export function withCurrentProfile(
	locations: SaveLocation[],
	path: string,
	profileId: string,
	hasActiveRaid: boolean
): SaveLocation[] {
	if (!path || locations.some((location) => location.path === path)) return locations;
	return [
		...locations,
		{
			path,
			profile_id: profileId || path.split(/[\\/]/).filter(Boolean).at(-1) || 'Current profile',
			source: 'Manual',
			steam_user_id: null,
			has_active_raid: hasActiveRaid
		}
	];
}
