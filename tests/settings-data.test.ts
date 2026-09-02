import { describe, expect, test } from 'vitest';

import { normalizeSettings } from '../src/settings-data';

describe('settings normalization', () => {
	test('defaults the API key secret reference to empty', () => {
		expect(normalizeSettings(null).apiKeySecretId).toBe('');
	});

	test('normalizes the selected API key secret reference', () => {
		expect(normalizeSettings({ apiKeySecretId: '  openai-personal  ' }).apiKeySecretId).toBe('openai-personal');
		expect(normalizeSettings({ apiKeySecretId: 42 as never }).apiKeySecretId).toBe('');
	});

	test('does not persist a raw API key from plugin data', () => {
		const settings = normalizeSettings({ apiKey: 'raw-secret-value' } as never) as unknown as Record<string, unknown>;

		expect(settings).not.toHaveProperty('apiKey');
	});

	test('defaults composer behavior to ask', () => {
		expect(normalizeSettings(null).composerMode).toBe('ask');
	});

	test('migrates legacy auto mode to ask', () => {
		expect(normalizeSettings({ composerMode: 'auto' as never }).composerMode).toBe('ask');
	});

	test('preserves explicit edit mode', () => {
		expect(normalizeSettings({ composerMode: 'edit' }).composerMode).toBe('edit');
	});
});
