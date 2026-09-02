# OChat

OChat is an Obsidian plugin for chatting with local models using the active Markdown note and relevant vault context. It supports Ollama by default and OpenAI-compatible local servers such as LM Studio or llama.cpp server.

Current release: `0.1.0`.

## Features

- Right sidebar chat for active-note and vault-aware questions.
- First-run setup that checks the default Ollama endpoint and shows a model picker when local models are found.
- Ollama provider using `POST /api/chat` and `GET /api/tags`.
- OpenAI-compatible provider using `/v1/chat/completions` and `/v1/models`.
- Optional bearer-token authentication using Obsidian's secure secret storage.
- Active note, selected text, explicit `@note` attachments, and ranked Markdown vault snippets in context.
- Compact assistant composer with context chips, `@` note suggestions, Ask/Edit toggle, and icon controls.
- Rendered Markdown chat responses using Obsidian's Markdown renderer.
- Collapsed model thinking blocks for models that emit `<think>...</think>`, plus a live `thinking...` indicator while a request is running.
- Endpoint testing in the sidebar settings panel with visible success, warning, and failure states.
- Markdown edit proposals with review mode enabled by default.
- Markdown-only file writes through Obsidian APIs.

## Privacy and network use

OChat sends prompt text, active-note content, selected text, and selected vault snippets to the configured model endpoint. The default endpoint is `http://localhost:11434`.

Localhost and private LAN endpoints are allowed without extra acknowledgement. Public endpoints require an explicit acknowledgement in settings because note and vault context may leave your machine.

For an authenticated endpoint, create or select an Obsidian secret in OChat's **API key** setting. OChat stores only the secret's ID in plugin settings and adds the secret value to requests as an `Authorization: Bearer …` header. Leave the setting empty for local endpoints that do not require authentication.

OChat does not include telemetry, ads, remote assets, or an auto-update mechanism.

## Requirements

- Obsidian 1.12.7 or newer.
- Node.js 18 or newer for development.
- Ollama or another compatible local model server.

## Ollama quick start

1. Install Ollama from [ollama.com](https://ollama.com).
2. Pull a model:

```bash
ollama pull llama3.2
```

3. Confirm the local API is running:

```bash
curl http://localhost:11434/api/tags
```

4. In OChat settings, use provider `Ollama`, base URL `http://localhost:11434`, and model `llama3.2`.

When OChat opens for the first time, it also checks `http://localhost:11434` automatically. If models are found, choose one from the model picker. If Ollama is running somewhere else, enter that endpoint in the setup panel and test it.

Hosted Ollama and OpenAI-compatible endpoints can use the same setup flow: enter the base URL, select an API key secret if required, acknowledge public-network use, then test the endpoint to discover models.

## Context workflow

OChat always includes the active Markdown note and current selection when you send a prompt. The composer shows the active note as a context chip so you can see what is grounded by default.

To attach more Markdown notes, type `@` in the composer and choose a note from the suggestions, or click the plus button and search the vault. You can also type references directly, such as `@README.md`, `@"Projects/Move Plan.md"`, or `@[[Areas/Moving/00 Moving Dashboard.md]]`.

If you do not attach every relevant note, OChat still runs capped lexical search over the Markdown vault and includes ranked snippets that match your prompt, while respecting excluded folders.

## Local development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build the plugin:

```bash
npm run build
```

Install into a local vault:

```bash
npm run install-local -- "/path/to/Your Vault"
```

Then open Obsidian, enable community plugins, and enable OChat from Settings.

## Installing from a GitHub release

Until OChat is approved in the Obsidian Community directory, install it manually from a GitHub release:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create this folder in your vault: `.obsidian/plugins/ochat`.
3. Copy the downloaded files into `.obsidian/plugins/ochat`.
4. Reload Obsidian and enable OChat in Settings > Community plugins.

## Editing notes

When you ask OChat to edit notes, the model must return structured patch JSON with `path`, `original`, `replacement`, and `rationale`. OChat validates that each target is a Markdown file and that the original text appears exactly once before applying a replacement.

Review mode is on by default. With review mode enabled, proposed edits are shown in the OChat sidebar and require approval. If you turn review mode off, valid Markdown patches are applied automatically.

## License

MIT
