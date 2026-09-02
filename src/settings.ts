import { App, PluginSettingTab, SecretComponent } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type OChatPlugin from './main';
import { createOChatSettingDefinitions } from './settings-definitions';

export class OChatSettingTab extends PluginSettingTab {
	private readonly plugin: OChatPlugin;

	constructor(app: App, plugin: OChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return createOChatSettingDefinitions({
			app: this.app,
			plugin: this.plugin,
			update: () => this.update(),
			renderSecret: (setting) => {
				setting.addComponent((container) =>
					new SecretComponent(this.app, container)
						.setValue(this.plugin.settings.apiKeySecretId)
						.onChange(async (value) => {
							await this.plugin.updateApiKeySecretId(value);
						})
				);
			}
		});
	}
}
