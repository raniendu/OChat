import type { OChatSettings } from './types';

export const DEFAULT_SETTINGS: OChatSettings = {
	provider: 'ollama',
	baseUrl: 'http://localhost:11434',
	model: 'llama3.2',
	availableModels: [],
	setupComplete: false,
	composerMode: 'ask',
	temperature: 0.2,
	maxContextCharacters: 12000,
	maxVaultResults: 5,
	excludedFolders: [],
	reviewMode: true,
	remoteEndpointAcknowledged: false
};

export function normalizeSettings(data: Partial<OChatSettings> | null | undefined): OChatSettings {
	const settings = {
		...DEFAULT_SETTINGS,
		...(data ?? {})
	};

	return {
		...settings,
		provider: settings.provider === 'openai-compatible' ? 'openai-compatible' : 'ollama',
		model:
			typeof settings.model === 'string' && settings.model.trim().length > 0
				? settings.model.trim()
				: DEFAULT_SETTINGS.model,
		availableModels: Array.isArray(settings.availableModels)
			? settings.availableModels.filter((model) => typeof model === 'string' && model.trim().length > 0)
			: DEFAULT_SETTINGS.availableModels,
		setupComplete: settings.setupComplete === true,
		composerMode: settings.composerMode === 'edit' ? 'edit' : 'ask',
		temperature: clampNumber(settings.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
		maxContextCharacters: clampNumber(
			settings.maxContextCharacters,
			1000,
			100000,
			DEFAULT_SETTINGS.maxContextCharacters
		),
		maxVaultResults: clampNumber(settings.maxVaultResults, 0, 20, DEFAULT_SETTINGS.maxVaultResults),
		excludedFolders: Array.isArray(settings.excludedFolders)
			? settings.excludedFolders.filter((folder) => typeof folder === 'string')
			: DEFAULT_SETTINGS.excludedFolders
	};
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}

	return Math.max(min, Math.min(max, value));
}
