# Agent runtime

**English** | [日本語](ja/AGENT.md)

How Compass **Agent** mode actually runs in the program — call path, tool loop, approvals, and persistence. This is the runtime guide. For the phased build checklist see [AGENT_PLAN.md](./AGENT_PLAN.md). For process layout see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. What Agent is (and is not)

| Mode | Implementation | Writes |
|------|----------------|--------|
| **Ask** | Single SSE stream (`ai-client.streamChat`) | None |
| **Edit** | Same stream; parse `` ```compass-actions`` `` after the reply | Preview → user apply |
| **Agent** | Multi-turn **tool loop** (`agent-runner.runAgent`) | Via `proposeActions` → same preview → apply gate |

Agent is not “a longer Edit.” It repeatedly does **model → tool → observation → model** until it finishes without tool calls, the user cancels, an error occurs, or the turn/tool budget is declined.

Design constraints enforced in code:

1. Tools and filesystem run in **Main only**
2. Paths stay inside the open workspace
3. Writes never auto-apply — they reuse Edit’s preview / apply path
4. One cancellable run (`AbortController` shared with Ask/Edit via `ai:cancel`)
5. OpenAI-compatible `tools` API (no `compass-actions` text protocol for Agent)
6. Agent `exec` is a short-lived subprocess — separate from the user PTY terminal

---

## 2. Entry points

```
ChatPanel (mode: 'agent')
  → window.compass.ai.chat(request)
  → IPC ai:chat
  → main.ts: if request.mode === 'agent' → runAgent(webContents, request)
             else → streamChat(...)
```

| Layer | File | Role |
|-------|------|------|
| UI | `src/components/ChatPanel.tsx` | Send, subscribe to stream / tool / approval events, build `agentSteps` |
| Timeline | `src/components/AgentStepTimeline.tsx` | Render `agentSteps` |
| Preload | `electron/preload.ts` | Expose `compass.ai.*` |
| IPC | `electron/main.ts` | Route `ai:chat` / `ai:cancel` / resolve approval & continue |
| Loop | `electron/services/agent-runner.ts` | `runAgent` — core orchestration |
| Types | `src/types/index.ts` | `ChatMode`, `AgentToolStep`, IPC event shapes |
| Prompt | `src/i18n/messages.ts` | `ai.agentSystemPrompt` and step labels |

Cancel: `ai:cancel` → shared AbortController in `ai-client` → pending approvals/continues reject → `ai:aborted`.

---

## 3. Lifecycle

Conceptual run state (`AgentRunState`):

```
idle → thinking → tool_call → (waiting_approval | waiting_continue)? → thinking → … → done | error | aborted
```

UI step status on each `AgentToolStep`: `running` | `waiting_approval` | `waiting_continue` | `done` | `error`.

On chat-history reload, in-flight `running` / `waiting_*` steps are coerced to `error` (interrupted).

---

## 4. End-to-end run (step by step)

### 4.1 Setup (`runAgent`)

1. Require `workspaceRoot`
2. Reject providers with `agentToolsSupport === 'unsupported'` (clear error, no auto Edit fallback)
3. Validate API key / base URL
4. Build API messages:
   - `system`: agent system prompt
   - prior user/assistant turns (with prior tool context reconstructed from `agentSteps`)
   - current user message via `buildUserMessage` (open file, selection, references, `.compass` index slice)
5. Rebuild **plan** and **memory** from history (`agent-plan`, `agent-memory`)
6. Create in-run **read cache** (`agent-read-cache`)
7. Budgets start at **16 turns** / **40 tool calls** (extendable via Continue)

### 4.2 Turn loop

```
while true:
  if aborted → ai:aborted; return
  if turn >= turnBudget → ask Continue; else stop with ai:done
  ai:step "Thinking turn N"
  POST /chat/completions (stream, tools=AGENT_TOOLS, tool_choice=auto)
  streamAgentTurn → content deltas + accumulated tool_calls
  if no tool_calls → ai:done; return
  if tools would exceed budget → ask Continue
  append assistant(+tool_calls) to messages
  for each tool_call:
    ai:toolStart
    execute tool (may pause for approval)
    record observation (except remember)
    ai:toolResult
    append role:tool message
  turn++
```

Natural completion: a turn with **no** `tool_calls`. Agent does not call an explicit “finish” tool.

### 4.3 One SSE turn (`streamAgentTurn`)

- `delta.content` → `ai:chunk` (assistant text)
- `delta.tool_calls` accumulated by index into complete `{ id, name, arguments }`
- HTTP errors that look like “tools not supported” become a dedicated `TOOLS_UNSUPPORTED:`-style message for the UI

`max_tokens` for Agent is floored at **32 768** so large `proposeActions` JSON is less likely to truncate mid-write.

---

## 5. Tools

Defined as OpenAI function schemas in `AGENT_TOOLS` (`agent-runner.ts`). Dispatched by name in `executeTool` / special-cased `proposeActions`.

| Tool | Module / path | Behavior | User gate |
|------|---------------|----------|-----------|
| `readFile` | `agent-read-cache` | ≤ ~200 KB; outline; cache hit unless `force=true` | — |
| `listDir` | runner | One level, ≤ 200 entries | — |
| `search` | `workspace-search` | Content search, ≤ 30 hits | — |
| `proposeActions` | `agent-propose-actions` + `filesystem` | Normalize → preview → **pause** | Apply / Reject / partial / Ask Agent to fix |
| `exec` | `agent-exec` | Workspace cwd, deny-list, timeout, output cap | Write-risk cmds need `ai:needExecApproval` |
| `verify` | `agent-verify` | test / lint / typecheck via scripts or fallbacks | — (uses internal exec) |
| `updateTodo` | `agent-plan` | Checklist state for the run | — |
| `checkpoint` | `agent-plan` | Short resume summary | — |
| `remember` | `agent-memory` | Durable fact for Continue / follow-ups | — |

Limits (constants in `agent-runner.ts`):

| Constant | Default |
|----------|---------|
| `MAX_AGENT_TURNS` | 16 |
| `MAX_TOOL_CALLS` | 40 |
| `CONTINUE_TURN_GRANT` / `CONTINUE_TOOL_GRANT` | +12 / +30 |
| `MAX_TOOL_RESULT_CHARS` | 80 000 (to the model) |
| `MAX_PERSISTED_OBSERVATION_CHARS` | 4 000 (history / UI) |

After a successful apply, the tool observation includes `VERIFY_AFTER_APPLY_NUDGE` so the model tends to call `verify`.

---

## 6. Writes and patches

### 6.1 Propose (Main — loop pauses)

1. Parse / coerce / repair JSON args (`agent-propose-actions`)
2. If arguments are truncated incomplete JSON with no recovered actions → error observation, **no** preview
3. `normalizeWorkspaceActions` → `previewWorkspaceActions`
4. `ai:needApproval` + `ai:step` (waiting approval)
5. `waitForApproval(callId)` blocks the tool loop (`agent-approval.ts` Map)

### 6.2 Apply (Renderer → Main FS)

1. ChatPanel / store show the same preview UI as Edit
2. User Apply → `fs.applyActions`
3. Main materializes actions; **`applyPatch`** is applied to on-disk text via `applyUnifiedDiff` (`src/utils/apply-patch.ts`) then stored as `writeFile`
4. Success → `ai:resolveApproval({ approved: true, detail })` → loop resumes
5. Reject → `approved: false` → loop continues (Agent may revise)
6. Apply failure → keep preview; **Ask Agent to fix** returns failure observation so the model can re-propose
7. Partial apply/reject empties the queue → resolve approval with applied/rejected detail

Preferred edit shape for existing files: **`applyPatch`** (unified diff with `@@` hunks), not full-file `writeFile`. Cursor-style `*** Begin Patch` wrappers are normalized away in the patch util.

---

## 7. Approvals and Continue

`agent-approval.ts` holds two Maps keyed by call/continue id:

| Pause | Main → UI | UI → Main |
|-------|-----------|-----------|
| File changes | `ai:needApproval` | `ai:resolveApproval` |
| Risky exec | `ai:needExecApproval` | `ai:resolveApproval` |
| Turn/tool budget | `ai:needContinue` | `ai:resolveContinue` |

On Continue = yes: budgets increase and **plan + memory** are re-injected as a user message (`injectOrientationAfterContinue`). On Continue = no: `ai:done`.

---

## 8. IPC event map

### Main → Renderer

| Channel | Purpose |
|---------|---------|
| `ai:chunk` | Assistant text delta |
| `ai:step` | High-level label (thinking, waiting approval, …) |
| `ai:toolStart` | Tool name + redacted args |
| `ai:toolResult` | ok / summary / truncated observation |
| `ai:needApproval` | Workspace action preview |
| `ai:needExecApproval` | Dangerous command gate |
| `ai:needContinue` | Budget exhausted |
| `ai:done` / `ai:error` / `ai:aborted` | Terminal |

### Renderer → Main

| Channel | Purpose |
|---------|---------|
| `ai:chat` | Start run |
| `ai:cancel` | Abort |
| `ai:resolveApproval` | File / exec decision |
| `ai:resolveContinue` | Extend budget or stop |

---

## 9. Context across turns and follow-ups

| Mechanism | Role |
|-----------|------|
| `agentSteps` on assistant messages | Timeline + history persistence |
| Prior tool context | Summarized observations re-injected on follow-up (`buildPriorAgentContext`) |
| Plan (`updateTodo` / `checkpoint`) | Checklist + resume note; rebuilt from history; re-injected on Continue |
| Memory (`remember` + auto observations) | Durable notes; rebuilt from history |
| Read cache | Avoid re-sending full file bodies within one run |

Secrets in args and observations go through `redactSecrets` / `redactSecretsInArgs`.

---

## 10. Module map

```
electron/services/
  agent-runner.ts           # runAgent, tools schema, turn loop, read/list/search/propose dispatch
  agent-approval.ts         # wait / resolve for approval & continue
  agent-propose-actions.ts  # JSON parse / coerce / incompleteness
  agent-exec.ts             # deny-list shell, risk classification
  agent-verify.ts           # test/lint/typecheck orchestration
  agent-plan.ts             # todos + checkpoint
  agent-memory.ts           # remember + observation capture
  agent-read-cache.ts       # in-run readFile cache
  agent-paths.ts            # workspace-relative path normalize
  ai-client.ts              # AbortController, headers, buildUserMessage, Ask/Edit stream
  filesystem.ts             # preview / apply / applyPatch materialize
  workspace-search.ts       # search backend

src/
  components/ChatPanel.tsx
  components/AgentStepTimeline.tsx
  stores/app-store.ts       # preview apply/reject, approval resolve
  utils/apply-patch.ts
  utils/workspace-actions.ts
  utils/agent-tools.ts      # tools-unsupported error codec
  utils/redact.ts
```

---

## 11. Message flow (overview)

```
┌─ Renderer (ChatPanel) ──────────────────────────┐
│  send mode=agent                                 │
│  subscribe chunk / tool* / step / approval / done│
│  agentSteps → timeline + history                 │
└────────────────────┬────────────────────────────┘
                     │ ai:chat
┌────────────────────▼────────────────────────────┐
│  Main: runAgent                                  │
│  ┌─ turn loop ─────────────────────────────────┐ │
│  │  streamAgentTurn (LLM SSE)                  │ │
│  │  tool_calls → execute / proposeActions      │ │
│  │  proposeActions / risky exec / budget ──┐   │ │
│  │                                         ▼   │ │
│  │                              waitFor* Maps  │ │
│  └─────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────┘
                     │ ai:needApproval
┌────────────────────▼────────────────────────────┐
│  Preview UI (same as Edit)                       │
│  apply → fs.applyActions → resolveApproval(true) │
│  reject / fix → resolve → loop continues         │
└─────────────────────────────────────────────────┘
```

---

## 12. Related docs

| Document | Use when |
|----------|----------|
| [AGENT_PLAN.md](./AGENT_PLAN.md) | Phase checklist, open design decisions, deferred work |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Process / IPC layout |
| [SPEC.md](./SPEC.md) | Product boundaries Ask / Edit / Agent |
| [USE_CASE_PRESET.md](./USE_CASE_PRESET.md) | Use-case presets (orthogonal to mode) |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Where to edit code in day-to-day development |
