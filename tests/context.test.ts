import { describe, expect, test } from 'vitest';

import { buildContextBundle } from '../src/context';
import { searchVaultSnippets } from '../src/search';
import type { NoteSource } from '../src/types';

const notes: NoteSource[] = [
	{
		path: 'Projects/Alpha.md',
		content: 'Alpha launch notes mention Ollama, local models, and private workflows.'
	},
	{
		path: 'Projects/Beta.md',
		content: 'Beta planning covers unrelated budgeting and timelines.'
	},
	{
		path: 'Archive/Alpha old.md',
		content: 'Archived Alpha notes should not be searched.'
	}
];

describe('vault search', () => {
	test('returns ranked Markdown snippets while respecting excluded folders', () => {
		const snippets = searchVaultSnippets(notes, 'Alpha local models', {
			excludedFolders: ['Archive'],
			maxResults: 2,
			maxSnippetCharacters: 80
		});

		expect(snippets).toHaveLength(1);
		expect(snippets[0]).toMatchObject({
			path: 'Projects/Alpha.md'
		});
		expect(snippets[0].snippet).toContain('local models');
	});
});

describe('context bundle', () => {
	test('includes active note, selected text, and capped vault snippets', () => {
		const bundle = buildContextBundle({
			activeNote: {
				path: 'Daily.md',
				content: 'Today I worked on OChat implementation details for a local Obsidian assistant.'
			},
			selectedText: 'selected implementation details',
			contextNotes: [],
			vaultSnippets: [
				{
					path: 'Projects/Alpha.md',
					snippet: 'Alpha launch notes mention Ollama, local models, and private workflows.',
					score: 4
				}
			],
			maxContextCharacters: 260
		});

		expect(bundle.messages[0].role).toBe('system');
		expect(bundle.messages[1].content).toContain('Daily.md');
		expect(bundle.messages[1].content).toContain('selected implementation details');
		expect(bundle.messages[1].content).toContain('Projects/Alpha.md');
		expect(bundle.messages[1].content.length).toBeLessThanOrEqual(260);
	});

	test('includes explicitly attached context files', () => {
		const bundle = buildContextBundle({
			activeNote: null,
			selectedText: '',
			contextNotes: [
				{
					path: 'Projects/Move Plan.md',
					content: 'Hire movers and reserve elevator.'
				}
			],
			vaultSnippets: [],
			maxContextCharacters: 500
		});

		expect(bundle.messages[1].content).toContain('Context file: Projects/Move Plan.md');
		expect(bundle.messages[1].content).toContain('Hire movers and reserve elevator.');
	});
});
