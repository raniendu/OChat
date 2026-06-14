import { describe, expect, test } from 'vitest';

import {
	extractContextMentions,
	findMarkdownPathMatches,
	resolveMentionedMarkdownPaths
} from '../src/context-mentions';

const paths = [
	'README.md',
	'Areas/Moving/00 Moving Dashboard.md',
	'Projects/Move Plan.md',
	'Projects/Package Notes.md',
	'Templates/Travel Template.md'
];

describe('context mentions', () => {
	test('extracts bare, quoted, and wiki-style @ mentions', () => {
		expect(
			extractContextMentions('Summarize @README.md with @"Projects/Move Plan.md" and @[[Areas/Moving/00 Moving Dashboard.md]]')
		).toEqual(['README.md', 'Projects/Move Plan.md', 'Areas/Moving/00 Moving Dashboard.md']);
	});

	test('resolves exact and fuzzy @ mentions to Markdown paths without duplicates', () => {
		expect(resolveMentionedMarkdownPaths('Use @README.md and @move and @[[README.md]]', paths)).toEqual([
			'README.md',
			'Projects/Move Plan.md',
			'Areas/Moving/00 Moving Dashboard.md'
		]);
	});

	test('finds picker suggestions by filename and path', () => {
		expect(findMarkdownPathMatches('pack', paths, 5)).toEqual(['Projects/Package Notes.md']);
		expect(findMarkdownPathMatches('moving', paths, 5)).toEqual(['Areas/Moving/00 Moving Dashboard.md']);
	});
});
