# Agent mode — implementation plan

**English** | [日本語](ja/AGENT_PLAN.md)

Plan for v2.0 **Agent** autonomy (tool loops, commands, multi-step runs). Related: [SPEC.md](./SPEC.md) §10, [ARCHITECTURE.md](./ARCHITECTURE.md).

Branch: `feature/ai-chat-agent`

---

## 1. Goal and boundaries

| Mode | Meaning | Status |
|------|---------|--------|
| **Ask** | Explain / review only; no workspace change proposals | Shipped |
| **Edit** | Propose create/change/delete as JSON; user previews and applies | Shipped |
| **Agent** | Cursor-style tool-call loops, optional command execution, multi-step automation | Not shipped |

Agent is **not** “Edit but larger.” Edit stays a single-turn propose → human apply. Agent runs a loop: model → tool → observation → model … until done, cancelled, or error.

### Non-goals (this plan / early phases)

- MCP / plugins (SPEC v3.0)
- Semantic RAG (SPEC v2.1)
- Cloud auth / multi-tenant (app remains local, workspace-scoped)
- Auto-apply destructive changes without approval in Phase 1–2

---

## 2. Design constraints (from current architecture)

1. **Tools run in Main only** — same privilege model as FS / AI / PTY. Renderer uses `window.compass` only.
2. **Workspace sandbox** — paths must resolve inside the open folder (`resolveInsideWorkspace`); no escape via `..`.
3. **Human approval for writes** — reuse Edit’s preview → apply path (`previewActions` / `applyActions`).
4. **Single cancellable run** — one AbortController-style cancel per Agent run (same spirit as `ai:cancel`).
5. **OpenAI-compatible `tools` API** — prefer native tool calling over extending the `compass-actions` text protocol. Providers without tools need a later fallback.
6. **Terminal split** — keep user PTY (xterm) separate from Agent’s short-lived controlled `exec`.

### Reusable assets

| Asset | Path / area | Agent use |
|-------|-------------|-----------|
| Preview / apply | `WorkspaceAction`, `fs.previewActions` / `applyActions` | Write gate |
| Search / structure index | `workspace-search`, `.compass` indexer | Early read tools |
| SSE + IPC + abort | `ai-client`, `ai:chunk` / `ai:done` / `ai:cancel` | Stream + cancel |
| Chat history | `.compass/chat-history.json` | Persist steps / mode |
| Mode toggle UI | `ChatPanel`, `ChatMode` | Add `agent` formally |

Note: `normalizeChatMode` currently maps legacy `'agent'` → `'edit'`. That compatibility rule must be reversed when Agent ships.

---

## 3. Phase 0 — Contract (before heavy implementation)

Define types and IPC before the loop so UI and Main stay aligned.

### Mode and run state

- Restore `ChatMode` including `'agent'` (stop normalizing agent → edit for new sessions).
- Run lifecycle (conceptual):

```
idle → thinking → tool_call → (waiting_approval)? → applying? → thinking → … → done | error | aborted
```

### Suggested IPC events (extend existing AI channel)

| Event | Purpose |
|-------|---------|
| `ai:chunk` | Assistant text deltas (unchanged) |
| `ai:toolStart` | Tool name + args (sanitized for UI) |
| `ai:toolResult` | Observation summary / success / error |
| `ai:needApproval` | Pending write preview (pause loop) |
| `ai:step` | Optional high-level step label |
| `ai:done` / `ai:error` / `ai:aborted` | Terminal states |

Exact names can change; the contract should include **enough events for a step timeline in chat**.

### Persistence

**Decision:** Embed tool steps on `ChatMessage.agentSteps` (assistant messages). Ask/Edit transcripts ignore the field. History reload coerces in-flight `running` steps to `error`.

### Phase 2 write policy (decided)

| Topic | Decision |
|-------|----------|
| Write tool shape | Single batched **`proposeActions`** → `WorkspaceAction[]` (`writeFile`, **`applyPatch`**, mkdir, deletes) |
| Apply location | Renderer `applyWorkspacePreview` / `revertWorkspacePreview` (same UX as Edit) |
| After reject | Return observation to the model and **continue** the loop (re-propose allowed) |
| After apply | Return applied summary and **continue** |
| Pause IPC | `ai:needApproval` + `ai:resolveApproval` |

### Spec updates

Document Ask / Edit / Agent boundaries in SPEC (and keep this plan as the build checklist).

**Exit criteria:** TypeScript types + IPC stubs agreed; SPEC terminology updated; no full loop required yet.

---

## 4. Phase 1 — Thin runtime (read-only tools)

**Goal:** Prove the tool loop end-to-end without mutating the workspace.

### Tools (initial)

| Tool | Behavior |
|------|----------|
| `readFile` | Read file under workspace (size limit) |
| `listDir` | List directory |
| `search` | Leverage existing workspace search / index |

### Implementation sketch

- Prefer `electron/services/agent-runner.ts` (or equivalent) over growing `ai-client.ts` forever.
- Max turns / max tools per run to avoid runaway loops.
- Stream assistant text + emit tool events to Renderer.
- Cancel aborts in-flight HTTP and stops further tools.

### UI

- Mode toggle: Ask / Edit / Agent.
- Step timeline in chat (tool name, brief result).

**Exit criteria:** User can ask Agent a question; Agent reads files via tools; steps visible; cancel works; no writes.

---

## 5. Phase 2 — Writes + human approval

**Goal:** Multi-step edits with the same safety model as Edit.

**Status:** Implemented on `feature/ai-chat-agent`.

- Tool: `proposeActions({ actions: WorkspaceAction[] })` — prefer **`applyPatch`** (unified diff) for surgical edits to existing files; `writeFile` for new/small full files
- Loop **pauses** and emits `ai:needApproval` with preview items
- UI reuses Edit preview / PreviewBar; Apply or Reject calls `ai:resolveApproval`
- Reject / apply both return an observation; the run **continues** (reject does not force-stop)
- Ask/Edit paths unchanged

**Exit criteria:** Agent can plan → read → propose → user approve → apply, across multiple steps; Ask/Edit unchanged.

---

## 6. Phase 3 — Restricted command execution

**Goal:** Close the feedback loop (tests, lint, build) without equating Agent to a raw shell.

**Status:** Implemented on `feature/ai-chat-agent`.

- Tool: `exec({ command, cwd?, timeoutMs? })` via `electron/services/agent-exec.ts`
- cwd constrained to the workspace; default timeout 30s (max 120s); stdout/stderr capped (~64KB)
- Non-interactive (`stdin` ignored); separate from the user PTY
- **Shell:** Windows prefers Git Bash when installed (else `cmd.exe`); other platforms use `/bin/sh`
- **Deny-list** blocks obvious dangerous patterns; cancel aborts and kills the child process when possible

**Exit criteria:** Safe commands run, output returns to the model, UI shows command steps; cancel kills the child process when possible.

---

## 7. Phase 4 — UX and robustness

**Status:** Implemented on `feature/ai-chat-agent`.

- **Partial apply:** When the preview queue empties after per-file apply/reject, Agent approval resumes with an applied/rejected observation (full retry-after-failure UI deferred)
- **Progress / cancel:** `ai:step` status labels; `waiting_approval` step status; abort clears approval + running/waiting steps
- **Tools-less providers:** Clear error (`ai.agentToolsUnsupported`) directing the user to Edit or a tools-capable model (no auto Edit fallback yet)
- **History:** `waiting_approval` / `running` steps normalize safely on load
- **Guardrails:** Turn limits, payload truncation, secret redaction in tool args/logs (`src/utils/redact.ts`) and `exec` output

**Exit criteria:** Stable enough for daily use on the primary providers Compass already supports.

**Deferred:** Retry-after-failure UI; automatic Ask/Edit fallback when tools are unsupported; hide Agent toggle per provider.

---

## 8. Phase 5 — Intelligence expansion (later roadmap)

Aligned with SPEC:

| Spec | Scope |
|------|--------|
| v2.1 | Semantic search / RAG / embeddings |
| v3.0 | MCP, plugins, native non–OpenAI APIs |
| Policy | Optional auto-approve for trusted read-only tools only |

---

## 9. Phase diagram

```
Phase 0  Contract (types, IPC, SPEC, persistence)
   ↓
Phase 1  Read-only tool loop + step UI
   ↓
Phase 2  Writes via preview/apply + approval pause
   ↓
Phase 3  Restricted exec (separate from user PTY)
   ↓
Phase 4  UX, limits, provider fallbacks
   ↓
Phase 5  RAG → MCP / plugins (SPEC v2.1 / v3.0)
```

---

## 10. First implementation slice (recommended order)

1. Update SPEC/types: Ask · Edit · Agent boundaries; restore `'agent'` mode.
2. UI toggle for Agent (runner may still be stubbed).
3. Main: max-N-turn read-only runner with one or two tools.
4. Chat: render tool steps from new IPC events.
5. Only then: write tools + approval pause.

Avoid shipping “commands + auto-apply writes” in one slice — cancel, approval, provider differences, and history will collide.

---

## 11. Open decisions

Record choices here as implementation proceeds:

| Topic | Options / notes | Decision |
|-------|-----------------|----------|
| Approval policy after reject | Stop run vs continue without write | **Continue with rejection observation** |
| Batched vs per-file write tools | One `proposeActions` vs many tools | **`proposeActions` batch** |
| Tools-less providers | Hide Agent / warn / fallback | **Warn with clear error** (Edit / switch model); hide-toggle & auto-fallback deferred |
| Step persistence shape | On message vs separate run record | **On `ChatMessage.agentSteps`** |
| Exec allow list | Allow-list vs deny-list first | **Deny-list first** (`agent-exec.ts`) |
