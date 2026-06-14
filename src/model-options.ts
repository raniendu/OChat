export interface ModelSelectOption {
	value: string;
	label: string;
}

export function getModelSelectOptions(currentModel: string, availableModels: string[]): ModelSelectOption[] {
	const current = currentModel.trim();
	const discovered = [...new Set(availableModels.map((model) => model.trim()).filter((model) => model.length > 0))];
	const options = discovered.map((model) => ({
		value: model,
		label: model
	}));

	if (current.length > 0 && !discovered.includes(current)) {
		return [{ value: current, label: `${current} (saved)` }, ...options];
	}

	return options;
}
