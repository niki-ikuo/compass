# Compass

**English** | [日本語](README.ja.md)

An AI workspace for Windows. Open a local folder and work with AI on notes, documents, data, and code.

Open a folder → edit files → ask the AI → apply suggestions.

## Download

[Download for Windows (latest)](https://github.com/niki-ikuo/compass/releases/latest)

Installer: `Compass Setup x.y.z.exe` (Windows 10/11 x64)

## Features

- Monaco Editor with syntax highlighting (text files, not code-only)
- Workspace file tree
- AI chat (streaming) — **Ask** / **Edit** / **Agent**, plus use-case presets (general / document / data / code)
- Inline completions (ghost text; Tab to accept)
- Workspace structure index (`.compass/`) for AI context
- Doc templates (Markdown presets under `.compass/templates/`)
- Diff preview and apply for AI suggestions
- Integrated terminal (xterm.js)
- OpenAI-compatible API settings (multi-LLM: OpenAI / Gemini / DeepSeek / Groq / OpenRouter / Ollama / custom)

## Use Cases

### General

Open a local folder of notes, docs, and data, then ask AI for a quick overview of the workspace.

![General use case — workspace overview with AI chat](docs/assets/use-case-general.png)

### Document

Point the agent at a folder and generate manuals or docs from your project files.

![Document use case — AI-generated game manual](docs/assets/use-case-document.png)

### Data

Ask questions about a CSV in natural language and get tables and summaries back.

![Data use case — natural-language CSV analysis](docs/assets/use-case-data.png)

### Code

Describe an app or game and let the agent scaffold files you can preview and iterate on.

![Code use case — Breakout-style game built with Agent](docs/assets/use-case-code.png)

Android apps can also be created.

![Code use case — Android Reversi app built with Agent](docs/assets/use-case-code-android.png)

## Requirements

- Windows 10 / 11 (x64)
- [Node.js](https://nodejs.org/) 18+
- npm

## Installation

```bash
git clone https://github.com/niki-ikuo/compass.git
cd compass
npm install
```

`npm install` runs Electron binary setup automatically.

If the native module (`node-pty`) fails to build:

```bash
npm run rebuild-native
```

## Usage

### Development

```bash
npm run dev
```

### Production build

```bash
npm run build
```

### Installer

```bash
npm run dist
```

Artifacts are written to `release/` (NSIS installer).

### First-time setup

1. Launch the app
2. In **Settings**, choose an LLM provider, API key, and model
3. **Open Folder** to select a workspace
4. Edit files and use the side-panel AI chat to ask questions or apply suggestions

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the dev server (electron-vite) |
| `npm run build` | Production build |
| `npm run preview` | Preview the build |
| `npm run dist` | Build + create NSIS installer |
| `npm run rebuild-native` | Rebuild `node-pty` for Electron |

## Tech Stack

- **Electron** — desktop shell
- **React** + **TypeScript** — UI
- **Monaco Editor** — text editor
- **Zustand** — state management
- **electron-vite** — build
- **electron-builder** — packaging

## Project Structure

```
compass/
├── electron/       # Main process, preload, services
├── src/            # Renderer (React UI)
├── docs/           # Spec, architecture, development guides
├── scripts/        # Setup scripts
└── resources/      # App icons, etc.
```

## Documentation

- [Docs index](docs/README.md)
- [Product spec](docs/SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Contributing](CONTRIBUTING.md)

Japanese versions: [docs/ja/](docs/ja/README.md)

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) ([日本語](CONTRIBUTING.ja.md)).  
Issues and PRs in **English** are preferred; Japanese is also fine.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) ([日本語](docs/ja/CODE_OF_CONDUCT.md)).

## License

[MIT](LICENSE)
