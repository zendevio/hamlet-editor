import type { RestoreCheck } from '#lib/api/backup.js';
import type { RequestDataChange } from '#lib/save-workflow.js';

export function restoreOutcome(check: RestoreCheck | null): string {
	if (!check) return '';
	const parts = [
		check.adds ? `adds ${check.adds} file${check.adds === 1 ? '' : 's'}` : '',
		check.removes ? `removes ${check.removes} file${check.removes === 1 ? '' : 's'}` : ''
	].filter(Boolean);
	return parts.length ? `This restore ${parts.join(' and ')}.` : 'This restore is overwrite-only.';
}

/** Recheck after the unsaved choice, before the guard can discard any edits. */
export async function runRestore(options: {
	check: () => Promise<RestoreCheck>;
	checked: (check: RestoreCheck) => void;
	blocked: () => void;
	requestDataChange: RequestDataChange;
	restore: () => Promise<void>;
	reload: () => Promise<void>;
}): Promise<boolean> {
	const refused = Symbol('restore blocked');
	const preflight = async () => {
		const check = await options.check();
		options.checked(check);
		if (check.blocked_reason) {
			options.blocked();
			throw refused;
		}
	};
	try {
		await preflight();
		return await options.requestDataChange(async () => {
			await options.restore();
			await options.reload();
		}, preflight);
	} catch (error) {
		if (error === refused) return false;
		throw error;
	}
}
