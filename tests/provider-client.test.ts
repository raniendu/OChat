import { describe, expect, test } from 'vitest';

import { createModelProvider } from '../src/providers/provider-client';
import type { RequestDescriptor } from '../src/types';

describe('model provider clients', () => {
	test('uses the injected executor for Ollama chat and model listing', async () => {
		const seen: RequestDescriptor[] = [];
		const provider = createModelProvider('ollama', async (request) => {
			seen.push(request);
			if (request.url.endsWith('/api/tags')) {
				return { models: [{ name: 'llama3.2' }] };
			}
			return { message: { role: 'assistant', content: 'Ollama answer' } };
		});

		await expect(
			provider.chat({
				baseUrl: 'http://localhost:11434',
				model: 'llama3.2',
				messages: [{ role: 'user', content: 'Hello' }],
				temperature: 0.3
			})
		).resolves.toBe('Ollama answer');
		await expect(provider.listModels('http://localhost:11434')).resolves.toEqual(['llama3.2']);
		expect(seen.map((request) => request.url)).toEqual([
			'http://localhost:11434/api/chat',
			'http://localhost:11434/api/tags'
		]);
	});

	test('uses the injected executor for OpenAI-compatible chat and model listing', async () => {
		const seen: RequestDescriptor[] = [];
		const provider = createModelProvider('openai-compatible', async (request) => {
			seen.push(request);
			if (request.url.endsWith('/models')) {
				return { data: [{ id: 'local-model' }] };
			}
			return { choices: [{ message: { role: 'assistant', content: 'Compatible answer' } }] };
		});

		await expect(
			provider.chat({
				baseUrl: 'http://localhost:1234/v1',
				model: 'local-model',
				messages: [{ role: 'user', content: 'Hello' }],
				temperature: 0.3
			})
		).resolves.toBe('Compatible answer');
		await expect(provider.listModels('http://localhost:1234/v1')).resolves.toEqual(['local-model']);
		expect(seen.map((request) => request.url)).toEqual([
			'http://localhost:1234/v1/chat/completions',
			'http://localhost:1234/v1/models'
		]);
	});
});
