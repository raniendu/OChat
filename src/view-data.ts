import type { ProviderKind } from './types';

export type ViewStatusKind = 'is-ready' | 'is-error' | 'is-busy';

export function getProviderLabel(provider: ProviderKind): string {
	return provider === 'ollama' ? 'Ollama' : 'OpenAI compatible';
}

export function getEndpointLabel(baseUrl: string): string {
	try {
		const endpoint = new URL(baseUrl);
		return endpoint.host || baseUrl;
	} catch {
		return baseUrl;
	}
}

export function getViewStatusKind(message: string): ViewStatusKind {
	const status = message.toLowerCase();
	if (status.includes('fail') || status.includes('error') || status.includes('invalid')) {
		return 'is-error';
	}
	if (status.startsWith('ready') || status.startsWith('success') || status.startsWith('applied')) {
		return 'is-ready';
	}
	return 'is-busy';
}
