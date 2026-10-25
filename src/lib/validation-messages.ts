import type { ValidationIssue } from '#lib/validation.js';
import { describeMessage, t } from '#lib/i18n/index.svelte.js';
import { heroClassName, buildingDisplayName, activityDisplayName } from '#lib/save-labels.js';
import { quirkName } from '#lib/data/quirks.js';

export function validationMessage(issue: ValidationIssue): ValidationIssue['message'] {
	const message = issue.message;
	switch (message.id) {
		case 'validation.gearRank':
			return { ...message, params: { ...message.params, heroClass: heroClassName(String(message.params.heroClass)) } };
		case 'validation.treatmentMismatch':
			return { ...message, params: { ...message.params, heroClass: heroClassName(String(message.params.heroClass)) } };
		case 'validation.missingHero':
			return { ...message, params: { ...message.params, building: buildingDisplayName(String(message.params.building)), activity: activityDisplayName(String(message.params.activity)) } };
		case 'validation.curseDlc':
			return { ...message, params: { ...message.params, name: message.params.name || t('heroes.unnamedHero'), quirkId: message.params.quirkId, quirk: quirkName(String(message.params.quirkId)) } };
		default: return message;
	}
}

export function describeValidationIssue(issue: ValidationIssue): string {
	return describeMessage(validationMessage(issue));
}
