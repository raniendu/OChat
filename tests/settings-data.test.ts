import { describe, expect, test } from 'vitest';

import { normalizeSettings } from '../src/settings-data';

describe('settings normalization', () => {
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
