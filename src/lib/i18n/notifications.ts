import { toast } from 'svelte-sonner';
import PersistentError from './PersistentError.svelte';
import type { MessageDescriptor } from './index.svelte.js';

/** Sonner mounts this component once; its text reads the locale during every render. */
export function showPersistentError(descriptor: MessageDescriptor, detail?: string, id?: string | number) {
	return toast.error(PersistentError, {
		id, componentProps: { descriptor, detail }, duration: Infinity, closeButton: true
	});
}
