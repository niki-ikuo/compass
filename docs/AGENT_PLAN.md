# Agent mode — implementation plan

**English** | [日本語](ja/AGENT_PLAN.md)

Phased build record for **v2.0 Agent** autonomy (tool loops, commands, multi-step runs). **Phases 0–4 are shipped** in the current product (`package.json` version 2.2.x). For how the runtime behaves today, see [AGENT.md](./AGENT.md). Related: [SPEC.md](./SPEC.md) §10, [ARCHITECTURE.md](./ARCHITECTURE.md).

This document keeps the phase checklist, decided policies, and later roadmap. It is not a “not started” plan.

---

## 1. Goal and boundaries

| Mode | Meaning | Status |
|------|---------|--------|
| **Ask** | Explain / review only; no workspace change proposals | Shipped |
| **Edit** | Propose create/change/delete as JSON; user previews and applies | Shipped |
| **Agent** | Cursor-style tool-call loops, restricted command execution, multi-step automation (Phases 0–4) | Shipped (v2.0) |

Agent is **not** “Edit but larger.” Edit stays a single-turn propose → human apply. Agent runs a loop: model → tool → observation → model … until done, cancelled, or error.

### Non-goals (still out of scope / later)

- MCP / plugins (SPEC v3.0)
- Semantic RAG (SPEC v2.1)
- Cloud auth / multi-tenant (app remains local, workspace-scoped)
- Auto-apply destructive changes without approval

---

## 2. Design constraints (from current architecture)

1. **Tools run in Main only** — same privilege model as FS / AI / PTY. Renderer uses `window.compass` only.
2. **Workspace sandbox** — paths must resolve inside the open folder (`resolveInsideWorkspace`); no escape via `..`.
3. **Human approval for writes** — reuse Edit’s preview → apply path (`previewActions` / `applyActions`).
4. **Single cancellable run** — one AbortController-style cancel per Agent run (same spirit as `ai:cancel`).
5. **OpenAI-compatible `tools` API** — native tool calling (not the `compass-actions` text protocol). Providers without tools hide Agent in the picker; guided Edit fallback if Agent was still selected.
6. **Terminal split** — keep user PTY (xterm) separate from Agent’s short-lived controlled `exec`.

### Reusable assets

| Asset | Path / area | Agent use |
|-------|-------------|-----------|
| Preview / apply | `WorkspaceAction`, `fs.previewActions` / `applyActions` | Write gate |
| Search / structure index | `workspace-search`, `.compass` indexer | Read tools |
| SSE + IPC + abort | `ai-client`, `ai:chunk` / `ai:done` / `ai:cancel` | Stream + cancel |
| Chat history | `.compass/chat-history.json` | Persist steps / mode |
| Mode toggle UI | `ChatPanel`, `ChatMode` | `'agent'` is a first-class mode |

`ChatMode` includes `'agent'`; `normalizeChatMode` accepts it (no agent → edit remap).

---

## 3. Phase 0 — Contract — **Shipped**

Types and IPC defined so UI and Main stay aligned.

### Mode and run state

- `ChatMode` includes `'agent'`.
- Run lifecycle (conceptual):

```
idle → thinking → tool_call → (waiting_approval)? → applying? → thinking → … → done | error | aborted
```

### IPC events (AI channel)

| Event | Purpose |
|-------|---------|
| `ai:chunk` | Assistant text deltas |
| `ai:toolStart` | Tool name + args (sanitized for UI) |
| `ai:toolResult` | Observation summary / success / error |
| `ai:needApproval` | Pending write preview (pause loop) |
| `ai:step` | High-level step label |
| `ai:done` / `ai:error` / `ai:aborted` | Terminal states |

### Persistence

Tool steps embed on `ChatMessage.agentSteps` (assistant messages). Ask/Edit transcripts ignore the field. History reload coerces in-flight `running` / `waiting_*` steps to `error`.

### Phase 2 write policy (decided)

| Topic | Decision |
|-------|----------|
| Write tool shape | Single batched **`proposeActions`** → `WorkspaceAction[]` (`writeFile`, **`applyPatch`**, mkdir, deletes) |
| Apply location | Renderer `applyWorkspacePreview` / `revertWorkspacePreview` (same UX as Edit) |
| After reject | Return observation to the model and **continue** the loop (re-propose allowed) |
| After apply | Return applied summary and **continue** |
| Pause IPC | `ai:needApproval` + `ai:resolveApproval` |

**Exit criteria:** Met.

---

## 4. Phase 1 — Thin runtime (read-only tools) — **Shipped**

End-to-end tool loop without mutating the workspace.

| Tool | Behavior |
|------|----------|
| `readFile` | Read file under workspace (size limit) |
| `listDir` | List directory |
| `search` | Workspace search / index |

- Runner: `electron/services/agent-runner.ts`
- Max turns / max tools per run; stream text + tool events; cancel aborts HTTP and further tools
- UI: Ask / Edit / Agent toggle; step timeline in chat

**Exit criteria:** Met.

---

## 5. Phase 2 — Writes + human approval — **Shipped**

- Tool: `proposeActions({ actions: WorkspaceAction[] })` — prefer **`applyPatch`** for surgical edits; `writeFile` for new/small full files
- Loop **pauses** and emits `ai:needApproval` with preview items
- UI reuses Edit preview / PreviewBar; Apply or Reject calls `ai:resolveApproval`
- Reject / apply both return an observation; the run **continues**
- Ask/Edit paths unchanged

**Exit criteria:** Met.

---

## 6. Phase 3 — Restricted command execution — **Shipped**

- Tool: `exec({ command, cwd?, timeoutMs? })` via `electron/services/agent-exec.ts`
- cwd constrained to the workspace; default timeout 30s (max 120s); stdout/stderr capped (~64KB)
- Non-interactive; separate from the user PTY
- **Shell:** Windows prefers Git Bash when installed (else `cmd.exe`); other platforms use `/bin/sh`
- **Deny-list** blocks dangerous patterns; cancel kills the child when possible

**Exit criteria:** Met.

---

## 7. Phase 4 — UX and robustness — **Shipped**

- **Partial apply:** When the preview queue empties after per-file apply/reject, Agent approval resumes with an applied/rejected observation
- **Apply failure → re-propose:** On apply error the preview stays for Retry; **Ask Agent to fix** clears the preview and returns the failure observation
- **Verify loop:** `verify` tool runs project test / lint / typecheck via package scripts (or safe fallbacks)
- **Progress / cancel:** `ai:step` status labels; `waiting_approval` step status; abort clears approval + running/waiting steps
- **Tools-less providers:** Hide Agent mode in the chat picker when tools are unsupported (`isAgentModeAvailable` / `ChatPanel`); if Agent was somehow selected, guided Edit fallback (`agentEditFallback`) offers resend in Edit
- **History:** `waiting_approval` / `running` steps normalize safely on load
- **Guardrails:** Turn limits, payload truncation, secret redaction (`src/utils/redact.ts`) and `exec` output
- **Plan layer:** `updateTodo` + `checkpoint` (`electron/services/agent-plan.ts`)
- **Context retention (pre-RAG):** `remember` + auto observations (`agent-memory.ts`); smarter `.compass` summary; in-run `readFile` cache (`agent-read-cache.ts`)

**Exit criteria:** Met for daily use on primary OpenAI-compatible providers.

### Shipped polish (was deferred)

| Item | Notes |
|------|--------|
| Hide Agent toggle per provider | Shipped — Ollama and other tools-less providers hide Agent (Ask / Edit only) |
| Guided Edit fallback when tools unsupported | Shipped — banner + resend in Edit (`ChatPanel` `agentEditFallback`) |

---

## 8. Phase 5 — Intelligence expansion (later roadmap)

Aligned with SPEC:

| Spec | Scope | Status |
|------|--------|--------|
| v2.1 | Semantic search / RAG / embeddings | Not started |
| v3.0 | MCP, plugins, native non–OpenAI APIs | Not started |
| Policy | Optional auto-approve for trusted read-only tools only | Not started |

---

## 9. Phase diagram

```
Phase 0  Contract (types, IPC, SPEC, persistence)     ✅ shipped
   ↓
Phase 1  Read-only tool loop + step UI                 ✅ shipped
   ↓
Phase 2  Writes via preview/apply + approval pause     ✅ shipped
   ↓
Phase 3  Restricted exec (separate from user PTY)      ✅ shipped
   ↓
Phase 4  UX, limits, provider errors, plan/memory      ✅ shipped (v2.0)
   ↓
Phase 5  RAG → MCP / plugins (SPEC v2.1 / v3.0)        ○ later
```

---

## 10. Build order (historical)

The order actually used to ship v2.0:

1. SPEC/types: Ask · Edit · Agent boundaries; `'agent'` mode
2. UI toggle for Agent
3. Main: max-N-turn read-only runner
4. Chat: tool steps from IPC events
5. Write tools + approval pause
6. Restricted `exec`, then Phase 4 UX / verify / plan / memory

Avoid shipping “commands + auto-apply writes” in one slice — cancel, approval, provider differences, and history collide.

---

## 11. Decisions (record)

| Topic | Options / notes | Decision |
|-------|-----------------|----------|
| Approval policy after reject | Stop run vs continue without write | **Continue with rejection observation** |
| Batched vs per-file write tools | One `proposeActions` vs many tools | **`proposeActions` batch** |
| Tools-less providers | Hide Agent / warn / fallback | **Hide Agent when unsupported**; guided **Edit fallback** if Agent was still selected; otherwise clear error (`ai.agentToolsUnsupported`) |
| Step persistence shape | On message vs separate run record | **On `ChatMessage.agentSteps`** |
| Exec allow list | Allow-list vs deny-list first | **Deny-list first** (`agent-exec.ts`) |
