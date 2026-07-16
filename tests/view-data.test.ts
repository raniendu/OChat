import { describe, expect, test } from 'vitest';

import { getEndpointLabel, getProviderLabel, getViewStatusKind } from '../src/view-data';

describe('view labels', () => {
	test('uses compact provider and endpoint labels', () => {
		expect(getProviderLabel('ollama')).toBe('Ollama');
		expect(getProviderLabel('openai-compatible')).toBe('OpenAI compatible');
		expect(getEndpointLabel('http://localhost:11434')).toBe('localhost:11434');
	});

	test('preserves invalid endpoints so the user can diagnose them', () => {
		expect(getEndpointLabel('not a url')).toBe('not a url');
	});

	test('maps status copy to visible semantic states', () => {
		expect(getViewStatusKind('Ready')).toBe('is-ready');
		expect(getViewStatusKind('Success. Found 2 models.')).toBe('is-ready');
		expect(getViewStatusKind('Failed. Connection refused.')).toBe('is-error');
		expect(getViewStatusKind('Waiting for model...')).toBe('is-busy');
	});
});
