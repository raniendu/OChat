import { ItemView, MarkdownRenderer, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import { parseAssistantResponse } from './assistant-response';
import { getComposerPanel, toggleToolsPanel } from './composer-tools';
import { OCHAT_DISPLAY_NAME, OCHAT_VIEW_TYPE } from './constants';
import { shouldSubmitPromptKey } from './keyboard';
import { getModelSelectOptions } from './model-options';
import type OChatPlugin from './main';
import { resolveSubmitMode } from './modes';
import { buildUnifiedDiff } from './diff';
import { invertPatchProposal, parsePatchProposals } from './patches';
import { splitPathLabel } from './path-label';
import type { ChatMessage, ComposerMode, PatchProposal } from './types';
import type { SubmitMode } from './modes';
import { getEndpointLabel, getProviderLabel, getViewStatusKind } from './view-data';

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
	private messageTimes: number[] = [];
	private composerActionsEl: HTMLElement | null = null;
	private appliedEdits = new Map<number, { patches: PatchProposal[]; undone: boolean }>();
	private requestToken = 0;
	private statusMessage = 'Ready';
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
		this.requestToken++;
	}

	clearConversation(): void {
		this.history = [];
		this.messageTimes = [];
		this.pendingPatches = [];
		this.appliedEdits.clear();
		this.requestToken++;
		this.isAwaitingResponse = false;
		this.render();
	}

	async askActiveNote(): Promise<void> {
		await this.submitPrompt('Summarize the active note and identify useful follow-up questions.', 'chat');
	}

	async editActiveNote(): Promise<void> {
		await this.submitPrompt('Review the active note and propose useful edits.', 'edit');
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('ochat-view');

		this.renderHeader(contentEl);

		this.contextStripEl = contentEl.createDiv({ cls: 'ochat-context' });
		this.renderContextStrip();

		this.setupEl = contentEl.createDiv({ cls: 'ochat-setup' });
		this.renderComposerSetup();

		this.transcriptEl = contentEl.createDiv({ cls: 'ochat-transcript' });
		this.renderTranscript();

		const composer = contentEl.createDiv({ cls: 'ochat-composer' });
		this.promptEl = composer.createEl('textarea', {
			cls: 'ochat-prompt',
			attr: {
				placeholder: 'Ask about your notes…',
				'aria-label': 'Ask a question'
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
		this.createIconButton(controls, 'at-sign', 'Mention a note', () => {
			if (this.promptEl) {
				const start = this.promptEl.selectionStart;
				const end = this.promptEl.selectionEnd;
				this.promptEl.setRangeText('@', start, end, 'end');
				this.promptEl.focus();
				this.renderMentionSuggestions();
			}
		});
		this.createIconButton(controls, 'paperclip', 'Attach context files', () => {
			this.contextOpen = toggleToolsPanel(this.contextOpen);
			this.settingsOpen = false;
			this.renderComposerSetup();
		});
		this.renderModelPicker(controls);
		this.renderModeToggle(controls, this.plugin.settings.composerMode, async (mode) => {
			await this.plugin.selectComposerMode(mode);
		});

		this.composerActionsEl = footer.createDiv({ cls: 'ochat-composer-actions' });
		this.renderComposerAction();

		this.statusEl = contentEl.createDiv({ cls: 'ochat-status' });
		this.renderEndpointStatus();
	}

	private renderComposerAction(): void {
		if (!this.composerActionsEl) {
			return;
		}

		this.composerActionsEl.empty();

		if (this.isAwaitingResponse) {
			this.createIconButton(
				this.composerActionsEl,
				'square',
				'Stop',
				() => {
					this.stopRequest();
				},
				'ochat-stop-button'
			);
			return;
		}

		this.createIconButton(
			this.composerActionsEl,
			'send',
			'Send',
			() => {
				void this.submitFromComposer();
			},
			'ochat-send-button mod-cta'
		);
	}

	/**
	 * Obsidian's requestUrl takes no abort signal, so Stop cannot cancel the
	 * network call. It releases the composer and discards whatever comes back
	 * for a superseded token.
	 */
	private stopRequest(): void {
		if (!this.isAwaitingResponse) {
			return;
		}

		this.requestToken++;
		this.isAwaitingResponse = false;
		this.setStatus('Stopped.');
		this.renderComposerAction();
		this.renderTranscript();
	}

	/** Renders a vault path with the folder dimmed so it truncates first. */
	private renderPathLabel(containerEl: HTMLElement, path: string, cls = 'ochat-context-path'): HTMLElement {
		const label = containerEl.createSpan({ cls, attr: { title: path } });
		const parts = splitPathLabel(path);

		if (parts.folder) {
			label.createSpan({ cls: 'ochat-path-folder', text: parts.folder });
		}

		label.createSpan({ cls: 'ochat-path-name', text: parts.name });
		return label;
	}

	private renderHeader(containerEl: HTMLElement): void {
		const header = containerEl.createDiv({ cls: 'ochat-header' });
		const brand = header.createDiv({ cls: 'ochat-brand' });
		brand.createSpan({ cls: 'ochat-brand-name', text: 'OChat' });
		brand.createSpan({ cls: 'ochat-connection-dot', attr: { 'aria-label': 'Local model connection' } });

		const actions = header.createDiv({ cls: 'ochat-header-actions' });
		this.createIconButton(actions, 'square-pen', 'New chat', () => {
			this.clearConversation();
		});
		this.createIconButton(actions, 'files', 'Attach context', () => {
			this.contextOpen = toggleToolsPanel(this.contextOpen);
			this.settingsOpen = false;
			this.renderComposerSetup();
		});
		this.createIconButton(actions, 'settings', 'Settings', () => {
			this.settingsOpen = !this.settingsOpen;
			this.contextOpen = false;
			this.renderComposerSetup();
		});
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
			const empty = this.transcriptEl.createDiv({ cls: 'ochat-empty' });
			const icon = empty.createDiv({ cls: 'ochat-empty-icon' });
			setIcon(icon, 'bot');
			empty.createDiv({ cls: 'ochat-empty-title', text: 'Ask OChat' });
			empty.createDiv({
				cls: 'ochat-empty-copy',
				text: 'Use the active note, selected text, and attached files to answer questions or prepare safe Markdown edits.'
			});
			const suggestions = empty.createDiv({ cls: 'ochat-empty-actions' });
			suggestions.createEl('button', { text: 'Summarize active note' }, (button) => {
				button.addEventListener('click', () => {
					void this.askActiveNote();
				});
			});
			suggestions.createEl('button', { text: 'Suggest edits' }, (button) => {
				button.addEventListener('click', () => {
					void this.editActiveNote();
				});
			});
			return;
		}

		for (const [index, message] of this.history.entries()) {
			const messageEl = this.transcriptEl.createDiv({
				cls: `ochat-message ochat-message-${message.role}`
			});
			const avatar = messageEl.createDiv({ cls: 'ochat-message-avatar' });
			setIcon(avatar, message.role === 'assistant' ? 'bot' : 'user-round');
			const body = messageEl.createDiv({ cls: 'ochat-message-body' });
			const header = body.createDiv({ cls: 'ochat-message-header' });
			header.createSpan({
				cls: 'ochat-message-role',
				text: message.role === 'assistant' ? 'OChat' : 'You'
			});
			header.createEl('time', {
				cls: 'ochat-message-time',
				text: this.formatMessageTime(this.messageTimes[index])
			});
			const applied = this.appliedEdits.get(index);

			if (applied) {
				this.renderAppliedEdits(body, applied);
			} else {
				this.renderMessageContent(body, message);
			}
		}

		if (this.isAwaitingResponse) {
			const thinkingEl = this.transcriptEl.createDiv({
				cls: 'ochat-message ochat-message-assistant ochat-message-thinking'
			});
			const avatar = thinkingEl.createDiv({ cls: 'ochat-message-avatar' });
			setIcon(avatar, 'bot');
			const body = thinkingEl.createDiv({ cls: 'ochat-message-body' });
			const header = body.createDiv({ cls: 'ochat-message-header' });
			header.createSpan({ cls: 'ochat-message-role', text: 'OChat' });
			header.createEl('time', { cls: 'ochat-message-time', text: this.formatMessageTime(Date.now()) });
			const live = body.createDiv({ cls: 'ochat-thinking-live' });
			live.createSpan({ cls: 'ochat-thinking-pulse' });
			live.createSpan({ text: 'Thinking…' });
		}

		if (this.pendingPatches.length > 0) {
			this.renderPatchReview(this.pendingPatches);
		}
	}

	private renderAppliedEdits(
		containerEl: HTMLElement,
		record: { patches: PatchProposal[]; undone: boolean }
	): void {
		const row = containerEl.createDiv({ cls: 'ochat-applied' });
		const icon = row.createSpan({ cls: 'ochat-applied-icon' });
		setIcon(icon, record.undone ? 'undo-2' : 'check');

		const count = record.patches.length;
		row.createSpan({
			cls: 'ochat-applied-label',
			text: record.undone
				? `Reverted ${count} edit${count === 1 ? '' : 's'}`
				: `Applied ${count} edit${count === 1 ? '' : 's'}`
		});

		const paths = [...new Set(record.patches.map((patch) => patch.path))];
		row.createSpan({ cls: 'ochat-applied-separator', text: '·' });

		if (paths.length === 1) {
			const link = this.renderPathLabel(row, paths[0], 'ochat-applied-link');
			link.addEventListener('click', () => {
				void this.app.workspace.openLinkText(paths[0], '', false);
			});
		} else {
			row.createSpan({ cls: 'ochat-applied-link', text: `${paths.length} files` });
		}

		if (record.undone) {
			return;
		}

		const undo = row.createEl('button', {
			cls: 'ochat-undo-button',
			text: 'Undo',
			attr: { type: 'button' }
		});
		undo.addEventListener('click', () => {
			void this.undoApplied(record);
		});
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
		const heading = this.contextStripEl.createDiv({ cls: 'ochat-context-heading' });
		heading.createSpan({ text: 'Context' });
		if (this.plugin.settings.maxVaultResults > 0) {
			heading.createSpan({ cls: 'ochat-context-search-status', text: 'Vault search on' });
		}

		const card = this.contextStripEl.createDiv({ cls: 'ochat-context-card' });
		const activePath = this.plugin.getActiveMarkdownPath();

		if (activePath) {
			const row = card.createDiv({ cls: 'ochat-context-row ochat-context-row-active' });
			const icon = row.createSpan({ cls: 'ochat-context-icon' });
			setIcon(icon, 'file-text');
			this.renderPathLabel(row, activePath);
			const status = row.createSpan({ cls: 'ochat-context-active-status' });
			status.createSpan({ text: 'Active' });
			status.createSpan({ cls: 'ochat-context-active-dot' });
		} else {
			const row = card.createDiv({ cls: 'ochat-context-row ochat-context-row-empty' });
			const icon = row.createSpan({ cls: 'ochat-context-icon' });
			setIcon(icon, 'file-x');
			row.createSpan({ cls: 'ochat-context-path', text: 'No active Markdown note' });
		}

		for (const path of this.getAttachedContextPaths()) {
			const row = card.createDiv({ cls: 'ochat-context-row' });
			const icon = row.createSpan({ cls: 'ochat-context-icon' });
			setIcon(icon, 'file-text');
			this.renderPathLabel(row, path);
			const close = row.createEl('button', {
				cls: 'ochat-context-remove ochat-icon-button',
				attr: { title: `Remove ${path}`, 'aria-label': `Remove ${path}` }
			});
			setIcon(close, 'x');
			close.addEventListener('click', () => {
				this.removeContextFile(path);
			});
		}

		const add = card.createEl('button', {
			cls: 'ochat-context-add',
			attr: { title: 'Attach context files' }
		});
		const addIcon = add.createSpan({ cls: 'ochat-context-icon' });
		setIcon(addIcon, 'plus');
		add.createSpan({ cls: 'ochat-context-path', text: 'Add context…' });
		add.createSpan({ cls: 'ochat-keycap', text: '@' });
		add.addEventListener('click', () => {
			this.contextOpen = true;
			this.settingsOpen = false;
			this.renderComposerSetup();
		});
	}

	private formatMessageTime(timestamp = Date.now()): string {
		return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
				void this.testEndpoint(endpointInput.value, false);
			});
		});
		actions.createEl('button', { text: 'Retry default' }, (button) => {
			button.addEventListener('click', () => {
				void this.testEndpoint('http://localhost:11434', false);
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
		const reviewHeader = reviewEl.createDiv({ cls: 'ochat-review-header' });
		const reviewIcon = reviewHeader.createSpan({ cls: 'ochat-review-icon' });
		setIcon(reviewIcon, 'square-pen');
		const reviewHeading = reviewHeader.createDiv({ cls: 'ochat-review-heading' });
		reviewHeading.createDiv({
			cls: 'ochat-review-title',
			text: `${patches.length} pending edit${patches.length === 1 ? '' : 's'}`
		});
		if (patches.length === 1) {
			const subtitle = reviewHeading.createDiv({ cls: 'ochat-review-subtitle' });
			this.renderPathLabel(subtitle, patches[0].path, 'ochat-path-label');
		} else {
			reviewHeading.createDiv({
				cls: 'ochat-review-subtitle',
				text: `${patches.length} Markdown files`
			});
		}

		for (const patch of patches) {
			const patchEl = reviewEl.createDiv({ cls: 'ochat-patch' });
			if (patches.length > 1) {
				const pathEl = patchEl.createDiv({ cls: 'ochat-patch-path' });
				this.renderPathLabel(pathEl, patch.path, 'ochat-path-label');
			}
			patchEl.createDiv({ cls: 'ochat-patch-rationale', text: patch.rationale });
			const diff = patchEl.createDiv({ cls: 'ochat-diff', attr: { 'aria-label': `Proposed changes for ${patch.path}` } });
			const variants = {
				del: { cls: 'ochat-diff-line-removed', prefix: '−' },
				add: { cls: 'ochat-diff-line-added', prefix: '+' },
				context: { cls: 'ochat-diff-line-context', prefix: ' ' }
			};
			for (const line of buildUnifiedDiff(patch.original, patch.replacement)) {
				const variant = variants[line.kind];
				const row = diff.createDiv({ cls: `ochat-diff-line ${variant.cls}` });
				row.createSpan({ cls: 'ochat-diff-prefix', text: variant.prefix });
				row.createSpan({ cls: 'ochat-diff-text', text: line.text || ' ' });
			}
		}

		const actions = reviewEl.createDiv({ cls: 'ochat-actions' });
		actions.createEl('button', { text: 'Discard' }, (button) => {
			button.addEventListener('click', () => {
				this.pendingPatches = [];
				this.renderTranscript();
			});
		});
		actions.createEl('button', { text: 'Apply', cls: 'mod-cta' }, (button) => {
			button.addEventListener('click', () => {
				void this.applyPendingPatches();
			});
		});
	}

	private renderEndpointStatus(): void {
		if (!this.statusEl) {
			return;
		}

		this.statusEl.empty();
		const endpoint = this.plugin.getEndpointClassification();
		const connection = this.statusEl.createDiv({ cls: 'ochat-status-connection' });
		const connectionIcon = connection.createSpan({ cls: 'ochat-status-icon' });
		setIcon(connectionIcon, 'plug');
		connection.createSpan({
			text: `${getProviderLabel(this.plugin.settings.provider)} · ${getEndpointLabel(this.plugin.settings.baseUrl)}`
		});

		const state = this.statusEl.createDiv({ cls: `ochat-status-state ${getViewStatusKind(this.statusMessage)}` });
		state.createSpan({ cls: 'ochat-status-dot' });
		state.createSpan({ text: this.statusMessage });

		if (endpoint.requiresAcknowledgement) {
			this.statusEl.createDiv({
				cls: 'ochat-status-warning',
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
		const token = ++this.requestToken;

		try {
			this.setStatus('Building context...');
			this.attachContextFiles(this.plugin.resolvePromptContextPaths(prompt));
			const requestPrompt =
				mode === 'edit'
					? `${prompt}\n\nReturn only JSON with a patches array. Edit only Markdown files.`
					: prompt;
			const messages = await this.plugin.buildMessages(requestPrompt, this.history, this.contextFilePaths);

			if (token !== this.requestToken) {
				return;
			}

			this.history.push({ role: 'user', content: prompt });
			this.messageTimes.push(Date.now());
			this.isAwaitingResponse = true;
			this.renderComposerAction();
			this.renderTranscript();
			this.setStatus('Waiting for model...');

			const answer = await this.plugin.chat(messages);

			if (token !== this.requestToken) {
				return;
			}

			this.isAwaitingResponse = false;
			this.renderComposerAction();

			if (mode === 'edit') {
				await this.handleEditAnswer(answer);
			} else {
				this.history.push({ role: 'assistant', ...parseAssistantResponse(answer) });
				this.messageTimes.push(Date.now());
			}

			this.setStatus('Ready.');
			this.renderTranscript();
		} catch (error) {
			if (token !== this.requestToken) {
				return;
			}

			this.isAwaitingResponse = false;
			this.renderComposerAction();
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
			this.messageTimes.push(Date.now());
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
			this.messageTimes.push(Date.now());
			return;
		}

		await this.applyPatches(patches);
	}

	private async applyPendingPatches(): Promise<void> {
		await this.applyPatches([...this.pendingPatches]);
	}

	/**
	 * Writes the given patches and records them against the transcript row so
	 * the result reads as a sentence with an undo, rather than serialized
	 * result objects.
	 */
	private async applyPatches(patches: PatchProposal[]): Promise<void> {
		if (patches.length === 0) {
			return;
		}

		try {
			const results = await this.plugin.applyPatches(patches, true);
			const applied = patches.filter((_, index) => results[index]?.status === 'applied');

			for (const result of results) {
				if (result.status === 'rejected') {
					new Notice(`Skipped ${result.path}: ${result.reason}`);
				}
			}

			this.pendingPatches = this.pendingPatches.filter((patch) => !applied.includes(patch));

			if (applied.length > 0) {
				const summary = `Applied ${applied.length} edit${applied.length === 1 ? '' : 's'}.`;
				this.appliedEdits.set(this.history.length, { patches: applied, undone: false });
				this.history.push({ role: 'assistant', content: summary });
				this.messageTimes.push(Date.now());
				this.setStatus(summary);
			}

			this.renderTranscript();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(message);
			this.setStatus(message);
		}
	}

	private async undoApplied(record: { patches: PatchProposal[]; undone: boolean }): Promise<void> {
		try {
			const inverted = [...record.patches].reverse().map(invertPatchProposal);
			const results = await this.plugin.applyPatches(inverted, true);
			const failed = results.filter((result) => result.status !== 'applied');

			if (failed.length > 0) {
				new Notice('Could not undo every edit. The note has changed since it was applied.');
				this.renderTranscript();
				return;
			}

			record.undone = true;
			this.setStatus('Reverted the applied edits.');
			this.renderTranscript();
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

		try {
			await this.plugin.discoverAvailableModels();
		} catch {
			// A failed probe is expected when no server is running; the setup
			// panel already explains what to do next.
		}

		this.render();
	}

	private async testEndpoint(baseUrl: string, completeSetup = true): Promise<void> {
		try {
			this.setStatus('Testing endpoint...');
			this.setTestResult('Testing endpoint...', 'pending');
			await this.plugin.updateBaseUrl(baseUrl);
			const models = completeSetup
				? await this.plugin.refreshAvailableModels()
				: await this.plugin.discoverAvailableModels();
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
		this.statusMessage = message;
		this.renderEndpointStatus();
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
