import type { App, Setting, SettingDefinitionItem } from 'obsidian';
import type OChatPlugin from './main';
import { getModelSelectOptions } from './model-options';
import { classifyEndpoint } from './providers/url-policy';
import type { ProviderKind } from './types';

export interface OChatSettingDefinitionContext {
	app: App;
	plugin: OChatPlugin;
	refreshDomState: () => void;
	renderSecret: (setting: Setting) => void;
}

export function createOChatSettingDefinitions(context: OChatSettingDefinitionContext): SettingDefinitionItem[] {
	const { app, plugin, refreshDomState, renderSecret } = context;

	return [
		{
			type: 'group',
			heading: 'Connection',
			items: [
				{
					name: 'Provider',
					desc: 'Choose the local model API shape.',
					render: (setting) => {
						setting.addDropdown((dropdown) => {
							dropdown
								.addOption('ollama', 'Ollama')
								.addOption('openai-compatible', 'OpenAI-compatible')
								.setValue(plugin.settings.provider)
								.onChange(async (value) => {
									plugin.settings.provider = value as ProviderKind;
									await plugin.saveSettings();
								});
						});
					}
				},
				{
					name: 'Base URL',
					desc: 'Use localhost or a private network address unless you intentionally trust a remote endpoint.',
					render: (setting) => {
						setting.addText((text) => {
							text.setValue(plugin.settings.baseUrl).onChange(async (value) => {
								await plugin.updateBaseUrl(value);
								refreshDomState();
							});
						});
					}
				},
				{
					name: 'API key',
					desc: 'Optional. Select an Obsidian secret to send as a bearer token. HTTPS is required except for localhost.',
					render: renderSecret
				},
				{
					name: 'Acknowledge remote endpoint',
					desc: 'Required before sending note or vault context to a public endpoint.',
					visible: () => classifyEndpoint(plugin.settings.baseUrl).requiresAcknowledgement,
					render: (setting) => {
						setting.addToggle((toggle) => {
							toggle.setValue(plugin.settings.remoteEndpointAcknowledged).onChange(async (value) => {
								plugin.settings.remoteEndpointAcknowledged = value;
								await plugin.saveSettings();
							});
						});
					}
				},
				{
					name: 'Model',
					desc: 'Model name to use for chat and edit requests.',
					render: (setting) => {
						setting.addDropdown((dropdown) => {
							for (const option of getModelSelectOptions(plugin.settings.model, plugin.settings.availableModels)) {
								dropdown.addOption(option.value, option.label);
							}
							dropdown.setValue(plugin.settings.model).onChange(async (value) => {
								await plugin.selectModel(value);
							});
						});
					}
				},
				{
					name: 'Temperature',
					desc: 'Lower values are more deterministic.',
					render: (setting) => {
						setting.addSlider((slider) => {
							slider
								.setLimits(0, 2, 0.1)
								.setValue(plugin.settings.temperature)
								.onChange(async (value) => {
									plugin.settings.temperature = value;
									await plugin.saveSettings();
								});
						});
					}
				}
			]
		},
		{
			type: 'group',
			heading: 'Context',
			items: [
				{
					name: 'Maximum context characters',
					desc: 'Caps active note and vault snippets sent to the model.',
					render: (setting) => {
						setting.addText((text) => {
							text.setValue(String(plugin.settings.maxContextCharacters)).onChange(async (value) => {
								const parsed = Number(value);
								if (Number.isFinite(parsed)) {
									plugin.settings.maxContextCharacters = Math.round(parsed);
									await plugin.saveSettings();
								}
							});
						});
					}
				},
				{
					name: 'Maximum vault results',
					desc: 'Number of lexical vault matches included with each request.',
					render: (setting) => {
						setting.addSlider((slider) => {
							slider
								.setLimits(0, 20, 1)
								.setValue(plugin.settings.maxVaultResults)
								.onChange(async (value) => {
									plugin.settings.maxVaultResults = value;
									await plugin.saveSettings();
								});
						});
					}
				},
				{
					name: 'Excluded folders',
					desc: 'One vault-relative folder per line.',
					render: (setting) => {
						setting.addTextArea((textArea) => {
							textArea
								.setPlaceholder(`${app.vault.configDir}\narchive`)
								.setValue(plugin.settings.excludedFolders.join('\n'))
								.onChange(async (value) => {
									plugin.settings.excludedFolders = value
										.split('\n')
										.map((folder) => folder.trim())
										.filter((folder) => folder.length > 0);
									await plugin.saveSettings();
								});
						});
					}
				}
			]
		},
		{
			type: 'group',
			heading: 'Editing',
			items: [
				{
					name: 'Review mode',
					desc: 'Preview model-generated Markdown edits before writing files.',
					render: (setting) => {
						setting.addToggle((toggle) => {
							toggle.setValue(plugin.settings.reviewMode).onChange(async (value) => {
								plugin.settings.reviewMode = value;
								await plugin.saveSettings();
							});
						});
					}
				}
			]
		}
	];
}
