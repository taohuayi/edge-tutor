# Edge Tutor

> Turn a question in an Obsidian note into an explorable learning path — with source anchors, branching conversations, and a durable knowledge map.

**Edge Tutor is an early, Chinese-first Obsidian plugin for deliberate learning with your own notes and AI provider.** It is built for learners who do not want an AI chat to disappear after one answer.

## What it does

- Ask from selected text in any note and keep a source anchor to the original passage.
- Explore a question as a branching conversation rather than a flat chat log.
- Save useful exchanges into a navigable cognitive map inside your vault.
- Organize work by workspace; park questions without losing the thread.
- Search a chosen local Markdown reference folder using lexical, BM25, vector, and reranking paths when configured.
- Export and import a workspace as Markdown or JSON.

## Status

This is a **public release candidate**. The core test suite passes, but the UI and some provider labels are currently Chinese. English localization, a demo vault, screenshots, and an Obsidian Community Plugins submission are the next release milestones.

## Install for testing (BRAT)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin in Obsidian.
2. In BRAT, choose **Add Beta plugin** and enter this repository URL after it is published.
3. Enable **Edge Tutor** in Obsidian’s Community plugins settings.

Alternatively, build locally and copy `main.js`, `manifest.json`, `styles.css`, and the generated `lib/` directory to `<your-vault>/.obsidian/plugins/edge-tutor/`.

## Local development

Requirements: Node.js 20 or later.

```bash
npm ci
npm test
npm run build
```

The build emits `main.js` and copies the ONNX runtime WebAssembly files to `lib/`. Those generated files are intentionally not committed.

## Configure your vault

After enabling the plugin, open **Settings → Edge Tutor** and configure:

- an OpenAI-compatible chat endpoint and API key;
- the vault-relative folder where Edge Tutor stores its notes (default: `Edge Tutor`);
- optionally, a vault-relative folder containing Markdown reference material;
- optionally, embeddings/reranking for semantic retrieval.

API keys are stored in Obsidian’s local plugin data or read from environment variables. Never commit `data.json`, `.env`, vector indexes, or model files.

## Security note

The optional OpenCode agent channel can invoke a local OpenCode server with file, shell, and network capabilities. It is disabled by default in this public release. Enable it only after reviewing its permissions and with a vault you are comfortable exposing to that local agent.

Please report sensitive issues privately; see [SECURITY.md](SECURITY.md).

## Contributing

Issues, design feedback, localization help, and focused pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Xu
