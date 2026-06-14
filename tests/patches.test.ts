import { describe, expect, test } from 'vitest';

import {
	applyPatchToContent,
	parsePatchProposals,
	validatePatchProposal
} from '../src/patches';

describe('patch proposals', () => {
	test('parses patch JSON from plain or fenced model output', () => {
		const plain = parsePatchProposals(
			'{"patches":[{"path":"Note.md","original":"old","replacement":"new","rationale":"cleanup"}]}'
		);
		const fenced = parsePatchProposals(
			'```json\n{"patches":[{"path":"Note.md","original":"old","replacement":"new","rationale":"cleanup"}]}\n```'
		);

		expect(plain[0]).toEqual({
			path: 'Note.md',
			original: 'old',
			replacement: 'new',
			rationale: 'cleanup'
		});
		expect(fenced).toEqual(plain);
	});

	test('applies a valid Markdown patch with an exact single match', () => {
		const patch = {
			path: 'Folder/Note.md',
			original: 'old paragraph',
			replacement: 'new paragraph',
			rationale: 'clarify'
		};
		const currentContent = 'Title\n\nold paragraph\n';

		expect(validatePatchProposal(patch, currentContent)).toEqual({ ok: true });
		expect(applyPatchToContent(patch, currentContent)).toBe('Title\n\nnew paragraph\n');
	});

	test('rejects non-Markdown, missing, and ambiguous patch targets', () => {
		const basePatch = {
			path: 'Note.md',
			original: 'target',
			replacement: 'replacement',
			rationale: 'test'
		};

		expect(validatePatchProposal({ ...basePatch, path: 'canvas.json' }, 'target')).toMatchObject({
			ok: false,
			reason: 'Only Markdown files can be edited.'
		});
		expect(validatePatchProposal(basePatch, 'missing')).toMatchObject({
			ok: false,
			reason: 'Original text was not found.'
		});
		expect(validatePatchProposal(basePatch, 'target and target')).toMatchObject({
			ok: false,
			reason: 'Original text matched more than once.'
		});
	});
});
