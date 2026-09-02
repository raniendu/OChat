import { describe, expect, test } from 'vitest';

import {
	buildOllamaChatRequest,
	parseOllamaChatResponse,
	parseOllamaModelList
} from '../src/providers/ollama';
import {
	buildOpenAICompatibleChatRequest,
	parseOpenAICompatibleChatResponse,
	parseOpenAICompatibleModelList
} from '../src/providers/openai-compatible';
import * as providerCommon from '../src/providers/common';
import { classifyEndpoint } from '../src/providers/url-policy';
import type { ChatMessage, RequestDescriptor } from '../src/types';

const messages: ChatMessage[] = [
	{ role: 'system', content: 'Use Markdown.' },
	{ role: 'user', content: 'Summarize this note.' }
];

describe('provider request parsing', () => {
	test('builds non-streaming Ollama chat requests', () => {
		const request = buildOllamaChatRequest({
			baseUrl: 'http://localhost:11434',
			model: 'llama3.2',
			messages,
			temperature: 0.2
		});

		expect(request.url).toBe('http://localhost:11434/api/chat');
		expect(request.method).toBe('POST');
		expect(request.body).toEqual({
			model: 'llama3.2',
			messages,
			stream: false,
			options: { temperature: 0.2 }
		});
	});

	test('parses Ollama chat and model responses', () => {
		expect(parseOllamaChatResponse({ message: { role: 'assistant', content: 'Done' } })).toBe('Done');
		expect(parseOllamaModelList({ models: [{ name: 'llama3.2' }, { name: 'qwen2.5:7b' }] })).toEqual([
			'llama3.2',
			'qwen2.5:7b'
		]);
	});

	test('builds non-streaming OpenAI-compatible chat requests', () => {
		const request = buildOpenAICompatibleChatRequest({
			baseUrl: 'http://localhost:1234/v1',
			model: 'local-model',
			messages,
			temperature: 0.1
		});

		expect(request.url).toBe('http://localhost:1234/v1/chat/completions');
		expect(request.method).toBe('POST');
		expect(request.body).toEqual({
			model: 'local-model',
			messages,
			stream: false,
			temperature: 0.1
		});
	});

	test('parses OpenAI-compatible chat and model responses', () => {
		expect(
			parseOpenAICompatibleChatResponse({
				choices: [{ message: { role: 'assistant', content: 'Answer' } }]
			})
		).toBe('Answer');
		expect(parseOpenAICompatibleModelList({ data: [{ id: 'model-a' }, { id: 'model-b' }] })).toEqual([
			'model-a',
			'model-b'
		]);
	});
});

describe('endpoint classification', () => {
	test('accepts localhost and private LAN endpoints without acknowledgement', () => {
		expect(classifyEndpoint('http://localhost:11434')).toMatchObject({
			kind: 'localhost',
			requiresAcknowledgement: false
		});
		expect(classifyEndpoint('http://192.168.1.10:11434')).toMatchObject({
			kind: 'private-lan',
			requiresAcknowledgement: false
		});
	});

	test('requires acknowledgement for public endpoints', () => {
		expect(classifyEndpoint('https://api.example.com')).toMatchObject({
			kind: 'public',
			requiresAcknowledgement: true
		});
	});
});

describe('provider authentication', () => {
	test('adds bearer authentication without dropping existing request headers', () => {
		const request: RequestDescriptor = {
			url: 'https://api.example.com/v1/chat/completions',
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: { model: 'example' }
		};

		expect(providerCommon.withBearerToken(request, 'test-token')).toEqual({
			...request,
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-token'
			}
		});
	});

	test('leaves requests unauthenticated when no token is configured', () => {
		const request: RequestDescriptor = {
			url: 'http://localhost:11434/api/tags',
			method: 'GET'
		};

		expect(providerCommon.withBearerToken(request, '   ')).toEqual(request);
	});

	test('does not read secret storage when no API key secret is selected', () => {
		let reads = 0;
		const token = providerCommon.resolveApiKeySecret('   ', () => {
			reads += 1;
			return 'unused';
		});

		expect(token).toBeNull();
		expect(reads).toBe(0);
	});

	test('resolves the selected secret to its bearer token', () => {
		let requestedSecretId = '';
		const token = providerCommon.resolveApiKeySecret('  openai-personal  ', (secretId) => {
			requestedSecretId = secretId;
			return '  test-token  ';
		});

		expect(requestedSecretId).toBe('openai-personal');
		expect(token).toBe('test-token');
	});

	test('explains how to recover when the selected secret is unavailable', () => {
		expect(() => providerCommon.resolveApiKeySecret('missing-key', () => null)).toThrow(
			'API key secret "missing-key" was not found. Choose another secret in OChat settings.'
		);
	});

	test('turns unauthorized responses into actionable authentication errors', () => {
		expect(providerCommon.normalizeProviderRequestError({ status: 401 }, false).message).toBe(
			'Authentication failed (401). Select an API key in OChat settings and try again.'
		);
		expect(providerCommon.normalizeProviderRequestError(new Error('Request failed, status 401'), true).message).toBe(
			'Authentication failed (401). Check or replace the selected API key in OChat settings.'
		);
	});

	test('preserves non-authentication request errors', () => {
		const error = new Error('Network unavailable');
		expect(providerCommon.normalizeProviderRequestError(error, false)).toBe(error);
	});
});
