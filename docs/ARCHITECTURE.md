# Architecture

**English** | [日本語](ja/ARCHITECTURE.md)

Compass uses Electron’s three-layer model: main, preload, and renderer. Privileged work (filesystem, AI networking, settings, terminal) stays in the main process. The renderer talks only through IPC exposed via `contextBridge`.

## Process layout

```
┌─────────────────────────────────────────────────┐
│                  Renderer Process               │
│  FileTree / Editor / ChatPanel / Terminal …     │
│                     │                           │
│              Zustand Store                      │
└─────────────────────┬───────────────────────────┘
                      │ IPC (preload / contextBridge)
┌─────────────────────┴───────────────────────────┐
│                  Main Process                   │
│  filesystem / ai-client / settings / terminal   │
│  project-indexer / chat-history …               │
└─────────────────────────────────────────────────┘
```

| Layer | Responsibilities |
|-------|------------------|
| Renderer (`src/`) | UI, editor state, chat display, user actions |
| Preload (`electron/preload.ts`) | Exposes `window.compass` |
| Main (`electron/`) | FS, AI SSE, settings, index, PTY |

## Directory roles

```
electron/
├── main.ts                 # Window creation, IPC registration
├── preload.ts              # Renderer-facing API
└── services/
    ├── filesystem.ts       # Directory / file ops
    ├── ai-client.ts        # OpenAI-compatible API / SSE
    ├── settings.ts         # Settings read/write
    ├── project-indexer.ts  # Workspace index
    ├── index-watcher.ts    # Index file watching
    ├── chat-history.ts     # Chat history
    └── encoding.ts         # Character encoding

src/
├── App.tsx                 # Root UI / workspace bootstrap
├── components/             # UI components
├── stores/app-store.ts     # Zustand store
├── utils/                  # Preview, index helpers, encoding, etc.
└── types/                  # Shared types
```

## IPC (overview)

The renderer calls `window.compass.*`. The source of truth is `electron/preload.ts` and `electron/main.ts`.

| Namespace | Purpose |
|-----------|---------|
| `fs:*` | Folder pick, read/write, create/move/delete, apply actions |
| `ai:*` | Chat send, chunk / done / error events |
| `settings:*` | Get / save settings |
| `workspace:*` | Recent workspace / recently opened folders |
| `index:*` | Build / watch project index |
| `chat:*` | Chat history read/write |
| `terminal:*` | PTY create, I/O, resize, exit |
| `shell:*` / `menu:*` | App actions / menu events |

## Data flow (AI chat)

1. Renderer builds context from the current file, selection, and references (Ask / Edit)
2. Main ensures the `.compass` structure index and attaches it for the AI
3. Renderer sends `ai:chat` to Main
4. Main `ai-client` opens an SSE connection to an OpenAI-compatible API
5. Tokens stream back via `ai:chunk`
6. Completion: `ai:done`; failure: `ai:error`
7. **Ask**: explanation only (no file-change actions)
8. **Edit**: parse `compass-actions` → preview → apply after user approval (not an autonomous tool loop)

## `.compass` index

Structure index lives under the workspace’s `.compass/` (`project-indexer.ts`).

| File | Contents |
|------|----------|
| `meta.json` | Version, update time, etc. |
| `files.json` | Paths, language, import/export, symbol overview |
| `graph.json` | Import edges between files |
| `summary.txt` | Summary text for the AI |

Relevant slices are added to chat context. This is **not** embedding-based RAG.

## Multi-LLM

`providerId` in settings selects an OpenAI-compatible provider (`src/utils/llm-providers.ts`).

| Item | Details |
|------|---------|
| Presets | OpenAI / Google Gemini / DeepSeek / Groq / OpenRouter / Ollama / custom |
| API keys | Encrypted per provider; restored on switch |
| Models | Settings or chat header (free-form input allowed) |
| Transport | Main `ai-client` connects via `/chat/completions` SSE |

Native non–OpenAI-compatible APIs (e.g. Claude) are unsupported; use OpenRouter.

## Security

- Do not call external APIs from the renderer; go through Main
- Do not store secrets in plaintext (Credential Manager, etc.)
- Keep `nodeIntegration` off; only expose the preload surface
