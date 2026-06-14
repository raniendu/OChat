import type { ChatMessage, NoteSource, VaultSnippet } from './types';

export interface ContextBundleInput {
	activeNote: NoteSource | null;
	selectedText: string;
	contextNotes?: NoteSource[];
	vaultSnippets: VaultSnippet[];
	maxContextCharacters: number;
}

export interface ContextBundle {
	messages: ChatMessage[];
	contextText: string;
}

const SYSTEM_PROMPT = [
	'You are OChat, a local-first Obsidian assistant.',
	'Use the supplied Markdown context when it is relevant.',
	'When asked to edit notes, respond with JSON containing a patches array.',
	'Each patch must include path, original, replacement, and rationale.'
].join(' ');

export function buildContextBundle(input: ContextBundleInput): ContextBundle {
	const sections: string[] = [];

	if (input.activeNote) {
		sections.push(formatSection(`Active note: ${input.activeNote.path}`, input.activeNote.content));
	}

	if (input.selectedText.trim().length > 0) {
		sections.push(formatSection('Selected text', input.selectedText));
	}

	for (const note of input.contextNotes ?? []) {
		sections.push(formatSection(`Context file: ${note.path}`, note.content));
	}

	if (input.vaultSnippets.length > 0) {
		for (const snippet of input.vaultSnippets) {
			sections.push(formatSection(`Vault match: ${snippet.path}`, snippet.snippet));
		}
	}

	const contextText = truncateText(sections.join('\n\n'), input.maxContextCharacters);

	return {
		contextText,
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: contextText }
		]
	};
}

export function buildUserMessage(question: string, contextText: string): ChatMessage {
	return {
		role: 'user',
		content: `${contextText}\n\nUser request:\n${question}`.trim()
	};
}

function formatSection(title: string, body: string): string {
	return `## ${title}\n${body.trim()}`;
}

function truncateText(text: string, maxCharacters: number): string {
	if (maxCharacters <= 0) {
		return '';
	}

	if (text.length <= maxCharacters) {
		return text;
	}

	if (maxCharacters <= 3) {
		return text.slice(0, maxCharacters);
	}

	return `${text.slice(0, maxCharacters - 3)}...`;
}
