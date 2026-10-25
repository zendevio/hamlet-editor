import type { MessageDescriptor } from '#lib/errors.js';

/** One save pipeline for toolbar, Save & Close, and pending profile/path changes. */
export interface SaveIssue {
	severity: 'error' | 'warning';
	fix?: () => void;
}
export type ValidationChoice = 'fix' | 'save' | 'cancel';
export type UnsavedChoice = 'save' | 'discard' | 'cancel';
export type RequestDataChange = (
	action: () => Promise<void>,
	preflight?: () => Promise<void>
) => Promise<boolean>;
export const DATA_CHANGE_CONTEXT = 'hamlet-request-data-change';

/** A confirmed close must not re-open the prompt when the UI re-renders. */
export function createWindowCloseGuard(hasChanges: () => boolean) {
	let confirmed = false;
	return {
		shouldConfirm: () => !confirmed && hasChanges(),
		async closeAfter(prepare: () => boolean | Promise<boolean>, close: () => Promise<void>) {
			if (!await prepare()) return false;
			confirmed = true;
			try {
				await close();
				return true;
			} catch (error) {
				confirmed = false;
				throw error;
			}
		}
	};
}

/** Shared by the layout's save pipeline and reload regression tests. */
export function profileSaveBlockReason(data: {
	isLoaded: boolean; isLoading: boolean; isStale: boolean; profilePath: string; gamePath: string;
}, settings: { savePath: string; gamePath: string }, state: {
	isProfileLoading: boolean; gameRunning: boolean; gameDetectionUncertain: boolean; hasChanges: boolean;
}): MessageDescriptor | null {
	if (!data.isLoaded || data.isLoading || state.isProfileLoading) return { id: 'error.profile_not_loaded' };
	if (data.profilePath !== settings.savePath || data.gamePath !== settings.gamePath) return { id: 'error.profile_paths_changed' };
	if (data.isStale) return { id: 'error.profile_stale' };
	if (state.gameRunning) return { id: 'error.save_game_running' };
	if (state.gameDetectionUncertain) return { id: 'error.game_detection_uncertain' };
	if (!state.hasChanges) return { id: 'error.save_no_changes' };
	return null;
}

/** Reload uses the same unsaved-change guard as profile and path switches. */
export function createProfileReload(options: {
	requestDataChange: RequestDataChange;
	profilePath: () => string;
	load: (path: string) => Promise<void>;
	failed: (error: unknown) => void;
}) {
	return () => options.requestDataChange(async () => {
		try { await options.load(options.profilePath()); }
		catch (error) { options.failed(error); }
	});
}

/** Unknown polls retain the last confirmed running state until a confirmed stop. */
export function createGameStoppedObserver(onStopped: () => void) {
	let wasRunning = false;
	return (status: { running: boolean; uncertain: boolean }) => {
		if (status.uncertain) return;
		if (wasRunning && !status.running) onStopped();
		wasRunning = status.running;
	};
}

export function createSaveWorkflow<T extends SaveIssue>(options: {
	blocked: () => MessageDescriptor | null;
	validate: () => T[];
	confirm: (issues: T[]) => Promise<ValidationChoice>;
	backup: () => Promise<void>;
	write: () => Promise<void>;
	saved: () => void;
	failed: (error: unknown) => void;
	busy: (value: boolean) => void;
}) {
	let active = false;
	return async (): Promise<boolean> => {
		if (active) return false;
		active = true;
		options.busy(true);
		try {
			const assertUnblocked = () => {
				const reason = options.blocked();
				if (reason) throw reason;
			};
			assertUnblocked();
			let issues = options.validate();
			while (issues.length > 0) {
				const choice = await options.confirm(issues);
				if (choice === 'cancel') return false;
				assertUnblocked();
				if (choice === 'save') {
					// Never allow an error to be bypassed, including errors added while the dialog was open.
					issues = options.validate();
					if (issues.some((issue) => issue.severity === 'error')) continue;
					break;
				}
				if (!issues.some((issue) => issue.fix)) return false;
				for (const issue of issues) issue.fix?.();
				issues = options.validate();
			}
			assertUnblocked();
			await options.backup();
			assertUnblocked();
			await options.write();
			options.saved();
			return true;
		} catch (error) {
			options.failed(error);
			return false;
		} finally {
			active = false;
			options.busy(false);
		}
	};
}

export function createUnsavedGuard(options: {
	hasChanges: () => boolean;
	choose: (canSave: boolean) => Promise<UnsavedChoice>;
	canSave?: () => boolean;
	save: () => Promise<boolean>;
	discard: () => void;
}): RequestDataChange {
	let active = false;
	return async (action, preflight) => {
		if (active) return false;
		active = true;
		try {
			if (options.hasChanges()) {
				const choice = await options.choose(options.canSave?.() ?? true);
				if (choice === 'cancel') return false;
				if (choice === 'save' && options.canSave?.() === false) return false;
				if (choice === 'save' && !await options.save()) return false;
				await preflight?.();
				if (choice === 'discard') options.discard();
			} else {
				await preflight?.();
			}
			await action();
			return true;
		} finally {
			active = false;
		}
	};
}
