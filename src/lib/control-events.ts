/** Ignore controlled-value echoes before calling a store mutation. */
export function commitChangedValue<T>(current: T, next: T, commit: (value: T) => void): boolean {
	if (Object.is(current, next)) return false;
	commit(next);
	return true;
}

/** Bits UI normalizes values on render. Only its user commit event may write. */
export function sliderControl(value: number, commit: (value: number) => void) {
	return {
		value,
		onValueCommit: (next: number) => { commitChangedValue(value, next, commit); }
	};
}

/** Class HP excludes buffs, so a saved value must always fit in the control. */
export function hpSliderMax(computedMax: number, currentHp: number): number {
	return Math.max(computedMax, currentHp, 1);
}
