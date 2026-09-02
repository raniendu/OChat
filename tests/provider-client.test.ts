import { describe, expect, test } from 'vitest';

import * as providerCommon from '../src/providers/common';
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

describe('authenticated model provider clients', () => {
	test('authenticates model discovery and chat for both provider protocols', async () => {
		const seen: RequestDescriptor[] = [];
		const execute = (request: RequestDescriptor) =>
			providerCommon.executeAuthenticatedRequest(
				request,
				'provider-key',
				() => 'test-token',
				async (authenticatedRequest) => {
					seen.push(authenticatedRequest);
					if (authenticatedRequest.url.endsWith('/api/tags')) {
						return { models: [{ name: 'llama3.2' }] };
					}
					if (authenticatedRequest.url.endsWith('/api/chat')) {
						return { message: { role: 'assistant', content: 'Ollama answer' } };
					}
					if (authenticatedRequest.url.endsWith('/models')) {
						return { data: [{ id: 'compatible-model' }] };
					}
					return { choices: [{ message: { role: 'assistant', content: 'Compatible answer' } }] };
				}
			);

		const ollama = createModelProvider('ollama', execute);
		await ollama.listModels('http://localhost:11434');
		await ollama.chat({
			baseUrl: 'http://localhost:11434',
			model: 'llama3.2',
			messages: [{ role: 'user', content: 'Hello' }],
			temperature: 0.2
		});

		const compatible = createModelProvider('openai-compatible', execute);
		await compatible.listModels('https://api.example.com/v1');
		await compatible.chat({
			baseUrl: 'https://api.example.com/v1',
			model: 'compatible-model',
			messages: [{ role: 'user', content: 'Hello' }],
			temperature: 0.2
		});

		expect(seen.map((request) => request.headers?.Authorization)).toEqual([
			'Bearer test-token',
			'Bearer test-token',
			'Bearer test-token',
			'Bearer test-token'
		]);
	});

	test('keeps the final request unauthenticated when no secret is selected', async () => {
		const request: RequestDescriptor = {
			url: 'http://192.168.1.10:11434/api/tags',
			method: 'GET'
		};

		const sentRequest = await providerCommon.executeAuthenticatedRequest(
			request,
			'',
			() => null,
			async (authenticatedRequest) => authenticatedRequest
		);

		expect(sentRequest).toEqual(request);
	});

	test('blocks bearer credentials over non-local plaintext HTTP', async () => {
		let sent = false;

		await expect(
			providerCommon.executeAuthenticatedRequest(
				{ url: 'http://192.168.1.10:11434/api/tags', method: 'GET' },
				'provider-key',
				() => 'test-token',
				async () => {
					sent = true;
					return {};
				}
			)
		).rejects.toThrow('API keys require HTTPS except for localhost.');
		expect(sent).toBe(false);
	});

	test('maps transport 401s using the selected-secret context', async () => {
		await expect(
			providerCommon.executeAuthenticatedRequest(
				{ url: 'https://api.example.com/v1/models', method: 'GET' },
				'',
				() => null,
				async () => {
					throw Object.assign(new Error('Unauthorized'), { status: 401 });
				}
			)
		).rejects.toThrow('Select an API key in OChat settings');

		await expect(
			providerCommon.executeAuthenticatedRequest(
				{ url: 'https://api.example.com/v1/models', method: 'GET' },
				'provider-key',
				() => 'wrong-token',
				async () => {
					throw Object.assign(new Error('Unauthorized'), { status: 401 });
				}
			)
		).rejects.toThrow('Check or replace the selected API key');
	});
});
