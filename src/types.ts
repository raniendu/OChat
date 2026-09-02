export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
	role: ChatRole;
	content: string;
	thinking?: string;
}

export interface ChatRequestOptions {
	baseUrl: string;
	model: string;
	messages: ChatMessage[];
	temperature: number;
}

export interface RequestDescriptor {
	url: string;
	method: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: unknown;
}

export interface NoteSource {
	path: string;
	content: string;
}

export interface VaultSnippet {
	path: string;
	snippet: string;
	score: number;
}

export interface PatchProposal {
	path: string;
	original: string;
	replacement: string;
	rationale: string;
}

export type PatchValidationResult =
	| { ok: true }
	| { ok: false; reason: string };

export type ProviderKind = 'ollama' | 'openai-compatible';
export type ComposerMode = 'edit' | 'ask';

export interface OChatSettings {
	provider: ProviderKind;
	baseUrl: string;
	apiKeySecretId: string;
	model: string;
	availableModels: string[];
	setupComplete: boolean;
	composerMode: ComposerMode;
	temperature: number;
	maxContextCharacters: number;
	maxVaultResults: number;
	excludedFolders: string[];
	reviewMode: boolean;
	remoteEndpointAcknowledged: boolean;
}

export interface EndpointClassification {
	kind: 'localhost' | 'private-lan' | 'public' | 'invalid';
	requiresAcknowledgement: boolean;
	reason: string;
}
