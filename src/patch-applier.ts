import { applyPatchToContent, validatePatchProposal } from './patches';
import type { PatchProposal } from './types';

export interface PatchApplicationOptions {
	reviewMode: boolean;
	approved: boolean;
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
}

export type PatchApplicationResult =
	| { path: string; status: 'pending-review'; rationale: string }
	| { path: string; status: 'applied'; rationale: string }
	| { path: string; status: 'rejected'; reason: string; rationale: string };

export async function applyPatchProposals(
	patches: PatchProposal[],
	options: PatchApplicationOptions
): Promise<PatchApplicationResult[]> {
	const results: PatchApplicationResult[] = [];

	for (const patch of patches) {
		const currentContent = await options.readFile(patch.path);
		const validation = validatePatchProposal(patch, currentContent);

		if (!validation.ok) {
			results.push({
				path: patch.path,
				status: 'rejected',
				reason: validation.reason,
				rationale: patch.rationale
			});
			continue;
		}

		if (options.reviewMode && !options.approved) {
			results.push({
				path: patch.path,
				status: 'pending-review',
				rationale: patch.rationale
			});
			continue;
		}

		await options.writeFile(patch.path, applyPatchToContent(patch, currentContent));
		results.push({
			path: patch.path,
			status: 'applied',
			rationale: patch.rationale
		});
	}

	return results;
}
