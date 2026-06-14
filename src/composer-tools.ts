export interface ToolsPanelState {
	toolsOpen: boolean;
	onboardingRequired: boolean;
}

export interface ComposerPanelState {
	onboardingRequired: boolean;
	settingsOpen: boolean;
	contextOpen: boolean;
}

export type ComposerPanel = 'onboarding' | 'settings' | 'context' | null;

export function isToolsPanelVisible(state: ToolsPanelState): boolean {
	return state.onboardingRequired || state.toolsOpen;
}

export function toggleToolsPanel(current: boolean): boolean {
	return !current;
}

export function getComposerPanel(state: ComposerPanelState): ComposerPanel {
	if (state.settingsOpen) {
		return 'settings';
	}

	if (state.contextOpen) {
		return 'context';
	}

	if (state.onboardingRequired) {
		return 'onboarding';
	}

	return null;
}
