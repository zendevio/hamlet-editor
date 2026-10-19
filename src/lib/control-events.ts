/** Ignore controlled-value echoes before calling a store mutation. */
export function commitChangedValue<T>(current: T, next: T, commit: (value: T) => void): boolean {
	if (Object.is(current, next)) return false;
	commit(next);
	return true;
}

interface SliderRange {
	min: number;
	max: number;
	step: number;
}

/** Match Bits UI 2.19.5 normalizeSteps and snapValueToCustomSteps, including lower ties. */
function snappedSliderValue(value: number, { min, max, step }: SliderRange): number {
	const text = step.toString();
	const precision = Math.floor(step) === step ? 0
		: text.includes('e-') ? parseInt(text.split('e-')[1], 10)
			: (text.split('.')[1]?.length ?? 0);
	const factor = 10 ** precision;
	let count = Math.ceil((max - min) / step);
	if (Math.round((max - min) * factor) % Math.round(step * factor) === 0) count++;
	if (count === 0) return value;
	let closest = Math.round(min * factor) / factor;
	let distance = Math.abs(value - closest);
	for (let i = 0; i < count; i++) {
		const candidate = Math.round((min + i * step) * factor) / factor;
		const nextDistance = Math.abs(value - candidate);
		if (nextDistance < distance) {
			closest = candidate;
			distance = nextDistance;
		}
	}
	return closest;
}

/** Show the thumb's step and retain the exact saved value as a visible hint. */
export function sliderValueLabel(value: number, range: SliderRange): string {
	const snapped = snappedSliderValue(value, range);
	return snapped === value ? String(snapped) : `${snapped} (saved: ${value})`;
}

/** Preserve saved fractions when a click or drag finishes on the starting step. */
export function sliderControl(value: number, range: SliderRange, commit: (value: number) => void) {
	const snapped = snappedSliderValue(value, range);
	return {
		value,
		...range,
		onValueCommit: (next: number) => {
			if (!Number.isFinite(next) || next === snapped) return;
			commitChangedValue(value, Math.min(range.max, Math.max(range.min, next)), commit);
		}
	};
}

/** Class HP excludes buffs, so a saved value must always fit in the control. */
export function hpSliderMax(computedMax: number, currentHp: number, savedHp = currentHp): number {
	return Math.max(computedMax, savedHp, currentHp, 1);
}
