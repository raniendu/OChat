import { describe, expect, test } from 'vitest';

import { getComposerPanel, isToolsPanelVisible, toggleToolsPanel } from '../src/composer-tools';

describe('composer tools panel', () => {
	test('shows tools while onboarding is required', () => {
		expect(isToolsPanelVisible({ toolsOpen: false, onboardingRequired: true })).toBe(true);
	});

	test('hides tools when setup is complete and the panel is closed', () => {
		expect(isToolsPanelVisible({ toolsOpen: false, onboardingRequired: false })).toBe(false);
	});

	test('shows tools when setup is complete and the panel is open', () => {
		expect(isToolsPanelVisible({ toolsOpen: true, onboardingRequired: false })).toBe(true);
	});

	test('toggles the tools panel state', () => {
		expect(toggleToolsPanel(false)).toBe(true);
		expect(toggleToolsPanel(true)).toBe(false);
	});

	test('routes onboarding when setup is required and no panel is explicitly open', () => {
		expect(getComposerPanel({ onboardingRequired: true, settingsOpen: false, contextOpen: false })).toBe('onboarding');
	});

	test('routes settings even when onboarding is required', () => {
		expect(getComposerPanel({ onboardingRequired: true, settingsOpen: true, contextOpen: false })).toBe('settings');
	});

	test('routes plus button state to context panel even when onboarding is required', () => {
		expect(getComposerPanel({ onboardingRequired: true, settingsOpen: false, contextOpen: true })).toBe('context');
	});

	test('routes settings independently from context tools', () => {
		expect(getComposerPanel({ onboardingRequired: false, settingsOpen: true, contextOpen: false })).toBe('settings');
	});

	test('routes plus button state to context panel', () => {
		expect(getComposerPanel({ onboardingRequired: false, settingsOpen: false, contextOpen: true })).toBe('context');
	});

	test('returns no panel when all panels are closed', () => {
		expect(getComposerPanel({ onboardingRequired: false, settingsOpen: false, contextOpen: false })).toBe(null);
	});
});
