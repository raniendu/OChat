import { describe, expect, test } from 'vitest';

import { shouldSubmitPromptKey } from '../src/keyboard';

describe('composer keyboard behavior', () => {
	test('submits on plain Enter', () => {
		expect(shouldSubmitPromptKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true);
	});

	test('keeps Shift+Enter available for multiline prompts', () => {
		expect(shouldSubmitPromptKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false);
	});

	test('does not submit while IME composition is active', () => {
		expect(shouldSubmitPromptKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
	});

	test('ignores non-Enter keys', () => {
		expect(shouldSubmitPromptKey({ key: 'a', shiftKey: false, isComposing: false })).toBe(false);
	});
});
