/** Snapshot reactive save objects before cloning their complete item metadata. */
export function cloneSaveItem<T>(item: T): T {
	return structuredClone($state.snapshot(item)) as T;
}
