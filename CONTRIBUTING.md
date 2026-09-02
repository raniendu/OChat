# Contributing to OChat

Thanks for helping improve OChat. Keep changes focused, preserve the plugin's local-first defaults, and avoid exposing vault content or credentials.

## Before opening a pull request

1. Search the existing issues and open one for substantial behavior changes.
2. Install dependencies with `npm install`.
3. Make the smallest change that solves the problem and add regression tests for behavior changes.
4. Run:

```bash
npm test
npm run lint
npm run build
```

## Pull requests

- Explain the user-visible behavior and any privacy or network impact.
- Include screenshots for interface changes.
- Never commit API keys, vault content, or other private data.
- Keep unrelated refactors out of the pull request.
- Confirm that local Ollama still works without credentials when changing provider code.

## Releases

Release tags must exactly match the version in `manifest.json`. The release workflow installs dependencies, tests, lints, builds the plugin, generates provenance attestations for the release assets, and publishes `main.js`, `manifest.json`, and `styles.css`.

When preparing a release, update `package.json`, run `npm run version` to synchronize `manifest.json` and `versions.json`, and add the release notes before creating the matching tag.
