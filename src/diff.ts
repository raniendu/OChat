export type DiffLineKind = 'context' | 'add' | 'del';

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
}

export interface DiffStats {
	added: number;
	removed: number;
}

/**
 * Builds a line-oriented diff between the two halves of a patch proposal.
 * Common leading and trailing lines are collapsed to `contextLines` on each
 * side so a review card shows the change rather than the whole block.
 */
export function buildUnifiedDiff(original: string, replacement: string, contextLines = 2): DiffLine[] {
	if (original === replacement) {
		return [];
	}

	const before = original.split('\n');
	const after = replacement.split('\n');

	let prefix = 0;
	while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
		prefix++;
	}

	let suffix = 0;
	while (
		suffix < before.length - prefix &&
		suffix < after.length - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	) {
		suffix++;
	}

	const lines: DiffLine[] = [];
	const removed = before.slice(prefix, before.length - suffix);
	const added = after.slice(prefix, after.length - suffix);

	for (const text of before.slice(Math.max(0, prefix - contextLines), prefix)) {
		lines.push({ kind: 'context', text });
	}

	for (const text of removed) {
		lines.push({ kind: 'del', text });
	}

	for (const text of added) {
		lines.push({ kind: 'add', text });
	}

	const trailingStart = before.length - suffix;
	for (const text of before.slice(trailingStart, trailingStart + contextLines)) {
		lines.push({ kind: 'context', text });
	}

	return lines;
}

export function summarizeDiff(lines: DiffLine[]): DiffStats {
	return {
		added: lines.filter((line) => line.kind === 'add').length,
		removed: lines.filter((line) => line.kind === 'del').length
	};
}
