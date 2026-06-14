import type { ComposerMode } from './types';

export type SubmitMode = 'chat' | 'edit';

export function resolveSubmitMode(mode: ComposerMode, _prompt: string): SubmitMode {
	if (mode === 'ask') {
		return 'chat';
	}

	return 'edit';
}
