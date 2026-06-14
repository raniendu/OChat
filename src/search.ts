import type { NoteSource, VaultSnippet } from './types';

export interface VaultSearchOptions {
	excludedFolders: string[];
	maxResults: number;
	maxSnippetCharacters: number;
}

export function searchVaultSnippets(
	notes: NoteSource[],
	query: string,
	options: VaultSearchOptions
): VaultSnippet[] {
	const terms = tokenize(query);

	if (terms.length === 0 || options.maxResults <= 0) {
		return [];
	}

	return notes
		.filter((note) => note.path.toLowerCase().endsWith('.md'))
		.filter((note) => !isExcluded(note.path, options.excludedFolders))
		.map((note) => scoreNote(note, terms, options.maxSnippetCharacters))
		.filter((snippet): snippet is VaultSnippet => snippet !== null)
		.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
		.slice(0, options.maxResults);
}

function scoreNote(note: NoteSource, terms: string[], maxSnippetCharacters: number): VaultSnippet | null {
	const haystack = `${note.path}\n${note.content}`.toLowerCase();
	let score = 0;
	let firstIndex = -1;

	for (const term of terms) {
		const pathMatches = countOccurrences(note.path.toLowerCase(), term);
		const contentMatches = countOccurrences(note.content.toLowerCase(), term);

		if (pathMatches + contentMatches > 0 && firstIndex === -1) {
			firstIndex = Math.max(0, note.content.toLowerCase().indexOf(term));
		}

		score += pathMatches * 3 + contentMatches;
	}

	if (score === 0 || !haystack) {
		return null;
	}

	return {
		path: note.path,
		snippet: makeSnippet(note.content, firstIndex, maxSnippetCharacters),
		score
	};
}

function tokenize(input: string): string[] {
	return [...new Set(input.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? [])];
}

function countOccurrences(input: string, term: string): number {
	let count = 0;
	let index = input.indexOf(term);

	while (index !== -1) {
		count++;
		index = input.indexOf(term, index + term.length);
	}

	return count;
}

function isExcluded(path: string, excludedFolders: string[]): boolean {
	return excludedFolders.some((folder) => {
		const normalized = folder.trim().replace(/^\/+|\/+$/g, '');
		return normalized.length > 0 && (path === normalized || path.startsWith(`${normalized}/`));
	});
}

function makeSnippet(content: string, firstIndex: number, maxCharacters: number): string {
	const normalized = content.replace(/\s+/g, ' ').trim();

	if (normalized.length <= maxCharacters) {
		return normalized;
	}

	const start = Math.max(0, firstIndex - Math.floor(maxCharacters / 3));
	const snippet = normalized.slice(start, start + maxCharacters);
	const prefix = start > 0 ? '...' : '';
	const suffix = start + maxCharacters < normalized.length ? '...' : '';

	return `${prefix}${snippet}${suffix}`.slice(0, maxCharacters);
}
