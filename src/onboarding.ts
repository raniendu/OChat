import type { OChatSettings } from './types';

export function isOnboardingRequired(settings: OChatSettings): boolean {
	return !settings.setupComplete || settings.model.trim().length === 0 || settings.availableModels.length === 0;
}

export function applyModelDiscovery(settings: OChatSettings, models: string[]): OChatSettings {
	const uniqueModels = [...new Set(models.map((model) => model.trim()).filter((model) => model.length > 0))];

	if (uniqueModels.length === 0) {
		return {
			...settings,
			availableModels: [],
			setupComplete: false
		};
	}

	return {
		...settings,
		availableModels: uniqueModels,
		model: uniqueModels.includes(settings.model) ? settings.model : uniqueModels[0],
		setupComplete: true
	};
}
