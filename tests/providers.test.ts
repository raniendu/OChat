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
import { classifyEndpoint } from '../src/providers/url-policy';
import type { ChatMessage } from '../src/types';

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
