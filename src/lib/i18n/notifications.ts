import { toast } from 'svelte-sonner';
import PersistentError from './PersistentError.svelte';
import type { MessageDescriptor } from './index.svelte.js';
import { decodeError } from '#lib/errors.js';

let recoverySequence = 0;
let showSequence = 0;
const dismissibleIds = new Map<string | number, Set<string>>();
// Sonner keeps a dismissed toast in its list while it animates out, so reusing
// its id would update it in its old slot. Each showing gets a fresh id instead;
// this maps the dedupe key to the id currently on screen.
const shownIds = new Map<string, string>();

/** Replaces an identical earlier notice with a new one at the front of the stack. */
function freshId(key: string) {
	const previous = shownIds.get(key);
	if (previous !== undefined) toast.dismiss(previous);
	const id = `${key}#${++showSequence}`;
	shownIds.set(key, id);
	return id;
}

function notificationId(error: unknown, descriptor?: MessageDescriptor, id?: string | number) {
	const decoded = decodeError(error);
	const operation = id ?? descriptor?.id ?? 'error.unexpected';
	const params: Readonly<Record<string, unknown>>[] = [decoded.params, descriptor?.params ?? {}];
	// Recovery locations belong to this failure, even if the next attempt is identical.
	if (params.some((values) => ['recoveryPath', 'backupPath', 'copy'].some((key) =>
		typeof values[key] === 'string' && values[key].trim()))) {
		return `recovery:${++recoverySequence}`;
	}
	const toastId = JSON.stringify([operation, decoded.code,
		...params.map((values) => Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))]);
	if (id !== undefined) {
		const ids = dismissibleIds.get(id) ?? new Set<string>();
		ids.add(toastId);
		dismissibleIds.set(id, ids);
	}
	return toastId;
}

/** Resolved background failures may close; recovery notices require dismissal by the user. */
export function dismissError(id: string | number) {
	for (const key of dismissibleIds.get(id) ?? []) {
		const shown = shownIds.get(key);
		if (shown !== undefined) toast.dismiss(shown);
		shownIds.delete(key);
	}
	dismissibleIds.delete(id);
}

/** Sonner mounts this component once; its text reads the locale during every render. */
export function showPersistentError(descriptor: MessageDescriptor, detail?: string, id?: string | number) {
	const toastId = freshId(notificationId(undefined, descriptor, id));
	return toast.error(PersistentError, {
		id: toastId, componentProps: { descriptor, detail }, duration: Infinity, closeButton: true
	});
}

/** Typed rejection stays untranslated inside the mounted toast. */
export function showError(error: unknown, descriptor?: MessageDescriptor, id?: string | number) {
	const toastId = freshId(notificationId(error, descriptor, id));
	return toast.error(PersistentError, {
		id: toastId,
		componentProps: { descriptor, error, hasError: true }, duration: Infinity, closeButton: true
	});
}
