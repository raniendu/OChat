import type { PatchProposal, PatchValidationResult } from './types';

export function parsePatchProposals(output: string): PatchProposal[] {
	const jsonText = stripJsonFence(output.trim());

	try {
		const parsed = JSON.parse(jsonText) as { patches?: unknown };

		if (!Array.isArray(parsed.patches)) {
			return [];
		}

		return parsed.patches.filter(isPatchProposal);
	} catch {
		return [];
	}
}

export function validatePatchProposal(
	patch: PatchProposal,
	currentContent: string
): PatchValidationResult {
	if (!patch.path.toLowerCase().endsWith('.md')) {
		return { ok: false, reason: 'Only Markdown files can be edited.' };
	}

	if (patch.original.length === 0) {
		return { ok: false, reason: 'Original text must not be empty.' };
	}

	const matches = countExactMatches(currentContent, patch.original);

	if (matches === 0) {
		return { ok: false, reason: 'Original text was not found.' };
	}

	if (matches > 1) {
		return { ok: false, reason: 'Original text matched more than once.' };
	}

	return { ok: true };
}

/**
 * Swaps the two halves of a patch so an applied edit can be walked back
 * through the same validation path that applied it.
 */
export function invertPatchProposal(patch: PatchProposal): PatchProposal {
	return {
		path: patch.path,
		original: patch.replacement,
		replacement: patch.original,
		rationale: `Undo: ${patch.rationale}`
	};
}

export function applyPatchToContent(patch: PatchProposal, currentContent: string): string {
	const validation = validatePatchProposal(patch, currentContent);

	if (!validation.ok) {
		throw new Error(validation.reason);
	}

	return currentContent.replace(patch.original, patch.replacement);
}

function stripJsonFence(output: string): string {
	const fenced = output.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fenced ? fenced[1].trim() : output;
}

function isPatchProposal(value: unknown): value is PatchProposal {
	const candidate = value as PatchProposal;

	return (
		typeof candidate?.path === 'string' &&
		typeof candidate.original === 'string' &&
		typeof candidate.replacement === 'string' &&
		typeof candidate.rationale === 'string'
	);
}

function countExactMatches(content: string, needle: string): number {
	let count = 0;
	let index = content.indexOf(needle);

	while (index !== -1) {
		count++;
		index = content.indexOf(needle, index + needle.length);
	}

	return count;
}
