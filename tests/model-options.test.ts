import { describe, expect, test } from 'vitest';

import { getModelSelectOptions } from '../src/model-options';

describe('model select options', () => {
	test('uses discovered models for the dropdown', () => {
		expect(getModelSelectOptions('gemma4:12b-it-qat', ['qwen3.6:35b-a3b', 'gemma4:12b-it-qat'])).toEqual([
			{ value: 'qwen3.6:35b-a3b', label: 'qwen3.6:35b-a3b' },
			{ value: 'gemma4:12b-it-qat', label: 'gemma4:12b-it-qat' }
		]);
	});

	test('keeps the saved model as a dropdown option when discovery is stale', () => {
		expect(getModelSelectOptions('custom-model', ['qwen3.6:35b-a3b'])).toEqual([
			{ value: 'custom-model', label: 'custom-model (saved)' },
			{ value: 'qwen3.6:35b-a3b', label: 'qwen3.6:35b-a3b' }
		]);
	});

	test('still returns a dropdown option before models are discovered', () => {
		expect(getModelSelectOptions('llama3.2', [])).toEqual([{ value: 'llama3.2', label: 'llama3.2 (saved)' }]);
	});
});
