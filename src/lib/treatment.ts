import { TREATMENT_BUILDINGS, type TreatmentBuildingName } from '#lib/data/constants.js';
import type { TownActivity, TownBuildingSlot, TownData } from '#lib/types/save-data.js';

export interface TreatmentSlot {
	buildingName: TreatmentBuildingName;
	activityType: string;
	slotIndex: string;
	slot: TownBuildingSlot;
	activity: TownActivity;
}

/** Numeric keys are slots; nested quirk_treatment holds separate slot metadata. */
export function readTreatmentSlots(
	town: TownData | null,
	buildingName?: TreatmentBuildingName
): TreatmentSlot[] {
	const result: TreatmentSlot[] = [];
	for (const building of buildingName ? [buildingName] : TREATMENT_BUILDINGS) {
		const activities = town?.base_root.buildings[building]?.activities ?? {};
		for (const [activityType, activity] of Object.entries(activities)) {
			for (const [slotIndex, value] of Object.entries(activity)) {
				if (!/^\d+$/.test(slotIndex) || typeof value !== 'object' || value === null) continue;
				if (!('hero' in value) || typeof value.hero !== 'number') continue;
				result.push({
					buildingName: building,
					activityType,
					slotIndex,
					slot: value as TownBuildingSlot,
					activity
				});
			}
		}
	}
	return result;
}

/** Cancel the visit, preserving NPC occupancy and unrelated slot metadata. */
export function clearTreatmentSlot({ slot, activity, slotIndex }: TreatmentSlot) {
	slot.hero = 0;
	slot.visitsRemaining = 0;
	slot.is_side_effect_result = false;
	const treatments = activity.quirk_treatment?.[slotIndex];
	for (const treatment of Object.values(treatments ?? {})) {
		treatment.quirk_treatment = '';
		treatment.quirk_treatment_action = 0;
	}
}
