# Compass — minimum product spec (Windows)

**English** | [日本語](ja/SPEC.md)

## 1. Product definition

| Item | Details |
|------|---------|
| Name (working) | **Compass** |
| Platform | Windows 10/11 (x64) |
| Goal | Edit local code while chatting with AI to write and fix it |
| MVP goal | Complete loop: open folder → edit files → ask AI → apply suggestions |

---

## 2. vs Cursor: shipped / deferred

### Shipped

- Text editor
- File tree
- AI chat (side panel) — **Ask** (explain only) / **Edit** (propose file changes) / **Agent** (read-only tool loop; writes & commands come later — see [AGENT_PLAN.md](./AGENT_PLAN.md))
- Current file sent as context
- Diff preview & apply for AI suggestions (Edit: `compass-actions` → preview → user approval)
- OpenAI-compatible API (multi-LLM: provider presets, per-provider API keys, model selection)
- Settings (API keys, etc.)
- Integrated terminal (xterm.js + node-pty)
- Codebase structure index (workspace `.compass/` — file list, import graph, etc. for AI context)
- Inline completions (ghost text / Tab accept; toggle in Settings)

### Deferred (v2+)

- **Agent follow-ups** — Phase 4 UX/guardrails are implemented; deferred: retry UI, auto Edit fallback for tools-less providers — see [AGENT_PLAN.md](./AGENT_PLAN.md)
- Vector search / RAG (`.compass` is a structure index, not embedding search)
- MCP
- Git integration

---

## 3. UI layout (minimum)

```
┌──────────────────────────────────────────────────────────┐
│  Menu bar  [File] [Edit] [View] [Settings]               │
├──────────┬───────────────────────────────┬───────────────┤
│          │  Tabs: main.ts  utils.ts      │               │
│ File     │───────────────────────────────│   AI chat     │
│ tree     │                               │               │
│          │   Monaco Editor               │  ┌──────────┐ │
│  📁 src  │   (syntax highlighting)       │  │ history  │ │
│   📄 a.ts│                               │  └──────────┘ │
│   📄 b.ts│                               │  [input]      │
│          │                               │  [send]       │
├──────────┴───────────────────────────────┴───────────────┤
│  Status bar: line/col | language | connection            │
└──────────────────────────────────────────────────────────┘
```

| Item | Spec |
|------|------|
| Window size | Default 1280×800, resizable |
| Layout | 3 panes (tree 20% / editor 50% / chat 30%), panels collapsible |

---

## 4. Feature spec (MVP)

### 4.1 Editor

| Feature | Spec |
|---------|------|
| Engine | Monaco Editor (VS Code family) |
| Actions | Open, save, new, close, Undo/Redo, find |
| Syntax | TypeScript, JavaScript, Python, JSON, Markdown, HTML, CSS |
| Tabs | Multi-file; dirty mark (●) |
| Autosave | Off (explicit save only) |

### 4.2 File management

| Feature | Spec |
|---------|------|
| Open folder | Dialog picks workspace root |
| Tree | Recursive listing; hide `node_modules` / `.git` |
| File ops | Open, save, create (v1.1+) |

### 4.3 AI chat

| Feature | Spec |
|---------|------|
| Input | Multiline; Enter send / Shift+Enter newline |
| Context | (1) full current file (2) user selection if any |
| Streaming | Token-by-token display |
| History | In-session only (cleared on restart) |
| System prompt | You are a coding assistant; wrap code in fenced blocks |

**Example context format:**

```
[Current file: src/main.ts]
```typescript
// file contents
```

[User question]
Fix the bug in this function
```

### 4.4 Apply

For AI code blocks:

1. **Preview** — diff (additions green, deletions red)
2. **Apply** — overwrite current file or insert at selection
3. **Reject** — no-op

MVP: whole-file replace or insert at cursor only.

### 4.5 Settings

| Item | Default |
|------|---------|
| LLM provider | `openai` (OpenAI / Gemini / DeepSeek / Groq / OpenRouter / Ollama / custom) |
| API base URL | Set from provider (manual for custom only) |
| API key | Per-provider, encrypted locally |
| Model | `gpt-4o-mini` (provider suggestions + free input) |
| Temperature | 0.2 |
| Max tokens | 4096 |
| Inline completions | ON |
| Default shell | `powershell` (PowerShell / cmd / Git Bash / WSL) |

---

## 5. Tech stack (recommended)

| Layer | Tech |
|-------|------|
| UI | React + TypeScript |
| Shell | Electron 33+ |
| Editor | Monaco Editor |
| Build | electron-vite |
| Package | electron-builder (NSIS) |
| State | Zustand |
| AI | fetch + SSE streaming |

### Why Electron

- Same family as Cursor / VS Code; strong Monaco fit
- Mature Windows packaging
- Fastest path for MVP

### Alternative

Tauri 2.0 + React + Monaco (smaller binary; more Windows friction)

---

## 6. Architecture

```
┌─────────────────────────────────────────────────┐
│                  Renderer Process               │
│  ┌─────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │ FileTree│ │  Editor  │ │   ChatPanel     │  │
│  └────┬────┘ └────┬─────┘ └────────┬────────┘  │
│       │           │                │            │
│       └───────────┴────────────────┘            │
│                     │                           │
│              Zustand Store                      │
│         (files, editor, chat, settings)         │
└─────────────────────┬───────────────────────────┘
                      │ IPC (contextBridge)
┌─────────────────────┴───────────────────────────┐
│                  Main Process                   │
│  ┌──────────────┐  ┌────────────┐  ┌─────────┐ │
│  │ FileSystem   │  │ AI Client  │  │ Settings│ │
│  │ (fs/promises)│  │ (SSE/HTTP) │  │ (secure)│ │
│  └──────────────┘  └────────────┘  └─────────┘ │
└─────────────────────────────────────────────────┘
```

### IPC API (minimum)

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `fs:readDir` | Renderer → Main | List directory |
| `fs:readFile` | Renderer → Main | Read file |
| `fs:writeFile` | Renderer → Main | Write file |
| `fs:openFolder` | Renderer → Main | Folder dialog |
| `ai:chat` | Renderer → Main | Streaming chat |
| `settings:get/set` | Renderer → Main | Settings R/W |

---

## 7. Data model (minimum)

```typescript
// File
interface OpenFile {
  path: string;
  content: string;
  language: string;
  isDirty: boolean;
}

// Chat
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// Settings
interface AppSettings {
  providerId: LlmProviderId;
  apiBaseUrl: string;
  apiKey: string;
  providerKeys: Partial<Record<LlmProviderId, string>>;
  model: string;
  temperature: number;
}
```

---

## 8. Non-functional requirements

| Item | Target |
|------|--------|
| Startup | ≤ 3s cold start |
| Memory | ≤ 300MB (small projects) |
| Installer | NSIS, Start Menu entry |
| Security | No plaintext API keys; no direct API calls from renderer |
| Offline | Editor works offline; AI requires network |

---

## 9. MVP phases (rough)

| Phase | Scope | Estimate |
|-------|-------|----------|
| **P0** | Electron boot, Monaco, single-file open/save | 1 week |
| **P1** | File tree, tabs, open folder | 1 week |
| **P2** | Chat UI, API, streaming | 1 week |
| **P3** | Context send, apply (diff preview) | 1 week |
| **P4** | Settings, installer, basic tests | 3 days |

**Total: ~4–5 weeks** (solo)

---

## 10. Roadmap (v2+)

```
Now (terminal / .compass structure index / Ask·Edit / multi-LLM / inline completions)
 └─ v2.0: Agent autonomy (tool loop, commands, multi-step)
     └─ v2.1: semantic codebase search (RAG / embeddings)
         └─ v3.0: MCP, plugins, native non–OpenAI APIs
```

Phased build checklist for v2.0 Agent: [AGENT_PLAN.md](./AGENT_PLAN.md).

**Terminology**

| Name | Meaning |
|------|---------|
| Ask mode | Explain / review only; no workspace change proposals |
| Edit mode | Propose create/change/delete as JSON; user previews and applies |
| Agent | Tool-call loop. Phase 1–3: read tools, `proposeActions` (preview approval), restricted `exec` — see [AGENT_PLAN.md](./AGENT_PLAN.md) |

---

## 11. Project layout (initial)

```
compass/
├── package.json
├── electron.vite.config.ts
├── electron/
│   ├── main.ts          # Main process
│   ├── preload.ts       # IPC bridge
│   └── services/
│       ├── filesystem.ts
│       ├── ai-client.ts
│       └── settings.ts
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── FileTree.tsx
│   │   ├── Editor.tsx
│   │   ├── ChatPanel.tsx
│   │   └── SettingsDialog.tsx
│   ├── stores/
│   │   └── app-store.ts
│   └── types/
│       └── index.ts
└── resources/
    └── icon.ico
```

---

## 12. Summary

MVP rests on four pillars:

1. **Monaco-based editor** — editing foundation
2. **File tree + workspace** — project-scoped work
3. **Contextual AI chat** — dialogue that understands the current file
4. **Apply suggestions** — put AI output into the editor

Cursor’s core is “editor + contextual AI + apply changes.” Structure index, Edit (propose/apply), and inline completions are shipped; autonomous Agent loops and RAG come later.
