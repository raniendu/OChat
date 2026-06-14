import { describe, expect, test } from 'vitest';

import { applyPatchProposals } from '../src/patch-applier';
import type { PatchProposal } from '../src/types';

const patch: PatchProposal = {
	path: 'Notes/Plan.md',
	original: 'old text',
	replacement: 'new text',
	rationale: 'Improve wording'
};

describe('patch applier', () => {
	test('holds valid patches when review mode is enabled and approval is missing', async () => {
		const writes: Array<{ path: string; content: string }> = [];

		const results = await applyPatchProposals([patch], {
			reviewMode: true,
			approved: false,
			readFile: async () => 'old text',
			writeFile: async (path, content) => {
				writes.push({ path, content });
			}
		});

		expect(results).toEqual([
			{
				path: 'Notes/Plan.md',
				status: 'pending-review',
				rationale: 'Improve wording'
			}
		]);
		expect(writes).toEqual([]);
	});

	test('applies valid patches when review mode is disabled', async () => {
		const writes: Array<{ path: string; content: string }> = [];

		const results = await applyPatchProposals([patch], {
			reviewMode: false,
			approved: false,
			readFile: async () => 'Before\nold text\nAfter',
			writeFile: async (path, content) => {
				writes.push({ path, content });
			}
		});

		expect(results).toEqual([
			{
				path: 'Notes/Plan.md',
				status: 'applied',
				rationale: 'Improve wording'
			}
		]);
		expect(writes).toEqual([{ path: 'Notes/Plan.md', content: 'Before\nnew text\nAfter' }]);
	});

	test('reports invalid patches without writing', async () => {
		const writes: Array<{ path: string; content: string }> = [];

		const results = await applyPatchProposals([{ ...patch, path: 'Notes/Plan.canvas' }], {
			reviewMode: false,
			approved: false,
			readFile: async () => 'old text',
			writeFile: async (path, content) => {
				writes.push({ path, content });
			}
		});

		expect(results).toEqual([
			{
				path: 'Notes/Plan.canvas',
				status: 'rejected',
				reason: 'Only Markdown files can be edited.',
				rationale: 'Improve wording'
			}
		]);
		expect(writes).toEqual([]);
	});
});
