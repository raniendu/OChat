import {
	MarkdownView,
	Plugin,
	requestUrl,
	TFile
} from 'obsidian';
import { findMarkdownPathMatches, resolveMentionedMarkdownPaths } from './context-mentions';
import { OCHAT_VIEW_TYPE } from './constants';
import { buildContextBundle, buildUserMessage } from './context';
import { applyModelDiscovery, isOnboardingRequired } from './onboarding';
import { applyPatchProposals } from './patch-applier';
import { executeAuthenticatedRequest } from './providers/common';
import { createModelProvider } from './providers/provider-client';
import { classifyEndpoint } from './providers/url-policy';
import { searchVaultSnippets } from './search';
import { OChatSettingTab } from './settings';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings-data';
import type {
	ChatMessage,
	EndpointClassification,
	NoteSource,
	OChatSettings,
	PatchProposal,
	RequestDescriptor
} from './types';
import { OChatView } from './view';

export default class OChatPlugin extends Plugin {
	settings: OChatSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(OCHAT_VIEW_TYPE, (leaf) => new OChatView(leaf, this));
		this.addSettingTab(new OChatSettingTab(this.app, this));
		this.addRibbonIcon('bot', 'Open chat', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-chat',
			name: 'Open chat',
			callback: () => {
				void this.activateView();
			}
		});

		this.addCommand({
			id: 'ask-active-note',
			name: 'Ask about active note',
			editorCallback: () => {
				void this.withView((view) => view.askActiveNote());
			}
		});

		this.addCommand({
			id: 'edit-active-note',
			name: 'Edit active note',
			editorCallback: () => {
				void this.withView((view) => view.editActiveNote());
			}
		});

		this.addCommand({
			id: 'refresh-models',
			name: 'Refresh models',
			callback: () => {
				void this.withView((view) => view.refreshModels());
			}
		});

		this.addCommand({
			id: 'clear-conversation',
			name: 'Clear conversation',
			callback: () => {
				void this.withView((view) => view.clearConversation());
			}
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<OChatSettings> | null);
	}

	async saveSettings(): Promise<void> {
		this.settings = normalizeSettings(this.settings);
		await this.saveData(this.settings);
	}

	async activateView(): Promise<OChatView | null> {
		const leaf = await this.app.workspace.ensureSideLeaf(OCHAT_VIEW_TYPE, 'right', {
			active: true,
			reveal: true
		});

		return leaf.view instanceof OChatView ? leaf.view : null;
	}

	async withView(callback: (view: OChatView) => void | Promise<void>): Promise<void> {
		const view = await this.activateView();

		if (view) {
			await callback(view);
		}
	}

	getEndpointClassification(): EndpointClassification {
		return classifyEndpoint(this.settings.baseUrl);
	}

	needsOnboarding(): boolean {
		return isOnboardingRequired(this.settings);
	}

	async updateBaseUrl(baseUrl: string): Promise<void> {
		this.settings.baseUrl = baseUrl.trim();
		this.settings.availableModels = [];
		this.settings.setupComplete = false;

		const endpoint = classifyEndpoint(this.settings.baseUrl);
		if (!endpoint.requiresAcknowledgement) {
			this.settings.remoteEndpointAcknowledged = false;
		}

		await this.saveSettings();
	}

	async updateApiKeySecretId(secretId: string): Promise<void> {
		this.settings.apiKeySecretId = secretId.trim();
		this.settings.availableModels = [];
		this.settings.setupComplete = false;
		await this.saveSettings();
	}

	async selectModel(model: string): Promise<void> {
		this.settings.model = model.trim();
		this.settings.setupComplete = this.settings.model.length > 0;
		await this.saveSettings();
	}

	async selectComposerMode(mode: OChatSettings['composerMode']): Promise<void> {
		this.settings.composerMode = mode;
		await this.saveSettings();
	}

	async refreshAvailableModels(): Promise<string[]> {
		const models = await this.listModels();
		this.settings = applyModelDiscovery(this.settings, models);
		await this.saveSettings();
		return models;
	}

	async buildMessages(prompt: string, history: ChatMessage[], contextFilePaths: string[] = []): Promise<ChatMessage[]> {
		const activeNote = await this.getActiveNoteSource();
		const selectedText = this.app.workspace.activeEditor?.editor?.getSelection() ?? '';
		const mentionedContextPaths = this.resolvePromptContextPaths(prompt);
		const contextPaths = [...new Set([...contextFilePaths, ...mentionedContextPaths])].filter(
			(path) => path !== activeNote?.path
		);
		const contextNotes = await this.getContextNoteSources(contextPaths);
		const vaultNotes = await this.getVaultNoteSources();
		const vaultSnippets = searchVaultSnippets(vaultNotes, prompt, {
			excludedFolders: this.settings.excludedFolders,
			maxResults: this.settings.maxVaultResults,
			maxSnippetCharacters: Math.min(1200, this.settings.maxContextCharacters)
		});
		const bundle = buildContextBundle({
			activeNote,
			selectedText,
			contextNotes,
			vaultSnippets,
			maxContextCharacters: this.settings.maxContextCharacters
		});

		return [bundle.messages[0], ...history.slice(-8), buildUserMessage(prompt, bundle.contextText)];
	}

	async chat(messages: ChatMessage[]): Promise<string> {
		this.assertEndpointAllowed();
		const provider = createModelProvider(this.settings.provider, (request) => this.executeRequest(request));

		return provider.chat({
			baseUrl: this.settings.baseUrl,
			model: this.settings.model,
			messages,
			temperature: this.settings.temperature
		});
	}

	async listModels(): Promise<string[]> {
		this.assertEndpointAllowed();
		const provider = createModelProvider(this.settings.provider, (request) => this.executeRequest(request));
		return provider.listModels(this.settings.baseUrl);
	}

	getMarkdownFilePaths(): string[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => !this.isExcludedPath(file.path))
			.map((file) => file.path)
			.sort((a, b) => a.localeCompare(b));
	}

	getMarkdownFileMatches(query: string, limit: number): string[] {
		return findMarkdownPathMatches(query, this.getMarkdownFilePaths(), limit);
	}

	resolvePromptContextPaths(prompt: string): string[] {
		return resolveMentionedMarkdownPaths(prompt, this.getMarkdownFilePaths());
	}

	getActiveMarkdownPath(): string | null {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = activeView?.file ?? this.app.workspace.getActiveFile();

		if (!file || file.extension !== 'md' || this.isExcludedPath(file.path)) {
			return null;
		}

		return file.path;
	}

	async applyPatches(patches: PatchProposal[], approved: boolean) {
		return applyPatchProposals(patches, {
			reviewMode: this.settings.reviewMode,
			approved,
			readFile: (path) => this.readMarkdownFile(path),
			writeFile: (path, content) => this.writeMarkdownFile(path, content)
		});
	}

	private async executeRequest(request: RequestDescriptor): Promise<unknown> {
		return executeAuthenticatedRequest<unknown>(
			request,
			this.settings.apiKeySecretId,
			(secretId) => this.app.secretStorage.getSecret(secretId),
			async (authenticatedRequest) => {
				const response = await requestUrl({
					url: authenticatedRequest.url,
					method: authenticatedRequest.method,
					headers: authenticatedRequest.headers,
					contentType: authenticatedRequest.method === 'POST' ? 'application/json' : undefined,
					body:
						authenticatedRequest.body === undefined ? undefined : JSON.stringify(authenticatedRequest.body)
				});

				return response.json as unknown;
			}
		);
	}

	private assertEndpointAllowed(): void {
		const endpoint = this.getEndpointClassification();

		if (endpoint.requiresAcknowledgement && !this.settings.remoteEndpointAcknowledged) {
			throw new Error(`${endpoint.reason} Enable acknowledgement in OChat settings to continue.`);
		}
	}

	private async getActiveNoteSource(): Promise<NoteSource | null> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = activeView?.file ?? this.app.workspace.getActiveFile();

		if (!file || file.extension !== 'md') {
			return null;
		}

		const activeEditor = this.app.workspace.activeEditor;
		const content =
			activeEditor?.file?.path === file.path && activeEditor.editor
				? activeEditor.editor.getValue()
				: await this.app.vault.cachedRead(file);

		return {
			path: file.path,
			content
		};
	}

	private async getVaultNoteSources(): Promise<NoteSource[]> {
		const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isExcludedPath(file.path));
		const notes: NoteSource[] = [];

		for (const file of files) {
			notes.push({
				path: file.path,
				content: await this.app.vault.cachedRead(file)
			});
		}

		return notes;
	}

	private async getContextNoteSources(paths: string[]): Promise<NoteSource[]> {
		const notes: NoteSource[] = [];

		for (const path of [...new Set(paths)]) {
			const file = this.getMarkdownFileByPath(path);
			notes.push({
				path: file.path,
				content: await this.app.vault.cachedRead(file)
			});
		}

		return notes;
	}

	private async readMarkdownFile(path: string): Promise<string> {
		const file = this.getMarkdownFileByPath(path);
		return this.app.vault.cachedRead(file);
	}

	private async writeMarkdownFile(path: string, content: string): Promise<void> {
		const file = this.getMarkdownFileByPath(path);
		const activeEditor = this.app.workspace.activeEditor;

		if (activeEditor?.file?.path === file.path && activeEditor.editor) {
			activeEditor.editor.setValue(content);
			return;
		}

		await this.app.vault.process(file, () => content);
	}

	private getMarkdownFileByPath(path: string): TFile {
		const file = this.app.vault.getFileByPath(path);

		if (!(file instanceof TFile) || file.extension !== 'md') {
			throw new Error(`OChat can only edit Markdown files in the vault: ${path}`);
		}

		return file;
	}

	private isExcludedPath(path: string): boolean {
		return [this.app.vault.configDir, ...this.settings.excludedFolders].some((folder) => {
			const normalized = folder.trim().replace(/^\/+|\/+$/g, '');
			return normalized.length > 0 && (path === normalized || path.startsWith(`${normalized}/`));
		});
	}
}
