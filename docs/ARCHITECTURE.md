# Architecture

**English** | [日本語](ja/ARCHITECTURE.md)

Compass is an AI workspace for local folders. It uses Electron’s three-layer model: main, preload, and renderer. Privileged work (filesystem, AI networking, settings, terminal) stays in the main process. The renderer talks only through IPC exposed via `contextBridge`.

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
│  filesystem / ai-client / agent-runner / settings / terminal   │
│  project-indexer / chat-history / help / workspace-settings … │
└───────────────────────────────────────────────────────────────┘
```

| Layer | Responsibilities |
|-------|------------------|
| Renderer (`src/`) | UI, editor state, chat display, user actions |
| Preload (`electron/preload.ts`) | Exposes `window.compass` |
| Main (`electron/`) | FS, AI SSE, settings, index, PTY, help, workspace search |

## Directory roles

```
electron/
├── main.ts                 # Window creation, IPC registration
├── preload.ts              # Renderer-facing API
└── services/
    ├── filesystem.ts       # Directory / file ops
    ├── fs-ignore.ts        # Ignore rules for listings / search / index
    ├── ai-client.ts        # OpenAI-compatible API / SSE (Ask / Edit)
    ├── ai-connection.ts    # Live LLM connection checks (AI Help gate)
    ├── agent-runner.ts     # Agent tool loop (Phase 1–4)
    ├── agent-exec.ts       # Restricted Agent command execution
    ├── agent-approval.ts   # Write approval pause / resume
    ├── agent-propose-actions.ts
    ├── agent-verify.ts / agent-verify-light.ts
    ├── agent-plan.ts / agent-memory.ts / agent-read-cache.ts / agent-paths.ts
    ├── settings.ts         # App settings read/write
    ├── workspace-settings.ts  # `.compass/settings.json` (e.g. default preset)
    ├── project-indexer.ts  # Workspace index
    ├── index-watcher.ts    # Index file watching
    ├── chat-history.ts     # Chat history
    ├── open-editors.ts     # Persist open editor tabs
    ├── workspace-search.ts # Workspace text search
    ├── terminal.ts         # PTY
    ├── help.ts / help-ask.ts  # Offline help + AI Help
    └── encoding.ts         # Character encoding

src/
├── App.tsx                 # Root UI / workspace bootstrap
├── utils/agent-plan.ts     # Shared Agent plan (todos/checkpoint); main re-exports via agent-plan.ts
├── components/AgentPlanPanel.tsx  # Chat plan checklist
├── components/             # UI components (incl. LeftSidebar, SearchPanel, Help*)
├── stores/app-store.ts     # Zustand store
├── utils/                  # Preview, index helpers, encoding, etc.
└── types/                  # Shared types
```

## IPC (overview)

The renderer calls `window.compass.*`. The source of truth is `electron/preload.ts` and `electron/main.ts`.

| Namespace | Purpose |
|-----------|---------|
| `fs:*` | Folder pick, read/write, create/move/delete, apply actions, workspace search / replace |
| `ai:*` | Chat send, chunk / done / error / tool events, inline completions, connection test |
| `settings:*` | Get / save app settings |
| `workspace:*` | Recent folders; workspace settings (`.compass/settings.json`) |
| `index:*` | Build / watch project index |
| `chat:*` | Chat history read/write |
| `terminal:*` | PTY create, I/O, resize, exit |
| `help:*` | Offline help list / get / search; AI Help ask / cancel |
| `shell:*` / `menu:*` | App actions / menu events (open external, reveal in OS explorer, …) |

## Data flow (AI chat)

1. Renderer builds context from the current file, selection, and references (Ask / Edit / Agent)
2. Main ensures the `.compass` structure index and attaches it for the AI
3. Renderer sends `ai:chat` to Main
4. Main routes by mode:
   - **Ask / Edit**: `ai-client` SSE streaming (`delta.content` only)
   - **Agent**: `agent-runner` tool loop (OpenAI-compatible `tools` + SSE)
5. Tokens stream back via `ai:chunk`; Agent also emits `ai:toolStart` / `ai:toolResult` / `ai:step`
6. Completion: `ai:done`; failure: `ai:error`; cancel: `ai:aborted`
7. **Ask**: explanation only (no file-change actions)
8. **Edit**: parse `compass-actions` → preview → apply after user approval (not an autonomous tool loop)
9. **Agent (Phase 1–4)**: read tools, `proposeActions` (pause → preview → approval, including partial resolve), restricted `exec`, turn/payload limits, secret redaction, tools-unsupported handling, `waiting_approval` UI — details: [AGENT.md](./AGENT.md)

## `.compass` folder

Structure index and workspace data live under the workspace’s `.compass/` (`project-indexer.ts`, `chat-history.ts`, `workspace-settings.ts`, …).

| File | Contents |
|------|----------|
| `meta.json` | Version, update time, etc. |
| `files.json` | Paths, language, import/export, symbol overview |
| `graph.json` | Import edges between files |
| `summary.txt` | Summary text for the AI |
| `chat-history.json` | Persisted chat sessions |
| `settings.json` | Workspace settings (e.g. default use-case preset) |
| `templates/` | Optional document templates |

Relevant index slices are added to chat context. This is **not** embedding-based RAG.

## Multi-LLM

`providerId` in settings selects an OpenAI-compatible provider (`src/utils/llm-providers.ts`).

| Item | Details |
|------|---------|
| Presets | OpenAI / Google Gemini / DeepSeek / Groq / OpenRouter / Ollama / custom |
| API keys | Encrypted per provider; restored on switch |
| Models | Settings or chat composer footer (free-form input allowed) |
| Transport | Main `ai-client` connects via `/chat/completions` SSE |
| Use-case presets | Orthogonal to Ask / Edit / Agent; composer switch + app/workspace defaults — [USE_CASE_PRESET.md](./USE_CASE_PRESET.md) |

Native non–OpenAI-compatible APIs (e.g. Claude) are unsupported; use OpenRouter.

## Security

- Do not call external APIs from the renderer; go through Main
- Do not store secrets in plaintext (Credential Manager, etc.)
- Keep `nodeIntegration` off; only expose the preload surface
