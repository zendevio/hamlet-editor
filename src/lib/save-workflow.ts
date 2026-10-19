/** One save pipeline for toolbar, Save & Close, and pending profile/path changes. */
export interface SaveIssue {
	severity: 'error' | 'warning';
	fix?: () => void;
}
export type ValidationChoice = 'fix' | 'save' | 'cancel';
export type UnsavedChoice = 'save' | 'discard' | 'cancel';
export type RequestDataChange = (action: () => Promise<void>) => Promise<boolean>;
export const DATA_CHANGE_CONTEXT = 'hamlet-request-data-change';

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
	blocked: () => string | null;
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
				if (reason) throw new Error(reason);
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
	choose: () => Promise<UnsavedChoice>;
	save: () => Promise<boolean>;
	discard: () => void;
}): RequestDataChange {
	let active = false;
	return async (action) => {
		if (active) return false;
		active = true;
		try {
			if (options.hasChanges()) {
				const choice = await options.choose();
				if (choice === 'cancel') return false;
				if (choice === 'save' && !await options.save()) return false;
				if (choice === 'discard') options.discard();
			}
			await action();
			return true;
		} finally {
			active = false;
		}
	};
}
