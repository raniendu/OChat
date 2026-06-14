import { describe, expect, test } from 'vitest';

import { resolveSubmitMode } from '../src/modes';

describe('composer mode routing', () => {
	test('keeps ask mode as chat', () => {
		expect(resolveSubmitMode('ask', 'rewrite this note')).toBe('chat');
	});

	test('keeps edit mode as edit', () => {
		expect(resolveSubmitMode('edit', 'what is this note about?')).toBe('edit');
	});
});
