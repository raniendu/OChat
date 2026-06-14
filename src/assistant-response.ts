export interface ParsedAssistantResponse {
	content: string;
	thinking?: string;
}

export function parseAssistantResponse(response: string): ParsedAssistantResponse {
	const thinkingBlocks: string[] = [];
	const content = response
		.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, thinking: string) => {
			const trimmed = thinking.trim();
			if (trimmed.length > 0) {
				thinkingBlocks.push(trimmed);
			}
			return '';
		})
		.trim();

	return {
		content,
		...(thinkingBlocks.length > 0 ? { thinking: thinkingBlocks.join('\n\n') } : {})
	};
}
