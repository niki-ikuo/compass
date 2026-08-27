# Agent code-generation plan

**English** | [日本語](ja/AGENT_CODEGEN_PLAN.md)

Close the **code-generation** gap between Compass Agent and Cursor Agent. This is an assignment document: quote a phase range, do not start the next phase until the current **Done** is met.

Phases **1–7 in this file** are assignment slices. They are not [AGENT_PLAN.md](./AGENT_PLAN.md)’s v2.0 Phase 1–4 (already shipped).

Runtime today: [AGENT.md](./AGENT.md). Shipped v2.0 phases: [AGENT_PLAN.md](./AGENT_PLAN.md). Product boundary: [SPEC.md](./SPEC.md). Current capability snapshot (after Phases 1–7): [CODE_AGENT_COMPARISON.md](./CODE_AGENT_COMPARISON.md).

**Compared against (this assignment doc):** Compass 2.2.x Agent (Phases 0–4 shipped) vs Cursor IDE Agent public tool surface — the starting point for Phases 1–7. Appendix A still describes that older surface. For the post-2.5 inventory use [CODE_AGENT_COMPARISON.md](./CODE_AGENT_COMPARISON.md). Model weights and Cursor’s private prompt are out of scope.

---

## How to assign work

Say one of these. Do not say “make it like Cursor.”

| You say | Means | Phases |
|---------|--------|--------|
| **Phase 1 only** | Find files and identifiers | 1 |
| **Through Phase 2** | Find + surgical edits | 1–2 |
| **Must** | Code-gen loop can complete a medium change | 1–6 |
| **Must + should** | Same, plus runtime polish | 1–7 |
| **Phase N** | That slice only (prereqs must already be shipped) | N |

Rules:

1. Implement in phase order. Do not start N+1 until N’s **Done** is true.
2. Each phase lists **In**, **Out (this phase)**, **Done**, **Touch**. Out means “do not build it here,” not “never.”
3. Keep the constraints in §Constraints. Do not copy Cursor’s write-without-preview as the only path.
4. Do not thicken `applyPatch` repair, propose JSON coercion, or nudge copy. Those are compensating for bad tools.

---

## Constraints (keep)

1. Tools and FS stay in **Main**. Renderer uses `window.compass` only.
2. Paths stay inside the open workspace (`resolveInsideWorkspace`).
3. Writes go through the existing preview / apply / undo path (including `autoApplyAgentWrites`). Do **not** remove the approval gate. Change the **generation contract** (file-unit tools), not the safety model.
4. Keep `replaceSection`, `searchMeaning`, `profileData` / `queryData`, document/data light verify, secret redaction, sensitive-path blocks, exec deny-list.
5. Ask / Edit / Agent stay separate. Use-case presets stay orthogonal. This plan does **not** rewrite Edit’s `compass-actions` unless a later phase says so.
6. OpenAI-compatible `tools` API. Tools-less providers still hide Agent.

---

## Do not implement in this plan

| Item | Why |
|------|-----|
| MCP / plugins / native non-OpenAI APIs | SPEC v3.0. After Must. |
| Subagents (`Task`) | Useless until Grep / Glob exist. |
| Browser automation | UI verify later; Compass already has a browser tab. |
| Plan / Debug modes | `updateTodo` is enough. |
| Skills / `.cursor/rules` clone | `instructions.md` is enough. |
| Shipping ripgrep as a binary | `workspace-search.ts` already has regex / glob. |
| More `applyPatch` fuzzy parse / `*** Begin Patch` repair | Wrong primitive. |
| More proposeActions JSON salvage / truncation recovery | Split writes per file instead. |
| Richer `remember` / `checkpoint` / nudge text | Compensating controls. |
| GitHub PR auth, commit/push from Agent | Read-only git in Phase 5 only. |
| Cursor Composer / custom model training | BYOK stays. |

---

## Phases

Status: Phase 1–7 (Must + should) **done**.

### Phase 1 — Find

**Assign as:** “Phase 1 only” or first slice of Must.

Wire capabilities the Search panel already has. Add a glob tool so the model stops walking `listDir` one level at a time.

**In**

- [x] Agent `search`: `useRegex`, `include` / `exclude` glob, `caseSensitive`, optional `wholeWord`, context lines (`-B`/`-A` or equivalent), higher caps (content hits well above 30; allow a files-with-matches style summary).
- [x] New tool `globFiles({ pattern, path? })` — workspace-relative, honor ignore rules, cap results (e.g. 200).
- [x] System prompt / `ai.agentModeReminder`: prefer `search` for exact identifiers, `globFiles` for path patterns, `searchMeaning` for topic/meaning.

**Out (this phase)**

- Changing Search panel UX
- Replacing or weakening `searchMeaning`
- Bundling ripgrep
- Recursive `listDir` (glob replaces that need)

**Done when:** Agent can find `export function foo` with regex, list `**/*.test.ts`, and return path + line + snippet without 10× `listDir`.

**Touch:** `electron/services/agent-runner.ts` (`AGENT_TOOLS`, `executeSearch*`), `electron/services/workspace-search.ts`, `src/i18n/messages.ts` (`ai.agentSystemPrompt`, `ai.agentModeReminder`), tests.

**Depends on:** nothing.

---

### Phase 2 — Edit primitives

**Assign as:** “Through Phase 2” after Phase 1 is Done.

Replace “unified diff inside one JSON batch” with file-unit tools. Preview / apply / undo stay.

**In**

- [x] Tools: `strReplace({ path, oldString, newString, replaceAll? })`, `writeFile({ path, content })`, `deleteFile` / `deleteDir` / `mkdir` as their own calls (one path per call).
- [x] Each successful call enqueues the same preview items as today (or auto-applies when `autoApplyAgentWrites` allows). Truncating one file must not discard other files’ proposals.
- [x] `strReplace` is exact string match (unique `oldString` unless `replaceAll`). On mismatch: error observation, tell the model to `readFile` (force) and retry — no unified diff.
- [x] Prompt: prefer `strReplace` for existing files; `writeFile` for new / tiny full rewrites; `replaceSection` for one Markdown chapter. Ban `*** Begin Patch`.
- [x] `proposeActions` / `applyPatch`: deprecate in Agent prompt. May remain for compatibility this phase; do not add more repair.

**Out (this phase)**

- Rewriting Edit mode `compass-actions`
- Removing the preview UI or Undo
- Deleting `replaceSection`
- Auto-applying deletes or sensitive paths
- More hunk fuzzy matching

**Done when:** a multi-file change is proposed as several tool calls; one truncated `writeFile` does not wipe the rest; existing-file edits succeed via exact replace more often than `applyPatch`.

**Touch:** `agent-runner.ts`, `agent-propose-actions.ts`, `filesystem.ts` / preview apply, `src/utils/workspace-actions.ts`, ChatPanel preview queue, `ai.agentSystemPrompt`, tests (`agent-runner`, apply, auto-apply).

**Depends on:** Phase 1 recommended (model should have found the right strings). Can start after Phase 1 if assignment says so.

---

### Phase 3 — Read

**Assign as:** part of Must; after or in parallel with Phase 2 if staffed separately (no tool-schema clash).

**In**

- [x] `readFile`: 1-based line numbers on returned text; `offset` + `limit` (line-based); keep `heading` for Markdown; keep `force` cache bypass.
- [x] Truncation notice includes “use offset/limit” rather than only dumping 200KB.

**Out (this phase)**

- Raising the 200KB cap as the main fix
- Image-as-tool (later)
- Changing Office/PDF extractors

**Done when:** Agent can read lines 80–140 of a large `.ts` file and cite those line numbers.

**Touch:** `agent-runner.ts` `executeReadFile`, `agent-read-cache.ts`, tests.

**Depends on:** nothing strictly; best after Phase 1.

---

### Phase 4 — Diagnostics on touched files

**Assign as:** part of Must. After Phase 2 (needs applied paths).

**In**

- [x] After apply (or as `readLints({ paths })`): diagnostics for **changed files only** (TypeScript / ESLint or project-equivalent, not `eslint .` of the whole repo).
- [x] Observation is structured enough to fix (file, line, message). Model then `strReplace`.
- [x] Keep `verify` for full test/lint/typecheck scripts. Prompt: prefer file diagnostics after edits; `verify` before finishing a coding task.

**Out (this phase)**

- Replacing document/data light verify
- Full-project `verify` rewrite
- Shipping an LSP server

**Done when:** a type error on a just-edited file comes back as a tool observation without running the entire test suite.

**Touch:** new helper (e.g. `agent-lints.ts`), `agent-runner.ts`, `agent-verify.ts` (call order only), prompt, tests.

**Depends on:** Phase 2.

---

### Phase 5 — Git read-only

**Assign as:** part of Must. Mostly wiring `electron/services/git.ts`.

**In**

- [x] Inject a compact dirty summary into the Agent user payload (status names, not a full diff dump).
- [x] Tools: `gitStatus`, `gitDiff({ path?, side? })` — read-only, workspace git, existing caps.
- [x] Prompt: look at git status before overlapping an in-progress change.

**Out (this phase)**

- `git commit` / `push` / `pull` / branch switch as Agent tools
- GitHub auth / PR
- Replacing the Git panel

**Done when:** Agent sees unstaged files without `exec git status`, and can fetch one file’s diff.

**Touch:** `git.ts`, `ai-client.ts` `buildUserMessagePayload`, `agent-runner.ts`, prompt, tests.

**Depends on:** nothing strictly.

---

### Phase 6 — Web read

**Assign as:** last Must slice. Network is a product risk; keep the gate.

**In**

- [x] `webSearch({ query })` and `fetchUrl({ url })` — GET/read, size cap, timeout, secret redaction.
- [x] Approval or allowlist for network (same spirit as exec network approval). No silent exfil.
- [x] Prompt: use for current library APIs / docs; do not invent APIs when the page is available.

**Out (this phase)**

- MCP
- Arbitrary POST / authenticated scraping
- Bundling a search-engine API key as a required product dependency (document if a provider is needed)

**Done when:** Agent can look up a library’s current function signature and cite the URL, without `exec curl`.

**Touch:** new `agent-web.ts` (Main only), `agent-runner.ts`, approval IPC if needed, prompt, tests.

**Depends on:** nothing strictly; after Phase 1–2 so the model can apply what it fetched.

---

### Phase 7 — Should (runtime polish)

**Assign as:** “Must + should” or individual bullets. Do not start until Must (1–6) is Done unless you only want budget/parallel and write tools already exist.

**In**

- [x] **7a Parallel:** independent read tools in one turn (`readFile` / `search` / `globFiles` / `gitStatus`) run concurrently. Writes and `exec` stay serial / gated.
- [x] **7b Budget:** raise default turns/tools so a medium refactor does not hit Continue only because of investigation. Stop burning full LLM turns on nudge copy once tools exist (delete or shrink missing-propose / plan nudges).
- [x] **7c exec:** higher timeout and output cap for test/build; keep deny-list and write-risk approval. No interactive PTY merge.
- [x] **7d Context / prompt:** inject open editor paths; rewrite `ai.agentSystemPrompt` to drop patch ritual; keep role + safety + tool names.

**Out (this phase)**

- Subagents, MCP, Plan mode, background long-running watchers as a product feature
- Merging Agent exec into the user terminal

**Done when:** a typical multi-file coding task finishes without Continue, with parallel reads, and the system prompt is not a unified-diff manual.

**Touch:** `agent-runner.ts` loop, constants, `ai-client.ts` payload, `messages.ts`, `agent-exec.ts` caps, tests.

**Depends on:** Phases 1–6.

---

## Later (not this plan)

After 1–7, in this order if ever: MCP → GitHub PR → subagents → browser-driven verify → Plan mode. Do not pull these into a “Must” assignment.

---

## Appendix A — Comparison (assignment labels)

**Must** = ship in Phases 1–6. **Should** = Phase 7. **Later** = after this plan. **Keep** = do not copy Cursor if Compass is stronger. **Skip** = do not invest.

### Find

| Item | Cursor | Compass | Label | Phase |
|------|--------|---------|-------|-------|
| Identifier / regex search | Grep: regex, glob, type, context, files_with_matches | `search`: literal, max 30, 5 lines/file | Must | 1 |
| File-name search | Glob `**/*.test.ts` | `listDir` one level, max 200 | Must | 1 |
| Meaning search | Internal + Grep | `searchMeaning` | Keep | — |
| Search backend | rg-class from Agent | UI already has regex/glob; Agent schema does not | Must | 1 |

### Read

| Item | Cursor | Compass | Label | Phase |
|------|--------|---------|-------|-------|
| File read | Line numbers, offset/limit, parallel | Full file ~200KB, no line numbers | Must | 3 |
| Directory listing | Glob | One-level `listDir` | Must | 1 |
| Office / PDF | Weak | Extracted text | Keep | — |
| Tabular data | Read or shell | `profileData` / `queryData` | Keep | — |
| Images as tool | Read images | Payload max 2 images, not an Agent tool | Later | — |

### Edit / apply

| Item | Cursor | Compass | Label | Phase |
|------|--------|---------|-------|-------|
| Existing-file edit | StrReplace exact match | `applyPatch` unified diff in JSON | Must | 2 |
| New file | Write, one file per call | `writeFile` inside one `actions` array | Must | 2 |
| Multi-file | Per-file tools | One batch; truncate drops all | Must | 2 |
| Delete | Delete tool | Inside `proposeActions` | Should | 2 |
| Markdown chapter | StrReplace | `replaceSection` | Keep | — |
| When it hits disk | At tool time | Preview until approve (auto-apply optional) | Must (contract) / Keep (gate) | 2 |
| Preview / Undo | Weak gate | Same as Edit; Undo history | Keep | — |
| Patch repair | Not needed | Identical-hunk block, writeFile fallback, fuzzy hunks | Skip | — |

### Run / verify

| Item | Cursor | Compass | Label | Phase |
|------|--------|---------|-------|-------|
| Shell | Long-running, background, parallel | 30s default / 120s max, 64KB, gated writes | Should | 7c |
| Dangerous commands | Policy | Deny-list for wipe/OS destroy | Keep | — |
| File diagnostics | ReadLints on touched files | None; `verify` is package scripts | Must | 4 |
| Full test/lint | Shell | `verify` templates | Should | 7 |
| Document/data verify | None | Light verify | Keep | — |

### Context

| Item | Cursor | Compass | Label | Phase |
|------|--------|---------|-------|-------|
| Current file / selection | + recently viewed | Current file + selection | Should | 7d |
| @-mentions | @Files etc. | Explorer + `@[path]` | Keep | — |
| Git state | status/diff injected | Git panel exists; Agent does not see it | Must | 5 |
| User terminal output | Shell shared | PTY ≠ exec | Later | — |
| Rules | `.cursor/rules`, Skills | `instructions.md` | Later | — |
| Structure index | Internal | `.compass` index + excerpts | Keep | — |
| Historical tool results | Keep real observations | One summary blob, 4k observation cap | Should | 7 |

### Loop

| Item | Cursor | Compass | Label | Phase |
|------|--------|---------|-------|-------|
| Loop shape | model → tools → observe | Same + nudges | Keep | — |
| Parallel tools in one turn | Yes for independent I/O | Sequential `for await` | Should | 7a |
| Budget | Enough for medium refactors | 16 turns / 40 tools; nudges consume turns | Should | 7b |
| Context prune | Survives long chats | ~180k tok, tool pairs removed together | Keep | — |
| Subagents | Task | Single loop | Later | — |
| Cancel | Abort stream | `ai:cancel` | Keep | — |
| Provider | Composer + external | BYOK OpenAI-compatible; Ollama hides Agent | Keep | — |

### External

| Item | Cursor | Compass | Label | Phase |
|------|--------|---------|-------|-------|
| Web search / fetch | WebSearch / WebFetch | None | Must | 6 |
| MCP | Dynamic tools | SPEC v3.0, not started | Later | — |
| GitHub / PR | gh + MCP | Panel has commit/push; no PR; not Agent tools | Later | — |
| Browser drive | Yes | Tab exists; Agent cannot drive it | Later | — |

### Plan / prompt

| Item | Cursor | Compass | Label | Phase |
|------|--------|---------|-------|-------|
| Checklist | TodoWrite | `updateTodo` cap 8 | Keep | — |
| checkpoint / remember | Unneeded | Budget workaround | Skip | — |
| Modes | Agent / Plan / Debug / Ask | Ask / Edit / Agent + presets | Keep | — |
| Plan mode | Design-first | Todo nudge only | Later | — |
| System prompt | Ops rules; tools carry the contract | Patch-ritual wall of text | Should | 7d |
| Nudges | Almost none | Plan / propose / open-todo | Skip | 7b (shrink) |

### Safety / ops

| Item | Cursor | Compass | Label | Phase |
|------|--------|---------|-------|-------|
| Workspace sandbox | Project-scoped; shell is wide | Workspace-only; secrets blocked | Keep | — |
| Secret redaction | Mixed | `redactSecrets` | Keep | — |
| Auto-apply | Effectively default write | Setting; deletes/sensitive stay manual | Keep | — |
| Scheduled runs | Cloud agents | Windows headless jobs | Keep | — |
| Tools-unsupported UX | Rare | Hide Agent + Edit fallback | Keep | — |

---

## Appendix B — Implementation order (one line)

1. Find (regex search + glob) → 2. File-unit strReplace/write → 3. Line-numbered read → 4. Lints on touched files → 5. Git read-only → 6. Web read → 7. Parallel / budget / exec / prompt.

If you only have one slice: **Phase 1**. If you want code-gen to actually land: **through Phase 2**. If you want Cursor-class coding loops: **Must (1–6)**.
