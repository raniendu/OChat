import {
	buildOllamaChatRequest,
	buildOllamaModelsRequest,
	parseOllamaChatResponse,
	parseOllamaModelList
} from './ollama';
import {
	buildOpenAICompatibleChatRequest,
	buildOpenAICompatibleModelsRequest,
	parseOpenAICompatibleChatResponse,
	parseOpenAICompatibleModelList
} from './openai-compatible';
import type { ChatRequestOptions, ProviderKind, RequestDescriptor } from '../types';

export type RequestExecutor = (request: RequestDescriptor) => Promise<unknown>;

export interface ModelProvider {
	chat(options: ChatRequestOptions): Promise<string>;
	listModels(baseUrl: string): Promise<string[]>;
}

export function createModelProvider(kind: ProviderKind, execute: RequestExecutor): ModelProvider {
	if (kind === 'ollama') {
		return {
			async chat(options) {
				return parseOllamaChatResponse(await execute(buildOllamaChatRequest(options)));
			},
			async listModels(baseUrl) {
				return parseOllamaModelList(await execute(buildOllamaModelsRequest(baseUrl)));
			}
		};
	}

	return {
		async chat(options) {
			return parseOpenAICompatibleChatResponse(await execute(buildOpenAICompatibleChatRequest(options)));
		},
		async listModels(baseUrl) {
			return parseOpenAICompatibleModelList(await execute(buildOpenAICompatibleModelsRequest(baseUrl)));
		}
	};
}
