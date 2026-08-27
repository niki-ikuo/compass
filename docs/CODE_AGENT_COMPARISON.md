# Code-use-case Agent comparison: Compass vs Cursor

**English** | [日本語](ja/CODE_AGENT_COMPARISON.md)

Snapshot of **Compass Agent with the `code` use-case preset** against **Cursor IDE / Desktop Agent**.

This is a capability inventory, not an assignment list. To close a gap, quote a phase in [AGENT_CODEGEN_PLAN.md](./AGENT_CODEGEN_PLAN.md). Runtime behaviour: [AGENT.md](./AGENT.md). Use-case vs mode: [USE_CASE_PRESET.md](./USE_CASE_PRESET.md).

**Compared:** Compass 2.5.9 Agent (`preset: code`) vs Cursor Agent public docs (2026-08). Model weights and Cursor’s private system prompt are out of scope.

**Sources:** Compass `electron/services/agent-runner.ts` (`AGENT_TOOLS` and runtime constants). Cursor Agent overview, tools, run-modes, cloud, MCP.

---

## 1. Verdict

The **core coding loop** (find → replace → diagnose → short command) has caught up. Compass still loses on **finishing the job** (Plan / Debug, subagents, MCP, browser verification, PRs, cloud, Skills) and on **write speed**. Compass wins where it chose to: approval gates, sandbox, secret redaction, BYOK, Office extraction, local unattended jobs on Windows.

Same work, same number of turns, same scale of refactor: **not yet true**. Speed and autonomy → Cursor. Review and local control → Compass. The product spec already says Cursor parity is not the goal.

| Count | Verdict |
|-------|---------|
| 24 | Cursor ahead |
| 8 | Compass ahead |
| 11 | Roughly equal |
| 4 | Different design (not a score) |
| **47** | **Total** |

“Cursor ahead” is not always a Compass defect. The products have different centres of gravity. “Equal” is the range shipped in codegen plan Phases 1–7.

### What the `code` preset actually changes

The preset is a **role**, not a second runtime. For `code`:

- System role: coding assistant; prefer code, dependencies, `.compass` index
- `verify` runs project test / lint / typecheck
- `profileData` / `queryData` are **not** registered (those are `data` only)

Tool names, budgets, and the approval gate are the same as `general`. Cursor is a coding-agent product. Compass is a folder workspace with a coding role.

---

## 2. How to read the tables

| Label | Meaning |
|-------|---------|
| **Cursor ahead** | Cursor is stronger for coding work as of this snapshot |
| **Compass ahead** | Compass is stronger — often by design, not by accident |
| **Roughly equal** | Good enough for the same class of coding task |
| **Different design** | Trade-off, not a ranking |

---

## 3. What this means in practice

### Still lose at (Cursor)

- Parallel exploration across a large tree or multiple repos
- Driving a browser to verify UI
- Opening a GitHub PR and following CI
- Instrumented debug (hypothesize → log → reproduce → fix)
- Calling in-house MCP / Linear / custom tools from the agent
- Injecting a course correction without stopping the run

### Why pick Compass for code anyway

- Diff review before disk (deletes always need a human)
- Bring your own API keys and models; no product subscription lock-in
- Paths stay in the workspace; secrets are stripped from observations
- Read spec PDFs / xlsx in the same folder while implementing
- Local unattended Agent jobs via Windows Task Scheduler
- Small patches can use **Edit** instead of a full Agent loop

---

## 4. Position

Misread this section and every later table is wrong. The comparison is **IDE coding-agent core** vs **folder-app code use-case**.

| Item | Cursor Agent | Compass Agent (`code`) | Verdict |
|------|--------------|------------------------|---------|
| Product centre | Cursor *is* a coding agent. The editor is the execution surface | AI workspace for local folders. Agent is one mode beside Ask / Edit. Code is one of four presets | Different design |
| What `code` changes | Everything is code-first: tools, UI, models | Role prompt + `verify` (test/lint/typecheck). Tool set matches `general`. No data sandbox tools | Cursor ahead |
| Surfaces | Desktop / Agents Window / CLI / Cloud / Web / iOS / Slack · GitHub · Linear | Windows Electron app. Same-machine headless schedule. No CLI, cloud, or mobile | Cursor ahead |
| Billing and models | Subscription. First-party agentic models (Composer, Grok, …) plus third-party | App is local. LLM is BYOK OpenAI-compatible. No first-party model or router. Providers without tools (e.g. Ollama) hide Agent | Different design |
| IDE base | VS Code fork. LSP, debugger, extensions, multi-root | Monaco in a custom shell. No extension ecosystem. No bundled language server | Cursor ahead |

---

## 5. Modes and adjacent surfaces

How many ways there are to start coding work — not Agent in isolation.

| Item | Cursor Agent | Compass Agent (`code`) | Verdict |
|------|--------------|------------------------|---------|
| Chat modes | Agent / Ask / Plan / Debug. Plan investigates then writes a plan file; implement after approval. Debug instruments → user reproduces → targeted fix | Ask (no writes) / Edit (one-turn proposal) / Agent (tool loop). No Plan or Debug. `updateTodo` is the stand-in | Cursor ahead |
| Edit equivalent | Inline Edit (Cmd+K) is a selection one-shot. Rules do not apply | Edit mode proposes multi-file changes with preview, no tool loop. Simple fixes need not spin up Agent | Compass ahead |
| Inline Tab | Multi-line, cross-file prediction, jump — a reason people pay | Ghost text after a pause, Tab to accept. No cross-file prediction | Cursor ahead |
| Steer mid-run | Queue follow-ups, inject immediately, Stop, Steer. Change direction without wiping the chat | Cancel (`ai:cancel`). No queue or mid-run inject. Finish or abort | Cursor ahead |

---

## 6. Find and read

Core contract shipped in 2.5. Remaining gap is engine depth and non-source reads.

| Item | Cursor Agent | Compass Agent (`code`) | Verdict |
|------|--------------|------------------------|---------|
| Identifier / regex search | Grep / Instant Grep. regex, glob, type, context lines, counts, files_with_matches | `search`. `useRegex`, include/exclude glob, `wholeWord`, 0–8 context lines, max 200 hits. JS regex, not ripgrep | Roughly equal |
| Filename search | Glob. `**/*.test.ts` in one call | `globFiles`. Same job. Honors ignore, max 200. `listDir` stays one level (glob covers deep trees) | Roughly equal |
| Meaning search | Semantic codebase index, used with Grep | `searchMeaning`. Hybrid embeddings, path / heading / snippet. Max 30. Strong for “where is this topic?” | Roughly equal |
| Source read | Read. Line numbers, offset/limit, parallel, images | `readFile`. 1-based lines, offset/limit, Markdown `heading`, ~200KB, in-run cache. Parallel reads | Roughly equal |
| Images | File Read as vision input. Image generation exists | User payload: max 2 images, ~75KB base64 each. Agent `readFile` does not vision-load images | Cursor ahead |
| PDF / Office | Weak; not the main job of a code IDE | PDF / docx / xlsx as extracted text. Specs and tables in the same folder | Compass ahead |

---

## 7. Edit and write to disk

Generation contract is aligned. Remaining difference is **when** bytes hit disk and **how** you rewind.

| Item | Cursor Agent | Compass Agent (`code`) | Verdict |
|------|--------------|------------------------|---------|
| Existing files | StrReplace (exact). On miss, re-read and try another string | `strReplace` (exact; unique unless `replaceAll`). One path per call. `proposeActions` / `applyPatch` remain as deprecated compatibility | Roughly equal |
| Create / delete / mkdir | Write / Delete, per file | `writeFile` / `deleteFile` / `deleteDir` / `mkdir`, per file. Deletes are never auto-applied | Roughly equal |
| When disk changes | At tool execution. Diff after the fact; reject allowed. Default is fast | Preview approval is default. `autoApplyAgentWrites` can apply immediately. Deletes and sensitive paths stay human. Coding speed drops | Different design |
| Rewind | Checkpoints before large edits. Files only; not Git. Chat stays | Apply Undo and editor Undo. No per-Agent-run filesystem snapshot | Cursor ahead |
| Markdown chapter replace | StrReplace | `replaceSection`. Rare in code work; right for README chapters | Compass ahead |

---

## 8. Run and verify

If this layer is thin, the agent “fixed it” without evidence.

| Item | Cursor Agent | Compass Agent (`code`) | Verdict |
|------|--------------|------------------------|---------|
| Shell | Long-running, background, output watch, parallel. Run Modes for approval. Sandbox on macOS/Linux. Windows sandbox is officially weak | `exec`. Default 60s / max 300s, 200k chars, non-interactive. Separate from the user PTY. No background jobs | Cursor ahead |
| Dangerous commands | Allowlist / Auto-review classifier (can be wrong). `.cursorignore` does not stop the shell | Deny-list blocks OS destruction and workspace wipe. Writes and network need approval. Same rules on Windows | Compass ahead |
| Diagnostics on touched files | ReadLints. Broad LSP diagnostics | `readLints`. TypeScript / ESLint on changed paths. No bundled LSP. Empty if the language is outside that | Cursor ahead |
| Tests / lint / types as a suite | Shell (`npm test`, …). Read the failure log. Not a dedicated tool | `verify`. Package scripts or fallbacks. Contract: call before finishing a coding task. If skipped (no scripts), do not narrate the skip | Roughly equal |
| Runtime debug | Debug mode: hypotheses → instrumented logs → user reproduces → evidence-based fix | None. `exec` for logs, or the user reproduces | Cursor ahead |

---

## 9. Git / PR

Reading status is not the same as shipping a mergeable PR.

| Item | Cursor Agent | Compass Agent (`code`) | Verdict |
|------|--------------|------------------------|---------|
| Read status | status / diff / branch diff via context or tools | `gitStatus` / `gitDiff`. Short dirty summary on the user payload. Dedicated tools are read-only | Roughly equal |
| commit / push | Shell + UI. Commit-message generation, attribution. Agents Window commit / PR | Git panel: status/diff/stage/commit/push/pull/branch. Agent git tools cannot write. `exec git commit` is **not** on the deny-list (a hole) | Cursor ahead |
| PR / GitHub | `gh`, GitHub App, split-to-prs, babysit, Cloud opens a branch and PR | No PR create, no GitHub auth. Help docs say not available | Cursor ahead |
| Review automation | Agent Review, Bugbot, Security Agents, merge conflicts in chat | None | Cursor ahead |

---

## 10. Outside the workspace

Current library APIs, UI verification, in-house tools.

| Item | Cursor Agent | Compass Agent (`code`) | Verdict |
|------|--------------|------------------------|---------|
| Web search / fetch | WebSearch / Fetch. Dedicated backend. Auto-review | `webSearch`: DuckDuckGo HTML, max 8 hits, 12s. `fetchUrl`: GET, 15s, 80k chars, private hosts blocked. Works, thin | Cursor ahead |
| MCP | stdio / SSE / HTTP, OAuth, Apps. GitHub / Linear / browser as dynamic tools | Not shipped (SPEC v3.0). No connect UI | Cursor ahead |
| Browser control | Navigate, click, type, screenshot, console. Design Mode. Cloud computer use | Browser tab exists. Agent cannot drive it. UI checks are human eyes | Cursor ahead |
| Past-chat search | Agent searches prior chats itself | Workspace `chat-history.json`. No agent search tool | Cursor ahead |

---

## 11. Context and rules

The model does not get smarter between turns unless something is injected.

| Item | Cursor Agent | Compass Agent (`code`) | Verdict |
|------|--------------|------------------------|---------|
| Durable instructions | Project / User / Team rules, nested `AGENTS.md`, Skills, Plugins, Commands. Team enforce | `.compass/instructions.md` Role / Rules / Terms. One file. No nesting, glob, or Skills | Cursor ahead |
| @ mentions | Files, folders, Terminals, Chats, Git diffs, Browser | Explorer picks and `@[path]`. No @ for terminal output, browser DOM, or branch diff | Cursor ahead |
| Auto-attach | Open files, recently viewed, index | Current file (~30k tok), selection, open editor paths, `.compass` index slice. Weak recently-viewed list | Roughly equal |
| Long-term memory | IDE Agent Memories are thin in official docs. Automations have them. Rules are the real store | `remember` / `checkpoint` are in-conversation working memory for Continue. Not learned cross-chat memory | Roughly equal |
| Historical tool results | Keep real observations; summarize near the cap. Context ring shows the mix | Prior steps collapse to one summary. Persisted observation 4 000 chars. Long Agent chats degrade first | Cursor ahead |

---

## 12. Loop, parallelism, remote

Whether a mid-size refactor dies in investigation, and whether a large one can run in parallel.

| Item | Cursor Agent | Compass Agent (`code`) | Verdict |
|------|--------------|------------------------|---------|
| Basic loop | model → tools → observation. No documented tool-call cap | Same shape. Start 32 turns / 80 tools. Continue +16 / +50. Plan / open-todo / missing-write nudges consume turns | Cursor ahead |
| Same-turn parallel | Independent I/O together. Subagents in parallel too | Reads (`read` / `search` / `glob` / `git` / `lints`) in parallel. Writes and `exec` stay serial behind the gate | Roughly equal |
| Subagents | Explore / Bash / Browser + custom. Worktrees, best-of-n, cloud handoff | Single loop. Listed as later in the codegen plan | Cursor ahead |
| Context window | 200k–300k depending on model; some 1M | Input budget ~180k tok (chars÷3). Does not use the model’s advertised window | Cursor ahead |
| Cloud / unattended | Isolated VM, PRs, CI repair, Automations, `/loop` `/goal` | Windows Task Scheduler, local headless Agent. No VM, no GitHub trigger. Ahead for **local** unattended | Different design |

---

## 13. Safety and operations

What Compass trades for coding speed. Wins here are intentional.

| Item | Cursor Agent | Compass Agent (`code`) | Verdict |
|------|--------------|------------------------|---------|
| Path sandbox | Project-centric. Shell and MCP can read past ignore | Paths inside the workspace. Sensitive-path reads refused | Compass ahead |
| Secrets | Rules and classifier. Observation masking is inconsistent | `redactSecrets` on args and observations, including Web fetches | Compass ahead |
| Default write policy | Effectively write-by-default. Fast. Recovery is checkpoints and reject | Human sees the diff by default. Auto-apply is a setting. Deletes always human | Compass ahead |
| Tools-unsupported providers | Rare (first-party runtime) | Hide Agent; guide to Edit. Required for BYOK | Compass ahead |

---

## 14. Nature of the remaining gap

| Kind | What |
|------|------|
| **Closed in 2.5** | Regex search, glob, `strReplace`, numbered Read, `readLints`, git read, `webSearch` / `fetchUrl`, parallel reads, budget 32/80. The old failure mode (“the tools break before coding starts”) is gone. [AGENT_CODEGEN_PLAN.md](./AGENT_CODEGEN_PLAN.md) Phases 1–7 are **done**. Appendix A in that file still describes the pre-2.5 surface — do not treat it as current. |
| **Kept on purpose** | No write-to-disk by default. Approval gate, deny-list, BYOK, Ask / Edit / Agent split. SPEC: not a Cursor clone. |
| **Still a product gap** | MCP, subagents, Plan / Debug, browser verification, PRs, Cloud, Skills, mid-run queue, file checkpoints. These are “later” in the codegen plan and are the current loss column for coding. |

This table scores **coding Agent effectiveness for the same task**. Compass strengths in document / data presets are not extra points here.

---

## 15. Related docs

| Document | Use when |
|----------|----------|
| [AGENT.md](./AGENT.md) | How the tool loop actually runs |
| [AGENT_CODEGEN_PLAN.md](./AGENT_CODEGEN_PLAN.md) | Phase-scoped work to close a coding gap |
| [USE_CASE_PRESET.md](./USE_CASE_PRESET.md) | `code` vs `general` / `document` / `data` |
| [SPEC.md](./SPEC.md) | Product boundary vs Cursor; shipped / deferred |
| [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) | Approval gate, redaction, exec policy |
