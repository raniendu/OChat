import { describe, expect, test, vi } from 'vitest';

import type { App, Setting, SettingDefinition, SettingDefinitionItem, SettingGroup } from 'obsidian';
import type OChatPlugin from '../src/main';
import { createOChatSettingDefinitions } from '../src/settings-definitions';
import { normalizeSettings } from '../src/settings-data';

describe('OChat settings definitions', () => {
	test('exposes every setting through searchable declarative groups', () => {
		const app = { vault: { configDir: 'custom-config' } } as unknown as App;
		const plugin = {
			settings: normalizeSettings(null)
		} as unknown as OChatPlugin;

		const groups: SettingDefinitionItem[] = createOChatSettingDefinitions({
			app,
			plugin,
			refreshDomState: () => undefined,
			renderSecret: () => undefined
		});

		const summaries = groups.flatMap((definition) =>
			'type' in definition && definition.type === 'group'
				? [{ heading: definition.heading, items: definition.items?.map((item) => item.name) }]
				: []
		);

		expect(summaries).toEqual([
			{
				heading: 'Connection',
				items: ['Provider', 'Base URL', 'API key', 'Acknowledge remote endpoint', 'Model', 'Temperature']
			},
			{
				heading: 'Context',
				items: ['Maximum context characters', 'Maximum vault results', 'Excluded folders']
			},
			{
				heading: 'Editing',
				items: ['Review mode']
			}
		]);
	});

	test('refreshes endpoint visibility without rebuilding the settings tree while typing', async () => {
		const app = { vault: { configDir: 'custom-config' } } as unknown as App;
		const refreshDomState = vi.fn();
		const settings = normalizeSettings(null);
		const updateBaseUrl = vi.fn(async (value: string) => {
			settings.baseUrl = value;
		});
		const plugin = {
			settings,
			updateBaseUrl
		} as unknown as OChatPlugin;

		const definitions = createOChatSettingDefinitions({
			app,
			plugin,
			refreshDomState,
			renderSecret: () => undefined
		});
		const baseUrl = findSettingDefinition(definitions, 'Base URL');
		const acknowledgement = findSettingDefinition(definitions, 'Acknowledge remote endpoint');
		let onChange: ((value: string) => Promise<void>) | undefined;
		const text = {
			setValue: vi.fn().mockReturnThis(),
			onChange: vi.fn((callback: (value: string) => Promise<void>) => {
				onChange = callback;
				return text;
			})
		};
		const setting = {
			addText: vi.fn((render: (component: typeof text) => void) => {
				render(text);
				return setting;
			})
		} as unknown as Setting;

		expect(typeof baseUrl.render).toBe('function');
		baseUrl.render?.(setting, {} as SettingGroup);
		expect(onChange).toBeTypeOf('function');

		await onChange?.('https://models.example.com');

		expect(updateBaseUrl).toHaveBeenCalledWith('https://models.example.com');
		expect(refreshDomState).toHaveBeenCalledOnce();
		expect(acknowledgement.visible).toBeTypeOf('function');
		if (typeof acknowledgement.visible === 'function') {
			expect(acknowledgement.visible()).toBe(true);
		}
	});
});

function findSettingDefinition(items: SettingDefinitionItem[], name: string): SettingDefinition {
	for (const item of items) {
		if ('type' in item && (item.type === 'group' || item.type === 'list')) {
			const definition = item.items?.find((candidate) => candidate.name === name);
			if (definition && !('type' in definition)) {
				return definition;
			}
		} else if (!('type' in item) && item.name === name) {
			return item;
		}
	}

	throw new Error(`Missing setting definition: ${name}`);
}
