export interface PromptKeyEvent {
	key: string;
	shiftKey: boolean;
	isComposing: boolean;
}

export function shouldSubmitPromptKey(event: PromptKeyEvent): boolean {
	return event.key === 'Enter' && !event.shiftKey && !event.isComposing;
}
