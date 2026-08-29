import { describe, expect, test } from 'vitest';

import { buildUnifiedDiff, summarizeDiff } from '../src/diff';

describe('unified diff', () => {
	test('marks replaced lines as removed then added', () => {
		const lines = buildUnifiedDiff('- Migration might slip.', '- Migration slips past the vendor renewal.');

		expect(lines).toEqual([
			{ kind: 'del', text: '- Migration might slip.' },
			{ kind: 'add', text: '- Migration slips past the vendor renewal.' }
		]);
	});

	test('keeps unchanged lines around the change as context', () => {
		const original = ['## Risks', '', 'old line', '', 'tail'].join('\n');
		const replacement = ['## Risks', '', 'new line', '', 'tail'].join('\n');

		expect(buildUnifiedDiff(original, replacement)).toEqual([
			{ kind: 'context', text: '## Risks' },
			{ kind: 'context', text: '' },
			{ kind: 'del', text: 'old line' },
			{ kind: 'add', text: 'new line' },
			{ kind: 'context', text: '' },
			{ kind: 'context', text: 'tail' }
		]);
	});

	test('trims context to the requested number of lines', () => {
		const original = ['a', 'b', 'c', 'd', 'old'].join('\n');
		const replacement = ['a', 'b', 'c', 'd', 'new'].join('\n');

		expect(buildUnifiedDiff(original, replacement, 1)).toEqual([
			{ kind: 'context', text: 'd' },
			{ kind: 'del', text: 'old' },
			{ kind: 'add', text: 'new' }
		]);
	});

	test('reports a pure insertion with no removed lines', () => {
		const lines = buildUnifiedDiff('one\ntwo', 'one\nextra\ntwo');

		expect(lines.filter((line) => line.kind === 'del')).toEqual([]);
		expect(lines.filter((line) => line.kind === 'add')).toEqual([{ kind: 'add', text: 'extra' }]);
	});

	test('returns nothing when the halves are identical', () => {
		expect(buildUnifiedDiff('same', 'same')).toEqual([]);
	});

	test('counts added and removed lines', () => {
		const stats = summarizeDiff(buildUnifiedDiff('a\nb', 'a\nc\nd'));

		expect(stats).toEqual({ added: 2, removed: 1 });
	});
});
