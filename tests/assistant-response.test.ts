import { describe, expect, test } from 'vitest';

import { parseAssistantResponse } from '../src/assistant-response';

describe('assistant response parsing', () => {
	test('separates think tags from visible Markdown', () => {
		expect(parseAssistantResponse('<think>Reviewing the note.</think>\n\n**Next step:** Book movers.')).toEqual({
			content: '**Next step:** Book movers.',
			thinking: 'Reviewing the note.'
		});
	});

	test('combines multiple thinking blocks and removes them from content', () => {
		expect(parseAssistantResponse('<think>A</think>\nAnswer\n<think>B</think>')).toEqual({
			content: 'Answer',
			thinking: 'A\n\nB'
		});
	});

	test('returns plain content when there is no thinking block', () => {
		expect(parseAssistantResponse('## Summary\n\n- Item')).toEqual({
			content: '## Summary\n\n- Item'
		});
	});
});
