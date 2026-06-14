import { describe, expect, test } from 'vitest';

import { applyModelDiscovery, isOnboardingRequired } from '../src/onboarding';
import { normalizeSettings } from '../src/settings-data';

describe('onboarding model discovery', () => {
	test('requires onboarding for fresh settings', () => {
		const settings = normalizeSettings(null);

		expect(isOnboardingRequired(settings)).toBe(true);
	});

	test('selects the first discovered model when current model is unavailable', () => {
		const settings = normalizeSettings({
			model: 'missing-model',
			setupComplete: false,
			availableModels: []
		});

		const updated = applyModelDiscovery(settings, ['qwen3.6:35b-a3b', 'gemma4:12b-it-qat']);

		expect(updated.model).toBe('qwen3.6:35b-a3b');
		expect(updated.availableModels).toEqual(['qwen3.6:35b-a3b', 'gemma4:12b-it-qat']);
		expect(updated.setupComplete).toBe(true);
		expect(isOnboardingRequired(updated)).toBe(false);
	});

	test('preserves the selected model when it is still available', () => {
		const settings = normalizeSettings({
			model: 'gemma4:12b-it-qat',
			setupComplete: true,
			availableModels: ['gemma4:12b-it-qat']
		});

		const updated = applyModelDiscovery(settings, ['qwen3.6:35b-a3b', 'gemma4:12b-it-qat']);

		expect(updated.model).toBe('gemma4:12b-it-qat');
		expect(updated.setupComplete).toBe(true);
	});

	test('keeps setup incomplete when no models are discovered', () => {
		const settings = normalizeSettings({
			model: 'llama3.2',
			setupComplete: false,
			availableModels: []
		});

		const updated = applyModelDiscovery(settings, []);

		expect(updated.model).toBe('llama3.2');
		expect(updated.availableModels).toEqual([]);
		expect(updated.setupComplete).toBe(false);
		expect(isOnboardingRequired(updated)).toBe(true);
	});
});
