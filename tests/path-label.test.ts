import { describe, expect, test } from 'vitest';

import { splitPathLabel } from '../src/path-label';

describe('path labels', () => {
	test('splits a nested path into folder and file name', () => {
		expect(splitPathLabel('Work/Projects/Q3 planning.md')).toEqual({
			folder: 'Work/Projects/',
			name: 'Q3 planning.md'
		});
	});

	test('leaves a vault root file without a folder', () => {
		expect(splitPathLabel('README.md')).toEqual({ folder: '', name: 'README.md' });
	});

	test('ignores surrounding whitespace', () => {
		expect(splitPathLabel('  Work/Note.md  ')).toEqual({ folder: 'Work/', name: 'Note.md' });
	});
});
