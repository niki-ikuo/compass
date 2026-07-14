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

- Tools: `writeFile`, `mkdir`, `deleteFile`, `deleteDir` (or a single batched `proposeActions`).
- Destructive / write tools **pause** the loop and open preview (reuse Edit UI where possible).
- After apply or reject, continue or stop according to product rules (document the chosen policy).

**Exit criteria:** Agent can plan → read → propose → user approve → apply, across multiple steps; Ask/Edit unchanged.

---

## 6. Phase 3 — Restricted command execution

**Goal:** Close the feedback loop (tests, lint, build) without equating Agent to a raw shell.

- Controlled `exec`: workspace cwd, timeout, stdout/stderr cap, no interactive TTY by default.
- Deny list or always-approve for dangerous patterns.
- Do not drive the user’s interactive PTY from the Agent loop.

**Exit criteria:** Safe commands run, output returns to the model, UI shows command steps; cancel kills the child process when possible.

---

## 7. Phase 4 — UX and robustness

- Partial apply / retry after failure
- Long-run progress and clearer cancel semantics
- Provider fallback when `tools` are unsupported (e.g. degrade messaging or Edit-like path)
- History replay of tool steps without corruption
- Guardrails: turn limits, payload size limits, redaction of secrets in tool logs

**Exit criteria:** Stable enough for daily use on the primary providers Compass already supports.

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
| Approval policy after reject | Stop run vs continue without write | _TBD_ (Phase 2) |
| Batched vs per-file write tools | One `proposeActions` vs many tools | _TBD_ (Phase 2) |
| Tools-less providers | Hide Agent / warn / fallback | _TBD_ (Phase 4) |
| Step persistence shape | On message vs separate run record | **On `ChatMessage.agentSteps`** |
| Exec allow list | Allow-list vs deny-list first | _TBD_ (Phase 3) |
