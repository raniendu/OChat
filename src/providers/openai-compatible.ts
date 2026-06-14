import { getJson, joinUrl, postJson } from './common';
import type { ChatRequestOptions, RequestDescriptor } from '../types';

interface OpenAICompatibleChatResponse {
	choices?: Array<{
		message?: {
			role?: string;
			content?: string | null;
		};
	}>;
}

interface OpenAICompatibleModelResponse {
	data?: Array<{
		id?: string;
	}>;
}

export function buildOpenAICompatibleChatRequest(options: ChatRequestOptions): RequestDescriptor {
	return postJson(joinUrl(options.baseUrl, '/chat/completions'), {
		model: options.model,
		messages: options.messages,
		stream: false,
		temperature: options.temperature
	});
}

export function buildOpenAICompatibleModelsRequest(baseUrl: string): RequestDescriptor {
	return getJson(joinUrl(baseUrl, '/models'));
}

export function parseOpenAICompatibleChatResponse(response: unknown): string {
	const typed = response as OpenAICompatibleChatResponse;
	const content = typed.choices?.[0]?.message?.content;

	if (typeof content !== 'string') {
		throw new Error('OpenAI-compatible response did not include assistant content.');
	}

	return content;
}

export function parseOpenAICompatibleModelList(response: unknown): string[] {
	const typed = response as OpenAICompatibleModelResponse;

	if (!Array.isArray(typed.data)) {
		return [];
	}

	return typed.data
		.map((model) => model.id)
		.filter((id): id is string => typeof id === 'string' && id.length > 0);
}
