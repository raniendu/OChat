import { describe, expect, test } from 'vitest';

import type { App, SettingDefinitionItem } from 'obsidian';
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
			update: () => undefined,
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
});
