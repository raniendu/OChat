import { App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type OChatPlugin from './main';
import { getModelSelectOptions } from './model-options';
import { classifyEndpoint } from './providers/url-policy';
import type { ProviderKind } from './types';

export class OChatSettingTab extends PluginSettingTab {
	private readonly plugin: OChatPlugin;

	constructor(app: App, plugin: OChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Connection').setHeading();

		new Setting(containerEl)
			.setName('Provider')
			.setDesc('Choose the local model API shape.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('ollama', 'Ollama')
					.addOption('openai-compatible', 'OpenAI-compatible')
					.setValue(this.plugin.settings.provider)
					.onChange(async (value) => {
						this.plugin.settings.provider = value as ProviderKind;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName('Base URL')
			.setDesc('Use localhost or a private network address unless you intentionally trust a remote endpoint.')
			.addText((text) => {
				text
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						await this.plugin.updateBaseUrl(value);
					});
			});

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Optional. Select an Obsidian secret to send as a bearer token. The secret value is not stored in plugin data.')
			.addComponent((container) =>
				new SecretComponent(this.app, container)
					.setValue(this.plugin.settings.apiKeySecretId)
					.onChange(async (value) => {
						await this.plugin.updateApiKeySecretId(value);
					})
			);

		const endpoint = classifyEndpoint(this.plugin.settings.baseUrl);
		if (endpoint.requiresAcknowledgement) {
			new Setting(containerEl)
				.setName('Acknowledge remote endpoint')
				.setDesc(endpoint.reason)
				.addToggle((toggle) => {
					toggle.setValue(this.plugin.settings.remoteEndpointAcknowledged).onChange(async (value) => {
						this.plugin.settings.remoteEndpointAcknowledged = value;
						await this.plugin.saveSettings();
					});
				});
		}

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Model name to use for chat and edit requests.')
			.addDropdown((dropdown) => {
				for (const option of getModelSelectOptions(this.plugin.settings.model, this.plugin.settings.availableModels)) {
					dropdown.addOption(option.value, option.label);
				}
				dropdown.setValue(this.plugin.settings.model).onChange(async (value) => {
					await this.plugin.selectModel(value);
				});
			});

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Lower values are more deterministic.')
			.addSlider((slider) => {
				slider
					.setLimits(0, 2, 0.1)
					.setValue(this.plugin.settings.temperature)
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName('Context').setHeading();

		new Setting(containerEl)
			.setName('Maximum context characters')
			.setDesc('Caps active note and vault snippets sent to the model.')
			.addText((text) => {
				text.setValue(String(this.plugin.settings.maxContextCharacters)).onChange(async (value) => {
					const parsed = Number(value);
					if (Number.isFinite(parsed)) {
						this.plugin.settings.maxContextCharacters = Math.round(parsed);
						await this.plugin.saveSettings();
					}
				});
			});

		new Setting(containerEl)
			.setName('Maximum vault results')
			.setDesc('Number of lexical vault matches included with each request.')
			.addSlider((slider) => {
				slider
					.setLimits(0, 20, 1)
					.setValue(this.plugin.settings.maxVaultResults)
					.onChange(async (value) => {
						this.plugin.settings.maxVaultResults = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('One vault-relative folder per line.')
			.addTextArea((textArea) => {
				textArea
					.setPlaceholder(`${this.app.vault.configDir}\narchive`)
					.setValue(this.plugin.settings.excludedFolders.join('\n'))
					.onChange(async (value) => {
						this.plugin.settings.excludedFolders = value
							.split('\n')
							.map((folder) => folder.trim())
							.filter((folder) => folder.length > 0);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName('Editing').setHeading();

		new Setting(containerEl)
			.setName('Review mode')
			.setDesc('Preview model-generated Markdown edits before writing files.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.reviewMode).onChange(async (value) => {
					this.plugin.settings.reviewMode = value;
					await this.plugin.saveSettings();
				});
			});
	}
}
