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

function stepFactor(step: number): number {
	const text = step.toString();
	const precision = Math.floor(step) === step ? 0
		: text.includes('e-') ? parseInt(text.split('e-')[1], 10)
			: (text.split('.')[1]?.length ?? 0);
	return 10 ** precision;
}

/** Keep both endpoints on the step grid used to render and move the thumb. */
export function alignedSliderRange({ min, max, step }: SliderRange): SliderRange {
	const factor = stepFactor(step);
	const scaledStep = Math.round(step * factor);
	return {
		min: Math.floor(min * factor / scaledStep) * scaledStep / factor,
		max: Math.ceil(max * factor / scaledStep) * scaledStep / factor,
		step
	};
}

/** Match Bits UI 2.19.5 normalizeSteps and snapValueToCustomSteps, including lower ties. */
function snappedSliderValue(value: number, { min, max, step }: SliderRange): number {
	const factor = stepFactor(step);
	let count = Math.ceil((max - min) / step);
	if (Math.round((max - min) * factor) % Math.round(step * factor) === 0) count++;
	if (count <= 0) return value;
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

/** Display fractional save values and limits consistently. */
export function sliderNumberLabel(value: number): string {
	return !Number.isFinite(value) || Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Never label the current value with a step above the real maximum. */
export function sliderValueLabel(value: number, range: SliderRange): string {
	const snapped = snappedSliderValue(value, alignedSliderRange(range));
	if (snapped > range.max || snapped < range.min) return sliderNumberLabel(value);
	return snapped === value ? String(snapped) : `${snapped} (saved: ${sliderNumberLabel(value)})`;
}

/** Preserve saved fractions when a click or drag finishes on the starting step. */
export function sliderControl(value: number, range: SliderRange, commit: (value: number) => void) {
	const snapped = snappedSliderValue(value, alignedSliderRange(range));
	const factor = stepFactor(range.step);
	const scaledStep = Math.round(range.step * factor);
	const minStep = Math.ceil(range.min * factor / scaledStep) * scaledStep / factor;
	const maxStep = Math.floor(range.max * factor / scaledStep) * scaledStep / factor;
	const boundedStep = (next: number) => Math.min(maxStep, Math.max(minStep, next));
	let stored = value;
	let shown = snapped;
	let pointerStart: number | undefined;
	return {
		value,
		restoreValue: () => {
			shown = boundedStep(snappedSliderValue(stored, alignedSliderRange(range)));
			return shown;
		},
		...alignedSliderRange(range),
		// Bits maps pointers over the full track, so rendering must use that scale too.
		thumbPositioning: 'exact' as const,
		onValueChange: (next: number) => { shown = next; },
		onpointerdowncapture: (event: PointerEvent) => {
			if (event.button === 0) pointerStart = shown;
		},
		onkeydowncapture: () => { pointerStart = undefined; },
		onValueCommit: (next: number) => {
			const start = pointerStart;
			pointerStart = undefined;
			if (!Number.isFinite(next) || minStep > maxStep) return;
			const adjusted = boundedStep(next);
			// Compare on the same valid grid even when the shown start lies outside it.
			if (adjusted === boundedStep(snapped) || (start !== undefined && adjusted === boundedStep(start))) return;
			if (commitChangedValue(stored, adjusted, commit)) stored = adjusted;
		}
	};
}

/** Class HP excludes buffs, so a saved value must always fit in the control. */
export function hpSliderMax(computedMax: number, currentHp: number, savedHp = currentHp): number {
	return Math.max(computedMax, savedHp, currentHp, 1);
}
