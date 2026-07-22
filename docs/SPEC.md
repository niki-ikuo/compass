# Compass — AI workspace product spec (Windows)

**English** | [日本語](ja/SPEC.md)

## 1. Product definition

| Item | Details |
|------|---------|
| Name (working) | **Compass** |
| Platform | Windows 10/11 (x64) |
| Concept | **AI workspace** for local folders — anyone who works with text (notes, docs, data, code), not a code-only IDE |
| Goal | Edit local text files while chatting with AI to write, fix, and organize them |
| MVP goal | Complete loop: open folder → edit files → ask AI → apply suggestions |

---

## 2. vs Cursor: shipped / deferred

### Shipped

- Text editor
- File tree
- AI chat (side panel) — **Ask** (explain only) / **Edit** (propose file changes) / **Agent** (tool loop: read tools, `proposeActions` with preview approval, restricted `exec`, `verify`, plan/memory; data use-case adds `profileData` / `queryData` — see [AGENT.md](./AGENT.md))
- Current file sent as context
- Diff preview & apply for AI suggestions (Edit: `compass-actions`; Agent: `proposeActions` → same preview → user approval)
- OpenAI-compatible API (multi-LLM: provider presets, per-provider API keys, model selection)
- Settings (API keys, etc.)
- Integrated terminal (xterm.js + node-pty)
- Workspace structure index (`.compass/` — file list, import graph for code, etc. for AI context)
- Chat history persisted per workspace (`.compass/chat-history.json`)
- Use-case presets (`general` / `document` / `data` / `code`) — orthogonal to Ask / Edit / Agent; see [USE_CASE_PRESET.md](./USE_CASE_PRESET.md)
- Inline completions (ghost text / Tab accept; toggle in Settings)
- Doc templates (built-in Markdown presets; workspace `.compass/templates/`)
- Left sidebar Explorer / Search tabs (workspace text search)
- Offline help + AI Help (`helps/` + `help:*` IPC)
- Agent UX when tools unsupported — hide Agent toggle per provider; guided Edit fallback — see [AGENT_PLAN.md](./AGENT_PLAN.md) §7

### Deferred (later)

- Vector search / RAG (`.compass` is a structure index, not embedding search) — SPEC v2.1
- MCP
- Git integration

---

## 3. UI layout (minimum)

```
┌──────────────────────────────────────────────────────────┐
│  Menu bar  [File] [Edit] [View] [Settings]               │
├──────────┬───────────────────────────────┬───────────────┤
│ Explorer │  Tabs: plan.md  notes.md      │               │
│ / Search │───────────────────────────────│   AI chat     │
│          │                               │               │
│  📁 docs │   Monaco Editor               │  ┌──────────┐ │
│   📄 plan│   (syntax highlighting)       │  │ history  │ │
│   📄 data│                               │  └──────────┘ │
│          │                               │  [input]      │
│          │                               │  [send]       │
├──────────┴───────────────────────────────┴───────────────┤
│  Status bar: line/col | language | connection            │
└──────────────────────────────────────────────────────────┘
```

| Item | Spec |
|------|------|
| Window size | Default 1280×800, resizable |
| Layout | 3 panes (left sidebar 20% / editor 50% / chat 30%), panels collapsible |
| Left sidebar | Explorer (file tree) and Search (workspace text search) tabs |

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
| File ops | Open, save, create (v1.1+); rename (F2); reveal in OS file manager |
| Office / OpenDocument | Open with the OS default app (not the Monaco editor); Explorer also offers “Open with Default App” |
| Doc templates | Built-in Markdown presets (including blank Markdown); workspace `.compass/templates/*.md` overrides same-name IDs and adds extras (optional YAML frontmatter: `label`, `fileName`, `order`). Manage via Explorer → New → Manage Templates… |
| Dirty close / quit | Prompt to save before closing dirty editor tabs or quitting the app |

### 4.3 AI chat

| Feature | Spec |
|---------|------|
| Input | Multiline; Enter send / Shift+Enter newline |
| Context | (1) full current file (2) user selection if any |
| Streaming | Token-by-token display |
| History | Persisted per workspace in `.compass/chat-history.json` (survives restart) |
| System prompt | Use-case role (`general` / `document` / `data` / `code`) + mode constraints (Ask / Edit / Agent). See [USE_CASE_PRESET.md](./USE_CASE_PRESET.md) |

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

For AI change proposals:

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
| Max tokens | 32768 |
| Inline completions | ON |
| Default shell | `powershell` (PowerShell / cmd / Git Bash / WSL) |
| Default use-case preset | `general` (`document` / `data` / `code` also available — see [USE_CASE_PRESET.md](./USE_CASE_PRESET.md)) |

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

## 10. Roadmap

```
v2.0 shipped (terminal / .compass index / Ask·Edit·Agent autonomy / multi-LLM /
     inline completions / use-case presets / doc templates / chat history)
 └─ v2.1: semantic workspace search (RAG / embeddings); heading/summary index for docs
     └─ v3.0: MCP, plugins, native non–OpenAI APIs
```

v2.0 Agent phases 0–4 (shipped) + later roadmap: [AGENT_PLAN.md](./AGENT_PLAN.md).  
Runtime details: [AGENT.md](./AGENT.md).  
Use-case presets: [USE_CASE_PRESET.md](./USE_CASE_PRESET.md).

**Terminology**

| Name | Meaning |
|------|---------|
| Ask mode | Explain / review only; no workspace change proposals |
| Edit mode | Propose create/change/delete as JSON; user previews and applies |
| Agent | Shipped tool-call loop (Phases 0–4): read tools, `proposeActions` (preview approval), restricted `exec`, `verify`, plan/memory; data use-case `profileData` / `queryData` — see [AGENT.md](./AGENT.md) |
| Use-case preset | *What kind of expert* (`general` / `document` / `data` / `code`). Orthogonal to Ask / Edit / Agent — see [USE_CASE_PRESET.md](./USE_CASE_PRESET.md) |

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

Compass is an **AI workspace** for local folders. MVP rests on four pillars:

1. **Monaco-based text editor** — editing foundation (code and other text)
2. **File tree + workspace** — folder-scoped work
3. **Contextual AI chat** — dialogue that understands the current file and use case
4. **Apply suggestions** — put AI output into the workspace after approval

Core loop: “editor + contextual AI + apply changes.” Structure index, use-case presets, Ask / Edit / Agent (v2.0 Phases 0–4), and inline completions are shipped; RAG and MCP come later.
