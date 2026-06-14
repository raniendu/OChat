import { ItemView, MarkdownRenderer, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import { parseAssistantResponse } from './assistant-response';
import { getComposerPanel, toggleToolsPanel } from './composer-tools';
import { OCHAT_DISPLAY_NAME, OCHAT_VIEW_TYPE } from './constants';
import { shouldSubmitPromptKey } from './keyboard';
import { getModelSelectOptions } from './model-options';
import type OChatPlugin from './main';
import { resolveSubmitMode } from './modes';
import { parsePatchProposals } from './patches';
import type { ChatMessage, ComposerMode, PatchProposal } from './types';
import type { SubmitMode } from './modes';

export class OChatView extends ItemView {
	private readonly plugin: OChatPlugin;
	private history: ChatMessage[] = [];
	private pendingPatches: PatchProposal[] = [];
	private transcriptEl: HTMLElement | null = null;
	private promptEl: HTMLTextAreaElement | null = null;
	private statusEl: HTMLElement | null = null;
	private setupEl: HTMLElement | null = null;
	private contextStripEl: HTMLElement | null = null;
	private mentionSuggestionsEl: HTMLElement | null = null;
	private testResultEl: HTMLElement | null = null;
	private isAwaitingResponse = false;
	private onboardingProbeStarted = false;
	private contextOpen = false;
	private settingsOpen = false;
	private contextFilePaths: string[] = [];
	private contextSearchQuery = '';

	constructor(leaf: WorkspaceLeaf, plugin: OChatPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.icon = 'bot';
	}

	getViewType(): string {
		return OCHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return OCHAT_DISPLAY_NAME;
	}

	async onOpen(): Promise<void> {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.renderContextStrip();
			})
		);
		this.render();
		if (this.plugin.needsOnboarding()) {
			void this.runOnboardingProbe();
		}
	}

	async onClose(): Promise<void> {
		this.pendingPatches = [];
	}

	clearConversation(): void {
		this.history = [];
		this.pendingPatches = [];
		this.render();
	}

	async askActiveNote(): Promise<void> {
		await this.submitPrompt('Summarize the active note and identify useful follow-up questions.', 'chat');
	}

	async editActiveNote(): Promise<void> {
		await this.submitPrompt(
			[
				'Review the active Markdown note and propose useful edits.',
				'Return only JSON in this exact shape:',
				'{"patches":[{"path":"path/to/note.md","original":"exact text","replacement":"new text","rationale":"why"}]}'
			].join(' '),
			'edit'
		);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('ochat-view');

		this.transcriptEl = contentEl.createDiv({ cls: 'ochat-transcript' });
		this.renderTranscript();

		const composer = contentEl.createDiv({ cls: 'ochat-composer' });
		this.statusEl = composer.createDiv({ cls: 'ochat-status' });
		this.renderEndpointStatus();

		this.setupEl = composer.createDiv({ cls: 'ochat-setup' });
		this.renderComposerSetup();

		this.contextStripEl = composer.createDiv({ cls: 'ochat-context-strip' });
		this.renderContextStrip();

		this.promptEl = composer.createEl('textarea', {
			cls: 'ochat-prompt',
			attr: {
				placeholder: 'Ask about this note, or type @ to attach more context'
			}
		});
		this.promptEl.addEventListener('keydown', (event) => {
			if (!shouldSubmitPromptKey(event)) {
				return;
			}

			event.preventDefault();
			void this.submitFromComposer();
		});
		this.promptEl.addEventListener('input', () => {
			this.renderMentionSuggestions();
		});
		this.promptEl.addEventListener('keyup', () => {
			this.renderMentionSuggestions();
		});
		this.promptEl.addEventListener('click', () => {
			this.renderMentionSuggestions();
		});

		this.mentionSuggestionsEl = composer.createDiv({ cls: 'ochat-mention-suggestions' });

		const footer = composer.createDiv({ cls: 'ochat-composer-footer' });
		const controls = footer.createDiv({ cls: 'ochat-composer-controls' });
		this.createIconButton(controls, 'plus', 'Add context files', () => {
			this.contextOpen = toggleToolsPanel(this.contextOpen);
			this.settingsOpen = false;
			this.renderComposerSetup();
		});
		this.renderModelPicker(controls);
		this.renderModeToggle(controls, this.plugin.settings.composerMode, async (mode) => {
			await this.plugin.selectComposerMode(mode);
		});

		const actions = footer.createDiv({ cls: 'ochat-composer-actions' });
		this.createIconButton(actions, 'settings', 'Settings', () => {
			this.settingsOpen = !this.settingsOpen;
			this.contextOpen = false;
			this.renderComposerSetup();
		});
		this.createIconButton(actions, 'trash-2', 'Clear conversation', () => {
			this.clearConversation();
		});
		this.createIconButton(actions, 'send', 'Send', () => {
			void this.submitFromComposer();
		}, 'ochat-send-button mod-cta');
	}

	private createIconButton(
		containerEl: HTMLElement,
		icon: string,
		title: string,
		onClick: () => void,
		cls = 'ochat-icon-button'
	): HTMLButtonElement {
		const button = containerEl.createEl('button', {
			cls,
			attr: {
				title,
				'aria-label': title
			}
		});
		setIcon(button, icon);
		button.addEventListener('click', onClick);
		return button;
	}

	private renderTranscript(): void {
		if (!this.transcriptEl) {
			return;
		}

		this.transcriptEl.empty();

		if (this.history.length === 0 && this.pendingPatches.length === 0) {
			this.transcriptEl.createDiv({
				cls: 'ochat-empty',
				text: 'Ask a question, summarize the active note, or request Markdown edits.'
			});
			return;
		}

		for (const message of this.history) {
			const messageEl = this.transcriptEl.createDiv({
				cls: `ochat-message ochat-message-${message.role}`
			});
			messageEl.createDiv({ cls: 'ochat-message-role', text: message.role });
			this.renderMessageContent(messageEl, message);
		}

		if (this.isAwaitingResponse) {
			const thinkingEl = this.transcriptEl.createDiv({
				cls: 'ochat-message ochat-message-assistant ochat-message-thinking'
			});
			thinkingEl.createDiv({ cls: 'ochat-message-role', text: 'assistant' });
			thinkingEl.createDiv({ cls: 'ochat-thinking-live', text: 'thinking...' });
		}

		if (this.pendingPatches.length > 0) {
			this.renderPatchReview(this.pendingPatches);
		}
	}

	private renderComposerSetup(): void {
		if (!this.setupEl) {
			return;
		}

		this.setupEl.empty();

		const panel = getComposerPanel({
			onboardingRequired: this.plugin.needsOnboarding(),
			settingsOpen: this.settingsOpen,
			contextOpen: this.contextOpen
		});

		if (panel === 'onboarding') {
			this.renderOnboardingPanel(this.setupEl);
			return;
		}

		if (panel === 'settings') {
			this.renderSettingsPanel(this.setupEl);
			return;
		}

		if (panel === 'context') {
			this.renderContextPanel(this.setupEl);
		}
	}

	private renderContextStrip(): void {
		if (!this.contextStripEl) {
			return;
		}

		this.contextStripEl.empty();
		const activePath = this.plugin.getActiveMarkdownPath();

		if (activePath) {
			this.contextStripEl.createSpan({
				cls: 'ochat-context-chip ochat-context-chip-active',
				text: `Active: ${activePath}`
			});
		}

		for (const path of this.getAttachedContextPaths()) {
			const chip = this.contextStripEl.createEl('button', {
				cls: 'ochat-context-chip ochat-context-chip-removable',
				attr: { title: `Remove ${path}` }
			});
			chip.createSpan({ text: `@${path}` });
			const close = chip.createSpan({ cls: 'ochat-context-chip-x' });
			setIcon(close, 'x');
			chip.addEventListener('click', () => {
				this.removeContextFile(path);
			});
		}

		if (this.plugin.settings.maxVaultResults > 0) {
			this.contextStripEl.createSpan({
				cls: 'ochat-context-chip ochat-context-chip-muted',
				text: 'Vault search'
			});
		}
	}

	private renderSettingsPanel(containerEl: HTMLElement): void {
		containerEl.createDiv({ cls: 'ochat-connection-title', text: 'Settings' });

		const endpointRow = containerEl.createDiv({ cls: 'ochat-setting-row' });
		endpointRow.createDiv({ cls: 'ochat-setting-label', text: 'Ollama endpoint' });
		const endpointInput = endpointRow.createEl('input', {
			type: 'text',
			value: this.plugin.settings.baseUrl,
			cls: 'ochat-endpoint-input'
		});

		const modelRow = containerEl.createDiv({ cls: 'ochat-setting-row' });
		modelRow.createDiv({ cls: 'ochat-setting-label', text: 'Default model' });
		const modelSelect = modelRow.createEl('select', {
			cls: 'ochat-model-picker',
			attr: {
				title: 'Default model'
			}
		});
		for (const option of getModelSelectOptions(this.plugin.settings.model, this.plugin.settings.availableModels)) {
			modelSelect.createEl('option', {
				text: option.label,
				value: option.value
			});
		}
		modelSelect.value = this.plugin.settings.model;

		const behaviorRow = containerEl.createDiv({ cls: 'ochat-setting-row' });
		behaviorRow.createDiv({ cls: 'ochat-setting-label', text: 'Default behavior' });
		let selectedMode = this.plugin.settings.composerMode;
		this.renderModeToggle(behaviorRow, selectedMode, (mode) => {
			selectedMode = mode;
		});

		const actions = containerEl.createDiv({ cls: 'ochat-actions' });
		actions.createEl('button', { text: 'Save', cls: 'mod-cta' }, (button) => {
			button.addEventListener('click', () => {
				void this.saveComposerSettings(endpointInput.value, modelSelect.value, selectedMode);
			});
		});
		actions.createEl('button', { text: 'Refresh models' }, (button) => {
			button.addEventListener('click', () => {
				void this.refreshModels();
			});
		});
		actions.createEl('button', { text: 'Test endpoint' }, (button) => {
			button.addEventListener('click', () => {
				void this.testEndpoint(endpointInput.value);
			});
		});
		actions.createEl('button', { text: 'Close' }, (button) => {
			button.addEventListener('click', () => {
				this.settingsOpen = false;
				this.renderComposerSetup();
			});
		});
		this.testResultEl = containerEl.createDiv({ cls: 'ochat-test-result' });
	}

	private renderMessageContent(messageEl: HTMLElement, message: ChatMessage): void {
		if (message.thinking?.trim()) {
			const details = messageEl.createEl('details', { cls: 'ochat-thinking' });
			details.createEl('summary', { text: 'Thinking' });
			details.createEl('pre', { text: message.thinking.trim() });
		}

		if (message.role === 'assistant') {
			const markdownEl = messageEl.createDiv({ cls: 'ochat-markdown markdown-rendered' });
			void MarkdownRenderer.render(this.app, message.content, markdownEl, '', this);
			return;
		}

		messageEl.createDiv({ cls: 'ochat-user-content', text: message.content });
	}

	private renderContextPanel(containerEl: HTMLElement): void {
		containerEl.createDiv({ cls: 'ochat-connection-title', text: 'Attach context' });

		if (this.contextFilePaths.length === 0) {
			containerEl.createDiv({ cls: 'ochat-muted', text: 'No extra files attached.' });
		} else {
			const list = containerEl.createDiv({ cls: 'ochat-context-list' });
			for (const path of this.contextFilePaths) {
				const row = list.createDiv({ cls: 'ochat-context-file' });
				row.createSpan({ text: path });
				row.createEl('button', { text: 'Remove', cls: 'ochat-ghost-button' }, (button) => {
					button.addEventListener('click', () => {
						this.contextFilePaths = this.contextFilePaths.filter((item) => item !== path);
						this.renderComposerSetup();
					});
				});
			}
		}

		const searchInput = containerEl.createEl('input', {
			type: 'text',
			value: this.contextSearchQuery,
			cls: 'ochat-context-search',
			attr: {
				placeholder: 'Search Markdown notes'
			}
		});
		const results = containerEl.createDiv({ cls: 'ochat-context-results' });
		const renderResults = () => {
			results.empty();
			const activePath = this.plugin.getActiveMarkdownPath();
			const matches = this.plugin
				.getMarkdownFileMatches(this.contextSearchQuery, 12)
				.filter((path) => path !== activePath && !this.contextFilePaths.includes(path));

			if (matches.length === 0) {
				results.createDiv({ cls: 'ochat-muted', text: 'No matching notes' });
				return;
			}

			for (const path of matches) {
				const button = results.createEl('button', {
					text: path,
					cls: 'ochat-context-result'
				});
				button.addEventListener('click', () => {
					this.attachContextFile(path);
				});
			}
		};
		searchInput.addEventListener('input', () => {
			this.contextSearchQuery = searchInput.value;
			renderResults();
		});
		renderResults();

		const actions = containerEl.createDiv({ cls: 'ochat-actions' });
		actions.createEl('button', { text: 'Clear files' }, (button) => {
			button.addEventListener('click', () => {
				this.contextFilePaths = [];
				this.renderComposerSetup();
				this.renderContextStrip();
			});
		});
		actions.createEl('button', { text: 'Close' }, (button) => {
			button.addEventListener('click', () => {
				this.contextOpen = false;
				this.renderComposerSetup();
			});
		});
	}

	private renderOnboardingPanel(containerEl: HTMLElement): void {
		containerEl.createDiv({ cls: 'ochat-connection-title', text: 'Set up local model' });
		containerEl.createDiv({
			cls: 'ochat-muted',
			text: `Default endpoint: ${this.plugin.settings.baseUrl}`
		});

		if (this.plugin.settings.availableModels.length > 0) {
			this.renderModelPicker(containerEl);
			containerEl.createEl('button', { text: 'Use selected model', cls: 'mod-cta' }, (button) => {
				button.addEventListener('click', () => {
					void this.completeOnboarding();
				});
			});
			return;
		}

		const endpointInput = containerEl.createEl('input', {
			type: 'text',
			value: this.plugin.settings.baseUrl,
			cls: 'ochat-endpoint-input'
		});

		const actions = containerEl.createDiv({ cls: 'ochat-actions' });
		actions.createEl('button', { text: 'Test endpoint', cls: 'mod-cta' }, (button) => {
			button.addEventListener('click', () => {
				void this.testEndpoint(endpointInput.value);
			});
		});
		actions.createEl('button', { text: 'Retry default' }, (button) => {
			button.addEventListener('click', () => {
				void this.testEndpoint('http://localhost:11434');
			});
		});
	}

	private renderModelPicker(containerEl: HTMLElement): void {
		const models = this.plugin.settings.availableModels;

		if (models.length === 0) {
			const empty = containerEl.createEl('select', {
				cls: 'ochat-model-picker',
				attr: { title: 'No models discovered yet' }
			});
			empty.createEl('option', { text: 'No models' });
			empty.disabled = true;
			return;
		}

		const select = containerEl.createEl('select', {
			cls: 'ochat-model-picker',
			attr: { title: 'Model' }
		});
		for (const model of models) {
			select.createEl('option', {
				text: model,
				value: model
			});
		}
		select.value = this.plugin.settings.model;
		select.addEventListener('change', () => {
			void this.plugin.selectModel(select.value).then(() => {
				this.renderEndpointStatus();
				this.renderComposerSetup();
			});
		});
	}

	private renderModeToggle(
		containerEl: HTMLElement,
		selectedMode: ComposerMode,
		onChange: (mode: ComposerMode) => void | Promise<void>
	): void {
		const group = containerEl.createDiv({
			cls: 'ochat-mode-toggle',
			attr: {
				role: 'group',
				'aria-label': 'Behavior'
			}
		});
		const modes: Array<{ value: ComposerMode; label: string }> = [
			{ value: 'ask', label: 'Ask' },
			{ value: 'edit', label: 'Edit' }
		];
		const buttons = new Map<ComposerMode, HTMLButtonElement>();

		for (const mode of modes) {
			const button = group.createEl('button', {
				text: mode.label,
				cls: 'ochat-mode-toggle-button',
				attr: {
					type: 'button',
					'aria-pressed': String(mode.value === selectedMode)
				}
			});
			buttons.set(mode.value, button);
			button.addEventListener('click', () => {
				selectedMode = mode.value;
				syncButtons();
				void onChange(mode.value);
			});
		}

		const syncButtons = () => {
			for (const [mode, button] of buttons.entries()) {
				button.toggleClass('is-active', mode === selectedMode);
				button.setAttribute('aria-pressed', String(mode === selectedMode));
			}
		};

		syncButtons();
	}

	private async saveComposerSettings(baseUrl: string, model: string, mode: ComposerMode): Promise<void> {
		try {
			if (baseUrl.trim() !== this.plugin.settings.baseUrl) {
				await this.plugin.updateBaseUrl(baseUrl);
			}
			await this.plugin.selectModel(model);
			await this.plugin.selectComposerMode(mode);
			this.setStatus(`Ready. Default ${mode}. Model ${this.plugin.settings.model}.`);
			this.renderEndpointStatus();
			this.render();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(message);
			new Notice(message);
		}
	}

	private renderPatchReview(patches: PatchProposal[]): void {
		if (!this.transcriptEl) {
			return;
		}

		const reviewEl = this.transcriptEl.createDiv({ cls: 'ochat-review' });
		reviewEl.createDiv({ cls: 'ochat-review-title', text: 'Pending Markdown edits' });

		for (const patch of patches) {
			const patchEl = reviewEl.createDiv({ cls: 'ochat-patch' });
			patchEl.createDiv({ cls: 'ochat-patch-path', text: patch.path });
			patchEl.createDiv({ cls: 'ochat-patch-rationale', text: patch.rationale });
			patchEl.createEl('pre', { cls: 'ochat-patch-original', text: patch.original });
			patchEl.createEl('pre', { cls: 'ochat-patch-replacement', text: patch.replacement });
		}

		const actions = reviewEl.createDiv({ cls: 'ochat-actions' });
		actions.createEl('button', { text: 'Apply edits', cls: 'mod-cta' }, (button) => {
			button.addEventListener('click', () => {
				void this.applyPendingPatches();
			});
		});
		actions.createEl('button', { text: 'Discard' }, (button) => {
			button.addEventListener('click', () => {
				this.pendingPatches = [];
				this.renderTranscript();
			});
		});
	}

	private renderEndpointStatus(): void {
		if (!this.statusEl) {
			return;
		}

		this.statusEl.empty();
		const endpoint = this.plugin.getEndpointClassification();
		this.statusEl.setText(`${this.plugin.settings.provider} - ${this.plugin.settings.baseUrl}`);

		if (endpoint.requiresAcknowledgement) {
			this.statusEl.createDiv({
				cls: 'ochat-warning',
				text: endpoint.reason
			});
		}
	}

	private async submitFromComposer(): Promise<void> {
		const prompt = this.promptEl?.value.trim() ?? '';

		if (prompt.length === 0) {
			new Notice('Enter a prompt first.');
			return;
		}

		if (this.promptEl) {
			this.promptEl.value = '';
		}

		const mode = resolveSubmitMode(this.plugin.settings.composerMode, prompt);
		await this.submitPrompt(prompt, mode);
	}

	private async submitPrompt(prompt: string, mode: SubmitMode): Promise<void> {
		try {
			this.setStatus('Building context...');
			this.attachContextFiles(this.plugin.resolvePromptContextPaths(prompt));
			const requestPrompt =
				mode === 'edit'
					? `${prompt}\n\nReturn only JSON with a patches array. Edit only Markdown files.`
					: prompt;
			const messages = await this.plugin.buildMessages(requestPrompt, this.history, this.contextFilePaths);

			this.history.push({ role: 'user', content: prompt });
			this.isAwaitingResponse = true;
			this.renderTranscript();
			this.setStatus('Waiting for model...');

			const answer = await this.plugin.chat(messages);
			this.isAwaitingResponse = false;

			if (mode === 'edit') {
				await this.handleEditAnswer(answer);
			} else {
				this.history.push({ role: 'assistant', ...parseAssistantResponse(answer) });
			}

			this.setStatus('Ready.');
			this.renderTranscript();
		} catch (error) {
			this.isAwaitingResponse = false;
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(message);
			this.renderTranscript();
			new Notice(message);
		}
	}

	private async handleEditAnswer(answer: string): Promise<void> {
		const parsed = parseAssistantResponse(answer);
		const patches = parsePatchProposals(parsed.content);

		if (patches.length === 0) {
			this.history.push({ role: 'assistant', ...parsed });
			new Notice('The model did not return valid patch JSON.');
			return;
		}

		if (this.plugin.settings.reviewMode) {
			this.pendingPatches = patches;
			this.history.push({
				role: 'assistant',
				content: `Prepared ${patches.length} Markdown edit${patches.length === 1 ? '' : 's'} for review.`,
				thinking: parsed.thinking
			});
			return;
		}

		const results = await this.plugin.applyPatches(patches, true);
		this.history.push({
			role: 'assistant',
			content: results.map((result) => JSON.stringify(result)).join('\n')
		});
	}

	private async applyPendingPatches(): Promise<void> {
		if (this.pendingPatches.length === 0) {
			return;
		}

		try {
			const results = await this.plugin.applyPatches(this.pendingPatches, true);
			this.pendingPatches = [];
			this.history.push({
				role: 'assistant',
				content: results.map((result) => JSON.stringify(result)).join('\n')
			});
			this.renderTranscript();
			new Notice('Applied reviewed edits.');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(message);
			this.setStatus(message);
		}
	}

	async refreshModels(): Promise<void> {
		try {
			this.setStatus('Refreshing models...');
			const models = await this.plugin.refreshAvailableModels();
			this.setStatus(models.length > 0 ? `Ready. Selected ${this.plugin.settings.model}.` : 'No models were returned.');
			this.renderComposerSetup();
			this.render();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(message);
			new Notice(message);
		}
	}

	private async runOnboardingProbe(): Promise<void> {
		if (this.onboardingProbeStarted) {
			return;
		}

		this.onboardingProbeStarted = true;
		await this.refreshModels();
	}

	private async testEndpoint(baseUrl: string): Promise<void> {
		try {
			this.setStatus('Testing endpoint...');
			this.setTestResult('Testing endpoint...', 'pending');
			await this.plugin.updateBaseUrl(baseUrl);
			const models = await this.plugin.refreshAvailableModels();
			const message =
				models.length > 0
					? `Success. Found ${models.length} model${models.length === 1 ? '' : 's'}. Selected ${this.plugin.settings.model}.`
					: 'Connected, but no models were returned.';
			this.renderEndpointStatus();
			this.renderComposerSetup();
			this.setStatus(message);
			this.setTestResult(message, models.length > 0 ? 'success' : 'warning');
			new Notice(message);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(message);
			this.renderComposerSetup();
			this.setTestResult(`Failed. ${message}`, 'error');
			new Notice(message);
		}
	}

	private async completeOnboarding(): Promise<void> {
		await this.plugin.selectModel(this.plugin.settings.model);
		this.setStatus(`Ready. Selected ${this.plugin.settings.model}.`);
		this.renderComposerSetup();
		this.render();
	}

	private setStatus(message: string): void {
		this.statusEl?.setText(message);
	}

	private setTestResult(message: string, kind: 'pending' | 'success' | 'warning' | 'error'): void {
		if (!this.testResultEl) {
			return;
		}

		this.testResultEl.empty();
		this.testResultEl.setText(message);
		this.testResultEl.className = `ochat-test-result ochat-test-result-${kind}`;
	}

	private renderMentionSuggestions(): void {
		if (!this.mentionSuggestionsEl) {
			return;
		}

		this.mentionSuggestionsEl.empty();
		this.mentionSuggestionsEl.removeClass('is-visible');

		const mention = this.getActiveMentionAtCursor();
		if (!mention) {
			return;
		}

		const matches = this.plugin
			.getMarkdownFileMatches(mention.query, 8)
			.filter((path) => path !== this.plugin.getActiveMarkdownPath() && !this.contextFilePaths.includes(path));
		if (matches.length === 0) {
			this.mentionSuggestionsEl.createDiv({ cls: 'ochat-muted', text: 'No matching notes' });
			this.mentionSuggestionsEl.addClass('is-visible');
			return;
		}

		for (const path of matches) {
			const button = this.mentionSuggestionsEl.createEl('button', {
				text: path,
				cls: 'ochat-mention-suggestion'
			});
			button.addEventListener('click', () => {
				this.attachContextFile(path);
				this.removeActiveMentionToken(mention);
				this.renderMentionSuggestions();
			});
		}

		this.mentionSuggestionsEl.addClass('is-visible');
	}

	private getActiveMentionAtCursor(): { start: number; end: number; query: string } | null {
		if (!this.promptEl) {
			return null;
		}

		const cursor = this.promptEl.selectionStart;
		const beforeCursor = this.promptEl.value.slice(0, cursor);
		const match = /(^|\s)@([^\s@"[\]]*)$/.exec(beforeCursor);

		if (!match) {
			return null;
		}

		return {
			start: beforeCursor.length - match[2].length - 1,
			end: cursor,
			query: match[2]
		};
	}

	private removeActiveMentionToken(mention: { start: number; end: number }): void {
		if (!this.promptEl) {
			return;
		}

		const value = this.promptEl.value;
		const before = value.slice(0, mention.start).trimEnd();
		const after = value.slice(mention.end).trimStart();
		const spacer = before.length > 0 && after.length > 0 ? ' ' : '';
		const nextValue = `${before}${spacer}${after}`;
		this.promptEl.value = nextValue;
		const cursor = before.length + spacer.length;
		this.promptEl.setSelectionRange(cursor, cursor);
		this.promptEl.focus();
	}

	private attachContextFiles(paths: string[]): void {
		for (const path of paths) {
			this.attachContextFile(path);
		}
	}

	private attachContextFile(path: string): void {
		if (path === this.plugin.getActiveMarkdownPath() || this.contextFilePaths.includes(path)) {
			return;
		}

		this.contextFilePaths.push(path);
		this.renderComposerSetup();
		this.renderContextStrip();
	}

	private removeContextFile(path: string): void {
		this.contextFilePaths = this.contextFilePaths.filter((item) => item !== path);
		this.renderComposerSetup();
		this.renderContextStrip();
	}

	private getAttachedContextPaths(): string[] {
		const activePath = this.plugin.getActiveMarkdownPath();
		return this.contextFilePaths.filter((path) => path !== activePath);
	}
}
