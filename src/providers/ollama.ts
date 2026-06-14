import { getJson, joinUrl, postJson } from './common';
import type { ChatRequestOptions, RequestDescriptor } from '../types';

interface OllamaChatResponse {
	message?: {
		role?: string;
		content?: string;
	};
}

interface OllamaModelResponse {
	models?: Array<{
		name?: string;
	}>;
}

export function buildOllamaChatRequest(options: ChatRequestOptions): RequestDescriptor {
	return postJson(joinUrl(options.baseUrl, '/api/chat'), {
		model: options.model,
		messages: options.messages,
		stream: false,
		options: {
			temperature: options.temperature
		}
	});
}

export function buildOllamaModelsRequest(baseUrl: string): RequestDescriptor {
	return getJson(joinUrl(baseUrl, '/api/tags'));
}

export function parseOllamaChatResponse(response: unknown): string {
	const typed = response as OllamaChatResponse;
	const content = typed.message?.content;

	if (typeof content !== 'string') {
		throw new Error('Ollama response did not include assistant content.');
	}

	return content;
}

export function parseOllamaModelList(response: unknown): string[] {
	const typed = response as OllamaModelResponse;

	if (!Array.isArray(typed.models)) {
		return [];
	}

	return typed.models
		.map((model) => model.name)
		.filter((name): name is string => typeof name === 'string' && name.length > 0);
}
