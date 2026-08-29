import { ItemView, MarkdownRenderer, Menu, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import { parseAssistantResponse } from './assistant-response';
import { getComposerPanel, toggleToolsPanel } from './composer-tools';
import { OCHAT_DISPLAY_NAME, OCHAT_VIEW_TYPE } from './constants';
import { buildUnifiedDiff, summarizeDiff } from './diff';
import { shouldSubmitPromptKey } from './keyboard';
import { getModelSelectOptions } from './model-options';
import type OChatPlugin from './main';
import { resolveSubmitMode } from './modes';
import { invertPatchProposal, parsePatchProposals } from './patches';
import { splitPathLabel } from './path-label';
import type { ChatMessage, ComposerMode, PatchProposal } from './types';
import type { SubmitMode } from './modes';

type TranscriptEntry =
	| { kind: 'message'; message: ChatMessage }
	| { kind: 'applied'; patches: PatchProposal[]; undone: boolean };

type ConnectionState = 'ok' | 'warn' | 'off';

export class OChatView extends ItemView {
	private readonly plugin: OChatPlugin;
	private entries: TranscriptEntry[] = [];
	private pendingPatches: PatchProposal[] = [];
	private transcriptEl: HTMLElement | null = null;
	private alertsEl: HTMLElement | null = null;
	private sheetEl: HTMLElement | null = null;
	private promptEl: HTMLTextAreaElement | null = null;
	private contextStripEl: HTMLElement | null = null;
	private mentionSuggestionsEl: HTMLElement | null = null;
	private footerActionEl: HTMLElement | null = null;
	private modelPillEl: HTMLElement | null = null;
	private testResultEl: HTMLElement | null = null;
	private isAwaitingResponse = false;
	private requestToken = 0;
	private onboardingProbeStarted = false;
	private headerActionsAdded = false;
	private contextOpen = false;
	private settingsOpen = false;
	private contextFilePaths: string[] = [];
	private contextSearchQuery = '';
	private vaultSnippetCount = 0;
	private errorMessage: string | null = null;

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
		this.addHeaderActions();
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
		this.entries = [];
		this.pendingPatches = [];
		this.errorMessage = null;
		this.vaultSnippetCount = 0;
		this.requestToken++;
		this.isAwaitingResponse = false;
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

	/**
	 * New chat and settings live in the pane header rather than the composer
	 * footer, which cannot fit six controls at sidebar width.
	 */
	private addHeaderActions(): void {
		if (this.headerActionsAdded) {
			return;
		}

		this.headerActionsAdded = true;
		this.addAction('message-square-plus', 'New chat', () => {
			this.clearConversation();
		});
		this.addAction('settings', 'Connection settings', () => {
			this.toggleSheet('settings');
		});
	}

	private get history(): ChatMessage[] {
		return this.entries
			.filter((entry): entry is { kind: 'message'; message: ChatMessage } => entry.kind === 'message')
			.map((entry) => entry.message);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('ochat-view');

		this.transcriptEl = contentEl.createDiv({ cls: 'ochat-transcript' });
		this.renderTranscript();

		this.alertsEl = contentEl.createDiv({ cls: 'ochat-alerts' });
		this.renderAlerts();

		this.sheetEl = contentEl.createDiv({ cls: 'ochat-sheet-host' });
		this.mentionSuggestionsEl = contentEl.createDiv({ cls: 'ochat-mention-suggestions' });

		const composer = contentEl.createDiv({ cls: 'ochat-composer' });
		this.contextStripEl = composer.createDiv({ cls: 'ochat-context-strip' });
		this.renderContextStrip();

		this.promptEl = composer.createEl('textarea', {
			cls: 'ochat-prompt',
			attr: {
				placeholder: 'Ask about this note, or @ to add context',
				rows: '3'
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

		const footer = composer.createDiv({ cls: 'ochat-composer-footer' });
		this.createIconButton(footer, 'plus', 'Add context files', () => {
			this.toggleSheet('context');
		});
		this.modelPillEl = footer.createDiv({ cls: 'ochat-model-pill-host' });
		this.renderModelPill();
		this.renderModeToggle(footer, this.plugin.settings.composerMode, async (mode) => {
			await this.plugin.selectComposerMode(mode);
		});
		footer.createDiv({ cls: 'ochat-footer-spacer' });
		this.footerActionEl = footer.createDiv({ cls: 'ochat-footer-action' });
		this.renderFooterAction();

		this.renderSheet();
	}

	private createIconButton(
		containerEl: HTMLElement,
		icon: string,
		title: string,
		onClick: (event: MouseEvent) => void,
		cls = 'clickable-icon ochat-icon-button'
	): HTMLButtonElement {
		const button = containerEl.createEl('button', {
			cls,
			attr: {
				type: 'button',
				title,
				'aria-label': title
			}
		});
		setIcon(button, icon);
		button.addEventListener('click', onClick);
		return button;
	}

	// --- transcript -------------------------------------------------------

	private renderTranscript(): void {
		if (!this.transcriptEl) {
			return;
		}

		this.transcriptEl.empty();
		const panel = getComposerPanel({
			onboardingRequired: this.plugin.needsOnboarding(),
			settingsOpen: this.settingsOpen,
			contextOpen: this.contextOpen
		});

		if (this.plugin.needsOnboarding() && panel !== 'settings') {
			this.renderOnboardingCard(this.transcriptEl);
		} else if (this.entries.length === 0 && this.pendingPatches.length === 0 && !this.isAwaitingResponse) {
			this.renderEmptyState(this.transcriptEl);
		}

		this.entries.forEach((entry, index) => {
			if (entry.kind === 'applied') {
				this.renderAppliedEntry(entry);
				return;
			}

			if (entry.message.role === 'user') {
				this.transcriptEl?.createDiv({ cls: 'ochat-turn-user', text: entry.message.content });
				return;
			}

			this.renderAssistantTurn(entry.message, index);
		});

		if (this.isAwaitingResponse) {
			this.renderThinkingIndicator();
		}

		if (this.pendingPatches.length > 0) {
			this.renderPatchReview(this.pendingPatches);
		}

		this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
	}

	private renderEmptyState(containerEl: HTMLElement): void {
		const empty = containerEl.createDiv({ cls: 'ochat-empty' });
		const badge = empty.createDiv({ cls: 'ochat-empty-badge' });
		setIcon(badge, 'message-square-plus');
		empty.createDiv({ cls: 'ochat-empty-title', text: 'Ask about this note' });
		empty.createDiv({
			cls: 'ochat-empty-body',
			text: 'OChat always sees the note you have open and the text you have selected. Type @ to add more notes.'
		});

		const suggestions = empty.createDiv({ cls: 'ochat-suggestions' });
		this.createSuggestion(suggestions, 'file-text', 'Summarize this note', () => {
			void this.askActiveNote();
		});
		this.createSuggestion(suggestions, 'pencil-line', 'Propose edits to this note', () => {
			void this.editActiveNote();
		});

		empty.createDiv({
			cls: 'ochat-empty-footnote',
			text: 'Also in the command palette, as Ask about active note and Edit active note.'
		});
	}

	private createSuggestion(
		containerEl: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void
	): void {
		const button = containerEl.createEl('button', { cls: 'ochat-suggestion', attr: { type: 'button' } });
		const iconEl = button.createSpan({ cls: 'ochat-suggestion-icon' });
		setIcon(iconEl, icon);
		button.createSpan({ cls: 'ochat-suggestion-label', text: label });
		button.addEventListener('click', onClick);
	}

	private renderAssistantTurn(message: ChatMessage, index: number): void {
		if (!this.transcriptEl) {
			return;
		}

		const turn = this.transcriptEl.createDiv({ cls: 'ochat-turn-assistant' });

		if (message.thinking?.trim()) {
			const details = turn.createEl('details', { cls: 'ochat-thinking' });
			details.createEl('summary', { text: 'Thinking' });
			details.createEl('pre', { text: message.thinking.trim() });
		}

		if (!message.content.trim()) {
			return;
		}

		const markdownEl = turn.createDiv({ cls: 'ochat-markdown markdown-rendered' });
		void MarkdownRenderer.render(this.app, message.content, markdownEl, '', this);

		const actions = turn.createDiv({ cls: 'ochat-turn-actions' });
		this.createIconButton(actions, 'copy', 'Copy answer', () => {
			void navigator.clipboard.writeText(message.content).then(() => {
				new Notice('Copied to clipboard.');
			});
		});
		this.createIconButton(actions, 'rotate-ccw', 'Try again', () => {
			void this.retryFrom(index);
		});
		this.createIconButton(actions, 'pencil-line', 'Insert into note', () => {
			this.insertIntoActiveNote(message.content);
		});
	}

	private renderThinkingIndicator(): void {
		if (!this.transcriptEl) {
			return;
		}

		const turn = this.transcriptEl.createDiv({ cls: 'ochat-turn-assistant' });
		const live = turn.createDiv({ cls: 'ochat-thinking-live' });
		live.createSpan({ text: 'Thinking' });
		const dots = live.createSpan({ cls: 'ochat-thinking-dots' });
		dots.createSpan();
		dots.createSpan();
		dots.createSpan();
	}

	private renderAppliedEntry(entry: { kind: 'applied'; patches: PatchProposal[]; undone: boolean }): void {
		if (!this.transcriptEl) {
			return;
		}

		const row = this.transcriptEl.createDiv({ cls: 'ochat-applied' });
		const icon = row.createSpan({ cls: 'ochat-applied-icon' });
		setIcon(icon, entry.undone ? 'rotate-ccw' : 'check');

		const count = entry.patches.length;
		const paths = [...new Set(entry.patches.map((patch) => patch.path))];
		row.createSpan({
			cls: 'ochat-applied-label',
			text: entry.undone
				? `Reverted ${count} edit${count === 1 ? '' : 's'}`
				: `Applied ${count} edit${count === 1 ? '' : 's'}`
		});
		row.createSpan({ cls: 'ochat-applied-separator', text: '·' });

		if (paths.length === 1) {
			const link = row.createEl('a', { cls: 'ochat-applied-link', href: '#', text: paths[0] });
			link.addEventListener('click', (event) => {
				event.preventDefault();
				void this.app.workspace.openLinkText(paths[0], '', false);
			});
		} else {
			row.createSpan({ cls: 'ochat-applied-link', text: `${paths.length} files` });
		}

		row.createDiv({ cls: 'ochat-footer-spacer' });

		if (!entry.undone) {
			const undo = row.createEl('button', { cls: 'ochat-ghost-button', attr: { type: 'button' } });
			const undoIcon = undo.createSpan({ cls: 'ochat-ghost-icon' });
			setIcon(undoIcon, 'undo-2');
			undo.createSpan({ text: 'Undo' });
			undo.addEventListener('click', () => {
				void this.undoApplied(entry);
			});
		}
	}

	// --- patch review -----------------------------------------------------

	private renderPatchReview(patches: PatchProposal[]): void {
		if (!this.transcriptEl) {
			return;
		}

		const review = this.transcriptEl.createDiv({ cls: 'ochat-review' });
		const head = review.createDiv({ cls: 'ochat-review-head' });
		const headIcon = head.createSpan({ cls: 'ochat-review-icon' });
		setIcon(headIcon, 'pencil-line');
		head.createSpan({
			cls: 'ochat-review-title',
			text: `${patches.length} proposed edit${patches.length === 1 ? '' : 's'}`
		});
		head.createDiv({ cls: 'ochat-footer-spacer' });
		head.createSpan({ cls: 'ochat-review-hint', text: 'Review before applying' });

		for (const patch of patches) {
			this.renderPatchCard(review, patch);
		}

		const actions = review.createDiv({ cls: 'ochat-review-actions' });
		actions.createEl('button', { text: 'Apply all', cls: 'mod-cta' }, (button) => {
			button.addEventListener('click', () => {
				void this.applyPatches([...this.pendingPatches]);
			});
		});
		actions.createEl('button', { text: 'Discard' }, (button) => {
			button.addEventListener('click', () => {
				this.pendingPatches = [];
				this.renderTranscript();
			});
		});
		actions.createDiv({ cls: 'ochat-footer-spacer' });
		actions.createSpan({ cls: 'ochat-review-hint', text: 'Markdown files only' });
	}

	private renderPatchCard(containerEl: HTMLElement, patch: PatchProposal): void {
		const card = containerEl.createDiv({ cls: 'ochat-patch' });

		const pathRow = card.createDiv({ cls: 'ochat-patch-path' });
		const pathIcon = pathRow.createSpan({ cls: 'ochat-patch-icon' });
		setIcon(pathIcon, 'file-text');
		const label = splitPathLabel(patch.path);
		const pathLabel = pathRow.createSpan({ cls: 'ochat-path-label' });
		if (label.folder) {
			pathLabel.createSpan({ cls: 'ochat-path-folder', text: label.folder });
		}
		pathLabel.createSpan({ cls: 'ochat-path-name', text: label.name });

		const lines = buildUnifiedDiff(patch.original, patch.replacement);
		const stats = summarizeDiff(lines);
		pathRow.createDiv({ cls: 'ochat-footer-spacer' });
		if (stats.added > 0) {
			pathRow.createSpan({ cls: 'ochat-stat ochat-stat-add', text: `+${stats.added}` });
		}
		if (stats.removed > 0) {
			pathRow.createSpan({ cls: 'ochat-stat ochat-stat-del', text: `-${stats.removed}` });
		}

		if (patch.rationale.trim()) {
			card.createDiv({ cls: 'ochat-patch-rationale', text: patch.rationale });
		}

		const diff = card.createDiv({ cls: 'ochat-diff' });
		for (const line of lines) {
			diff.createDiv({ cls: `ochat-diff-line ochat-diff-${line.kind}`, text: line.text || ' ' });
		}

		const actions = card.createDiv({ cls: 'ochat-patch-actions' });
		actions.createEl('button', { text: 'Apply' }, (button) => {
			button.addEventListener('click', () => {
				void this.applyPatches([patch]);
			});
		});
		actions.createEl('button', { text: 'Skip', cls: 'ochat-ghost-button' }, (button) => {
			button.addEventListener('click', () => {
				this.pendingPatches = this.pendingPatches.filter((item) => item !== patch);
				this.renderTranscript();
			});
		});
	}

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
				this.entries.push({ kind: 'applied', patches: applied, undone: false });
			}

			this.renderTranscript();
		} catch (error) {
			this.reportError(error);
		}
	}

	private async undoApplied(entry: { patches: PatchProposal[]; undone: boolean }): Promise<void> {
		try {
			const inverted = [...entry.patches].reverse().map(invertPatchProposal);
			const results = await this.plugin.applyPatches(inverted, true);
			const failed = results.filter((result) => result.status !== 'applied');

			if (failed.length > 0) {
				new Notice('Could not undo every edit. The note has changed since it was applied.');
				this.renderTranscript();
				return;
			}

			entry.undone = true;
			this.renderTranscript();
		} catch (error) {
			this.reportError(error);
		}
	}

	// --- composer chrome --------------------------------------------------

	private renderContextStrip(): void {
		if (!this.contextStripEl) {
			return;
		}

		this.contextStripEl.empty();
		const activePath = this.plugin.getActiveMarkdownPath();

		if (activePath) {
			const chip = this.contextStripEl.createSpan({
				cls: 'ochat-chip ochat-chip-active',
				attr: { title: activePath }
			});
			this.renderChipIcon(chip, 'file-text');
			this.renderChipPath(chip, activePath);
		}

		for (const path of this.getAttachedContextPaths()) {
			const chip = this.contextStripEl.createEl('button', {
				cls: 'ochat-chip ochat-chip-attached',
				attr: { type: 'button', title: `Remove ${path}` }
			});
			this.renderChipIcon(chip, 'at-sign');
			this.renderChipPath(chip, path);
			const close = chip.createSpan({ cls: 'ochat-chip-remove' });
			setIcon(close, 'x');
			chip.addEventListener('click', () => {
				this.removeContextFile(path);
			});
		}

		if (this.plugin.settings.maxVaultResults > 0) {
			const chip = this.contextStripEl.createSpan({
				cls: 'ochat-chip ochat-chip-vault',
				attr: { title: 'Ranked Markdown snippets from the rest of the vault' }
			});
			this.renderChipIcon(chip, 'search');
			chip.createSpan({ cls: 'ochat-chip-text', text: 'Vault search' });
			if (this.vaultSnippetCount > 0) {
				chip.createSpan({ cls: 'ochat-chip-count', text: String(this.vaultSnippetCount) });
			}
		}
	}

	private renderChipIcon(chip: HTMLElement, icon: string): void {
		const iconEl = chip.createSpan({ cls: 'ochat-chip-icon' });
		setIcon(iconEl, icon);
	}

	/** The folder is dimmed and truncates first, so the file name survives. */
	private renderChipPath(chip: HTMLElement, path: string): void {
		const label = splitPathLabel(path);
		const wrapper = chip.createSpan({ cls: 'ochat-path-label' });
		if (label.folder) {
			wrapper.createSpan({ cls: 'ochat-path-folder', text: label.folder });
		}
		wrapper.createSpan({ cls: 'ochat-path-name', text: label.name });
	}

	private getConnectionState(): ConnectionState {
		if (this.plugin.needsOnboarding()) {
			return 'off';
		}

		const endpoint = this.plugin.getEndpointClassification();
		if (endpoint.requiresAcknowledgement && !this.plugin.settings.remoteEndpointAcknowledged) {
			return 'warn';
		}

		return this.plugin.settings.availableModels.length === 0 ? 'warn' : 'ok';
	}

	/**
	 * Replaces the always-visible endpoint line. The dot carries connection
	 * state and the endpoint itself is one hover (or one sheet) away.
	 */
	private renderModelPill(): void {
		if (!this.modelPillEl) {
			return;
		}

		this.modelPillEl.empty();
		const model = this.plugin.settings.model;
		const pill = this.modelPillEl.createEl('button', {
			cls: 'ochat-model-pill',
			attr: {
				type: 'button',
				title: `${this.plugin.settings.provider} · ${this.plugin.settings.baseUrl}`,
				'aria-label': 'Model'
			}
		});
		pill.createSpan({ cls: `ochat-status-dot ochat-status-${this.getConnectionState()}` });
		pill.createSpan({ cls: 'ochat-model-name', text: model.length > 0 ? model : 'No model' });
		const chevron = pill.createSpan({ cls: 'ochat-model-chevron' });
		setIcon(chevron, 'chevron-down');
		pill.addEventListener('click', (event) => {
			this.showModelMenu(event);
		});
	}

	private showModelMenu(event: MouseEvent): void {
		const menu = new Menu();
		const models = this.plugin.settings.availableModels;

		if (models.length === 0) {
			menu.addItem((item) => item.setTitle('No models found').setDisabled(true));
		}

		for (const model of models) {
			menu.addItem((item) =>
				item
					.setTitle(model)
					.setChecked(model === this.plugin.settings.model)
					.onClick(() => {
						void this.plugin.selectModel(model).then(() => {
							this.renderModelPill();
							this.renderTranscript();
						});
					})
			);
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Refresh models')
				.setIcon('refresh-cw')
				.onClick(() => {
					void this.refreshModels();
				})
		);
		menu.addItem((item) =>
			item
				.setTitle('Connection settings')
				.setIcon('settings')
				.onClick(() => {
					this.toggleSheet('settings');
				})
		);
		menu.showAtMouseEvent(event);
	}

	private renderFooterAction(): void {
		if (!this.footerActionEl) {
			return;
		}

		this.footerActionEl.empty();

		if (this.isAwaitingResponse) {
			this.createIconButton(
				this.footerActionEl,
				'square',
				'Stop',
				() => {
					this.stopRequest();
				},
				'ochat-icon-button ochat-stop-button'
			);
			return;
		}

		this.createIconButton(
			this.footerActionEl,
			'send',
			'Send',
			() => {
				void this.submitFromComposer();
			},
			'ochat-icon-button ochat-send-button mod-cta'
		);
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

	// --- alerts and sheets ------------------------------------------------

	private renderAlerts(): void {
		if (!this.alertsEl) {
			return;
		}

		this.alertsEl.empty();
		const endpoint = this.plugin.getEndpointClassification();

		if (endpoint.requiresAcknowledgement && !this.plugin.settings.remoteEndpointAcknowledged) {
			this.createAlert('alert-triangle', endpoint.reason, 'warning');
		}

		if (this.errorMessage) {
			this.createAlert('alert-triangle', this.errorMessage, 'error', () => {
				this.errorMessage = null;
				this.renderAlerts();
			});
		}
	}

	private createAlert(
		icon: string,
		text: string,
		kind: 'warning' | 'error',
		onDismiss?: () => void
	): void {
		const alert = this.alertsEl?.createDiv({ cls: `ochat-alert ochat-alert-${kind}` });
		if (!alert) {
			return;
		}

		const iconEl = alert.createSpan({ cls: 'ochat-alert-icon' });
		setIcon(iconEl, icon);
		alert.createSpan({ cls: 'ochat-alert-text', text });

		if (onDismiss) {
			this.createIconButton(alert, 'x', 'Dismiss', onDismiss);
		}
	}

	private toggleSheet(sheet: 'settings' | 'context'): void {
		if (sheet === 'settings') {
			this.settingsOpen = !this.settingsOpen;
			this.contextOpen = false;
		} else {
			this.contextOpen = toggleToolsPanel(this.contextOpen);
			this.settingsOpen = false;
		}

		this.renderSheet();
		this.renderTranscript();
	}

	private closeSheet(): void {
		this.settingsOpen = false;
		this.contextOpen = false;
		this.renderSheet();
		this.renderTranscript();
	}

	/** Sheets sit above the composer so opening one never moves the input. */
	private renderSheet(): void {
		if (!this.sheetEl) {
			return;
		}

		this.sheetEl.empty();
		const panel = getComposerPanel({
			onboardingRequired: this.plugin.needsOnboarding(),
			settingsOpen: this.settingsOpen,
			contextOpen: this.contextOpen
		});

		if (panel !== 'settings' && panel !== 'context') {
			return;
		}

		const sheet = this.sheetEl.createDiv({ cls: 'ochat-sheet' });
		const head = sheet.createDiv({ cls: 'ochat-sheet-head' });
		head.createSpan({
			cls: 'ochat-sheet-title',
			text: panel === 'settings' ? 'Connection' : 'Attach context'
		});
		head.createDiv({ cls: 'ochat-footer-spacer' });
		this.createIconButton(head, 'x', 'Close', () => {
			this.closeSheet();
		});

		const body = sheet.createDiv({ cls: 'ochat-sheet-body' });
		if (panel === 'settings') {
			this.renderSettingsSheet(body);
			return;
		}

		this.renderContextSheet(body);
	}

	private renderSettingsSheet(containerEl: HTMLElement): void {
		const endpointRow = containerEl.createDiv({ cls: 'ochat-field' });
		endpointRow.createDiv({ cls: 'ochat-field-label', text: 'Endpoint' });
		const endpointInput = endpointRow.createEl('input', {
			type: 'text',
			value: this.plugin.settings.baseUrl,
			cls: 'ochat-endpoint-input'
		});

		const modelRow = containerEl.createDiv({ cls: 'ochat-field' });
		modelRow.createDiv({ cls: 'ochat-field-label', text: 'Default model' });
		const modelSelect = modelRow.createEl('select', {
			cls: 'dropdown ochat-model-select',
			attr: { title: 'Default model' }
		});
		for (const option of getModelSelectOptions(this.plugin.settings.model, this.plugin.settings.availableModels)) {
			modelSelect.createEl('option', { text: option.label, value: option.value });
		}
		modelSelect.value = this.plugin.settings.model;

		const actions = containerEl.createDiv({ cls: 'ochat-actions' });
		actions.createEl('button', { text: 'Test connection', cls: 'mod-cta' }, (button) => {
			button.addEventListener('click', () => {
				void this.testEndpoint(endpointInput.value, true);
			});
		});
		actions.createEl('button', { text: 'Refresh models' }, (button) => {
			button.addEventListener('click', () => {
				void this.refreshModels();
			});
		});
		actions.createEl('button', { text: 'Save' }, (button) => {
			button.addEventListener('click', () => {
				void this.saveComposerSettings(endpointInput.value, modelSelect.value);
			});
		});

		this.testResultEl = containerEl.createDiv({ cls: 'ochat-test-result' });

		containerEl.createDiv({ cls: 'ochat-divider' });

		const toggleRow = containerEl.createDiv({ cls: 'ochat-toggle-row' });
		const copy = toggleRow.createDiv({ cls: 'ochat-toggle-copy' });
		copy.createDiv({ cls: 'ochat-toggle-title', text: 'Review edits' });
		copy.createDiv({
			cls: 'ochat-toggle-body',
			text: 'Show proposed Markdown changes before writing them.'
		});
		const toggle = toggleRow.createDiv({
			cls: `checkbox-container${this.plugin.settings.reviewMode ? ' is-enabled' : ''}`,
			attr: { role: 'checkbox', tabindex: '0', 'aria-checked': String(this.plugin.settings.reviewMode) }
		});
		toggle.createEl('input', { type: 'checkbox' });
		toggle.addEventListener('click', () => {
			void this.setReviewMode(!this.plugin.settings.reviewMode);
		});

		containerEl.createDiv({ cls: 'ochat-divider' });
		containerEl.createDiv({
			cls: 'ochat-sheet-footnote',
			text: 'Provider, excluded folders and context limits live in Settings → Community plugins → OChat.'
		});
	}

	private renderContextSheet(containerEl: HTMLElement): void {
		if (this.contextFilePaths.length === 0) {
			containerEl.createDiv({ cls: 'ochat-muted', text: 'No extra files attached.' });
		} else {
			const list = containerEl.createDiv({ cls: 'ochat-context-list' });
			for (const path of this.contextFilePaths) {
				const row = list.createDiv({ cls: 'ochat-context-file' });
				const label = row.createSpan({ cls: 'ochat-path-label' });
				const parts = splitPathLabel(path);
				if (parts.folder) {
					label.createSpan({ cls: 'ochat-path-folder', text: parts.folder });
				}
				label.createSpan({ cls: 'ochat-path-name', text: parts.name });
				this.createIconButton(row, 'x', `Remove ${path}`, () => {
					this.removeContextFile(path);
				});
			}
		}

		const searchInput = containerEl.createEl('input', {
			type: 'text',
			value: this.contextSearchQuery,
			cls: 'ochat-context-search',
			attr: { placeholder: 'Search Markdown notes' }
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
					cls: 'ochat-result',
					attr: { type: 'button', title: path }
				});
				const parts = splitPathLabel(path);
				const label = button.createSpan({ cls: 'ochat-path-label' });
				if (parts.folder) {
					label.createSpan({ cls: 'ochat-path-folder', text: parts.folder });
				}
				label.createSpan({ cls: 'ochat-path-name', text: parts.name });
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

		if (this.contextFilePaths.length > 0) {
			const actions = containerEl.createDiv({ cls: 'ochat-actions' });
			actions.createEl('button', { text: 'Clear files', cls: 'ochat-ghost-button' }, (button) => {
				button.addEventListener('click', () => {
					this.contextFilePaths = [];
					this.renderSheet();
					this.renderContextStrip();
				});
			});
		}
	}

	private renderOnboardingCard(containerEl: HTMLElement): void {
		const card = containerEl.createDiv({ cls: 'ochat-setup' });
		const head = card.createDiv({ cls: 'ochat-setup-head' });
		const icon = head.createSpan({ cls: 'ochat-setup-icon' });
		setIcon(icon, 'cpu');
		head.createSpan({ cls: 'ochat-setup-title', text: 'Connect a local model' });
		card.createDiv({
			cls: 'ochat-setup-body',
			text: 'Nothing leaves your machine. OChat talks to a model server you run yourself.'
		});

		const endpointRow = card.createDiv({ cls: 'ochat-field' });
		endpointRow.createDiv({ cls: 'ochat-field-label', text: 'Endpoint' });
		const endpointInput = endpointRow.createEl('input', {
			type: 'text',
			value: this.plugin.settings.baseUrl,
			cls: 'ochat-endpoint-input'
		});

		this.testResultEl = card.createDiv({ cls: 'ochat-test-result' });

		const models = this.plugin.settings.availableModels;
		if (models.length > 0) {
			card.createDiv({ cls: 'ochat-field-label', text: 'Choose a model' });
			const list = card.createDiv({ cls: 'ochat-model-list' });
			for (const model of models) {
				const option = list.createEl('button', {
					cls: `ochat-model-option${model === this.plugin.settings.model ? ' is-selected' : ''}`,
					attr: { type: 'button' }
				});
				option.createSpan({ cls: 'ochat-radio' });
				option.createSpan({ cls: 'ochat-model-option-name', text: model });
				option.addEventListener('click', () => {
					void this.plugin.selectModel(model).then(() => {
						this.renderTranscript();
						this.renderModelPill();
					});
				});
			}
		}

		const actions = card.createDiv({ cls: 'ochat-actions' });
		if (models.length > 0) {
			actions.createEl('button', { text: 'Start chatting', cls: 'mod-cta' }, (button) => {
				button.addEventListener('click', () => {
					void this.completeOnboarding();
				});
			});
			actions.createEl('button', { text: 'Test again' }, (button) => {
				button.addEventListener('click', () => {
					void this.testEndpoint(endpointInput.value, false);
				});
			});
		} else {
			actions.createEl('button', { text: 'Test connection', cls: 'mod-cta' }, (button) => {
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

		card.createDiv({
			cls: 'ochat-setup-footnote',
			text: 'No Ollama yet? Install it, run ollama pull llama3.2, then test again.'
		});
	}

	// --- requests ---------------------------------------------------------

	private async saveComposerSettings(baseUrl: string, model: string): Promise<void> {
		try {
			if (baseUrl.trim() !== this.plugin.settings.baseUrl) {
				await this.plugin.updateBaseUrl(baseUrl);
			}
			await this.plugin.selectModel(model);
			this.errorMessage = null;
			this.closeSheet();
			this.render();
		} catch (error) {
			this.reportError(error);
		}
	}

	private async setReviewMode(enabled: boolean): Promise<void> {
		this.plugin.settings.reviewMode = enabled;
		await this.plugin.saveSettings();
		this.renderSheet();
	}

	private insertIntoActiveNote(content: string): void {
		const editor = this.app.workspace.activeEditor?.editor;

		if (!editor) {
			new Notice('Open a Markdown note to insert into.');
			return;
		}

		editor.replaceSelection(content);
		new Notice('Inserted into the active note.');
	}

	private async retryFrom(index: number): Promise<void> {
		let promptIndex = -1;

		for (let cursor = index - 1; cursor >= 0; cursor--) {
			const entry = this.entries[cursor];
			if (entry.kind === 'message' && entry.message.role === 'user') {
				promptIndex = cursor;
				break;
			}
		}

		if (promptIndex === -1) {
			return;
		}

		const entry = this.entries[promptIndex];
		const prompt = entry.kind === 'message' ? entry.message.content : '';
		this.entries = this.entries.slice(0, promptIndex);
		await this.submitPrompt(prompt, resolveSubmitMode(this.plugin.settings.composerMode, prompt));
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

		this.renderMentionSuggestions();
		const mode = resolveSubmitMode(this.plugin.settings.composerMode, prompt);
		await this.submitPrompt(prompt, mode);
	}

	/**
	 * Obsidian's requestUrl has no abort signal, so Stop cannot cancel the
	 * network call. It releases the composer and discards whatever comes back
	 * for a superseded token.
	 */
	private stopRequest(): void {
		if (!this.isAwaitingResponse) {
			return;
		}

		this.requestToken++;
		this.isAwaitingResponse = false;
		this.renderFooterAction();
		this.renderTranscript();
	}

	private async submitPrompt(prompt: string, mode: SubmitMode): Promise<void> {
		const token = ++this.requestToken;

		try {
			this.errorMessage = null;
			this.attachContextFiles(this.plugin.resolvePromptContextPaths(prompt));
			const requestPrompt =
				mode === 'edit'
					? `${prompt}\n\nReturn only JSON with a patches array. Edit only Markdown files.`
					: prompt;
			const built = await this.plugin.buildMessages(requestPrompt, this.history, this.contextFilePaths);

			if (token !== this.requestToken) {
				return;
			}

			this.vaultSnippetCount = built.vaultSnippetCount;
			this.entries.push({ kind: 'message', message: { role: 'user', content: prompt } });
			this.isAwaitingResponse = true;
			this.renderFooterAction();
			this.renderContextStrip();
			this.renderTranscript();

			const answer = await this.plugin.chat(built.messages);

			if (token !== this.requestToken) {
				return;
			}

			this.isAwaitingResponse = false;
			this.renderFooterAction();

			if (mode === 'edit') {
				await this.handleEditAnswer(answer);
			} else {
				this.entries.push({ kind: 'message', message: { role: 'assistant', ...parseAssistantResponse(answer) } });
			}

			this.renderAlerts();
			this.renderTranscript();
		} catch (error) {
			if (token !== this.requestToken) {
				return;
			}

			this.isAwaitingResponse = false;
			this.renderFooterAction();
			this.reportError(error);
			this.renderTranscript();
		}
	}

	private async handleEditAnswer(answer: string): Promise<void> {
		const parsed = parseAssistantResponse(answer);
		const patches = parsePatchProposals(parsed.content);

		if (patches.length === 0) {
			this.entries.push({ kind: 'message', message: { role: 'assistant', ...parsed } });
			new Notice('The model did not return valid patch JSON.');
			return;
		}

		if (this.plugin.settings.reviewMode) {
			this.pendingPatches = patches;
			if (parsed.thinking?.trim()) {
				this.entries.push({
					kind: 'message',
					message: { role: 'assistant', content: '', thinking: parsed.thinking }
				});
			}
			return;
		}

		await this.applyPatches(patches);
	}

	async refreshModels(): Promise<void> {
		try {
			const models = await this.plugin.refreshAvailableModels();
			this.errorMessage = null;
			new Notice(models.length > 0 ? `Found ${models.length} model${models.length === 1 ? '' : 's'}.` : 'No models were returned.');
			this.render();
		} catch (error) {
			this.reportError(error);
			this.render();
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
			// card already explains what to do next.
		}

		this.render();
	}

	private async testEndpoint(baseUrl: string, completeSetup: boolean): Promise<void> {
		try {
			this.setTestResult('Testing endpoint...', 'pending');
			await this.plugin.updateBaseUrl(baseUrl);
			const models = completeSetup
				? await this.plugin.refreshAvailableModels()
				: await this.plugin.discoverAvailableModels();
			const message =
				models.length > 0
					? `Connected · ${models.length} model${models.length === 1 ? '' : 's'} found`
					: 'Connected, but no models were returned';
			this.errorMessage = null;
			this.render();
			this.setTestResult(message, models.length > 0 ? 'success' : 'warning');
			new Notice(message);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.render();
			this.setTestResult(`Could not reach the endpoint. ${message}`, 'error');
			new Notice(`Could not reach the endpoint. ${message}`);
		}
	}

	private async completeOnboarding(): Promise<void> {
		await this.plugin.selectModel(this.plugin.settings.model);
		this.render();
	}

	private reportError(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.errorMessage = message;
		this.renderAlerts();
		new Notice(message);
	}

	private setTestResult(message: string, kind: 'pending' | 'success' | 'warning' | 'error'): void {
		if (!this.testResultEl) {
			return;
		}

		this.testResultEl.empty();
		this.testResultEl.className = `ochat-test-result ochat-test-result-${kind}`;
		const icon = this.testResultEl.createSpan({ cls: 'ochat-test-icon' });
		setIcon(icon, kind === 'success' ? 'check' : kind === 'pending' ? 'loader' : 'alert-triangle');
		this.testResultEl.createSpan({ text: message });
	}

	// --- mentions ---------------------------------------------------------

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
				cls: 'ochat-result',
				attr: { type: 'button', title: path }
			});
			const parts = splitPathLabel(path);
			const label = button.createSpan({ cls: 'ochat-path-label' });
			if (parts.folder) {
				label.createSpan({ cls: 'ochat-path-folder', text: parts.folder });
			}
			label.createSpan({ cls: 'ochat-path-name', text: parts.name });
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
		this.renderSheet();
		this.renderContextStrip();
	}

	private removeContextFile(path: string): void {
		this.contextFilePaths = this.contextFilePaths.filter((item) => item !== path);
		this.renderSheet();
		this.renderContextStrip();
	}

	private getAttachedContextPaths(): string[] {
		const activePath = this.plugin.getActiveMarkdownPath();
		return this.contextFilePaths.filter((path) => path !== activePath);
	}
}
