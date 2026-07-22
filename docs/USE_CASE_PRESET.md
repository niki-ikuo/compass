# Use-case preset specification

**English** | [日本語](ja/USE_CASE_PRESET.md)

Product spec for **use-case presets** (`general` / `document` / `data` / `code`) that position Compass as an **AI workspace** for local folders (text work: notes, docs, data, code — not a code-only IDE).

Related: [SPEC.md](./SPEC.md) (Ask / Edit / Agent), [ARCHITECTURE.md](./ARCHITECTURE.md)

**Status:** Implemented (UI header + settings / workspace defaults + system-prompt roles + Agent light verify for document/data + data-use-case `profileData` / `queryData`)

---

## 1. Goal

Keep Compass strengths (folders, Ask / Edit / Agent, diff approval, terminal) and serve anyone who works with text in a local folder — notes, docs, data, and code.

Out of scope for this direction:

- Dropping the Monaco editor
- Building a large dashboard product
- Turning Compass into a catch-all app
- Depending on Office integration

---

## 2. Definition and orthogonal axes

A **use-case preset** chooses *what kind of expert* the model is.  
**Ask / Edit / Agent** choose *how it acts*. Do not merge them.

| Axis | Values | Controls |
|------|--------|----------|
| Use case | `general` / `document` / `data` / `code` | Role, tone, preferred files, domain cautions in the system prompt |
| Mode | `ask` / `edit` / `agent` | Whether changes are allowed, output format, tools |

```
final system ≈ use-case layer + mode layer
```

Keep them in separate UI controls as well.

---

## 3. Four presets

| ID | UI label | Best for | Model self-image |
|----|----------|----------|------------------|
| `general` | General | Note tidy-up, task breakdown, folder overview | General workspace assistant |
| `document` | Document | Plans, minutes, procedures, summarize, structure | Document-editing assistant |
| `data` | Data | Organize / explain CSV, JSON, YAML | Data-wrangling assistant |
| `code` | Code | Implement, refactor, review | Coding assistant |

**Default:** `general` (AI workspace default). Saved app/workspace settings are kept as-is.

### UI order

`general` → `document` → `data` → `code` (broad → specialized; default first)

### Copy

| ID | Label | One-line description |
|----|-------|----------------------|
| general | General | Tidy notes, break down tasks |
| document | Document | Polish plans, minutes, procedures |
| data | Data | Organize CSV / JSON / YAML |
| code | Code | Implement, review, refactor |

---

## 4. What changes / what does not

### Change in v1

1. System-prompt **role** (“You are a coding assistant” becomes use-case-specific)
2. Context priority guidance (code structure / headings / schema / whole folder)
3. Answer style (structure for docs, columns/types for data, short tidy-up for general)
4. UI labels (select names + short descriptions)

### Do not change in v1

- Ask / Edit / Agent routing
- `compass-actions` / `proposeActions` format
- Agent tool list
- `verify` contents (still test / lint / typecheck) — use-case-specific verify later
- Index generation itself (heading index is a separate task)
- `temperature` / `maxTokens` (stay global)

---

## 5. Prompt policy per preset

Keep mode constraints (Edit requires `compass-actions`, Ask forbids changes, etc.). Swap the opening role and use-case hints.

### `code` (current behavior)

- Prefer code, dependencies, and the `.compass` index
- Substantially match existing `ai.*SystemPrompt`

### `document`

- Focus on Markdown / plain-text polish, structure, and summary
- Prefer heading hierarchy, consistent terms, readability
- Prefer small, readable patches over full-file rewrites
- Clarity for readers over “correct implementation”
- Ask: outlines / summaries / review. Edit / Agent: apply to `.md` and similar

### `data`

- Treat CSV / JSON / YAML as structure
- Prefer column names, types, missing values, duplicates, nesting
- Avoid schema-breaking edits (no silent column/key renames, etc.)
- For large tables: summary + examples; name rows/keys when needed

### `general`

- Notes, tasks, mixed text in a folder
- Organize, classify, suggest next actions without over-asserting
- Soften domain-specific rules; avoid heavy jargon

---

## 6. Prompt composition

Today `getSystemPrompt(mode)` returns the full mode prompt. After presets:

```
system = [
  rolePrompt(preset),   // role, tone, preferred targets
  modePrompt(mode),     // Ask / Edit / Agent constraints (mostly current)
].join('\n\n')
```

Or replace a role placeholder inside the mode prompt.

**Reminders** (end of `buildUserMessage`):

- Keep mode reminders as today
- Optional short use-case reminder in v1 (e.g. “document: don’t break headings”)
- Do not change Agent verify wording in v1

i18n keys (example): `ai.preset.code.role` / `document` / `data` / `general` (ja / en)

---

## 7. State and persistence

| Layer | Key | Role |
|-------|-----|------|
| Request | `ChatRequest.preset` | Value that actually applies |
| Message | `ChatMessage.preset?` (user) | Restore from history (same pattern as `mode`) |
| UI | `sendPreset` in `ChatPanel` | Current chat selection |
| Settings | `AppSettings.defaultUseCasePreset` | Default for new chats / startup |
| Workspace | `.compass/settings.json` → `defaultUseCasePreset` | Folder default; overrides app settings |

**Resolve order on send:**

1. Current chat UI selection
2. Workspace default (`.compass/settings.json`)
3. `defaultUseCasePreset`
4. Fallback `general` (`DEFAULT_USE_CASE_PRESET`)

**Session switch:** restore `preset` from the last user message in that session; otherwise settings default.

**Mid-chat change:** allowed; applies from the next send (do not rewrite history).

**vs model picker:** model may persist to settings immediately from the composer. Use-case “current selection” stays chat-local; only Settings (app / workspace) changes the default.

### Types (sketch)

```ts
export type UseCasePreset = 'general' | 'document' | 'data' | 'code'

// ChatRequest / ChatMessage(user)
preset?: UseCasePreset

// AppSettings (required, default 'general')
defaultUseCasePreset: UseCasePreset

// WorkspaceSettings (.compass/settings.json)
defaultUseCasePreset?: UseCasePreset
```

---

## 8. UI placement

### Primary: chat composer footer (beside mode)

```
[history] [+] …
────────────────────────────────
messages…
────────────────────────────────
[ Ask / Edit / Agent ▼ ] [ Use case: General ▼ ] [ Model ▼ ]  [Send]
```

- Do not put presets in the Ask / Edit / Agent picker
- Four options + short descriptions
- Composer change is chat-local; does not rewrite settings default

### Secondary: SettingsDialog

- “Default use-case preset” (app) near Appearance or LLM
- “Workspace default use-case preset” when a folder is open (stored in `.compass/settings.json`)
- Optional “Remember last use case” toggle  
  - ON: update `defaultUseCasePreset` after a successful send  
  - OFF: settings value only

### Avoid

- Settings only (too hard to switch → presets lose value)
- Adding “Document” into Ask / Edit / Agent (mixes “explain-only” with “document-oriented”)
- Burying it in the menu bar

---

## 9. Combinations with mode

| | Ask | Edit | Agent |
|---|-----|------|-------|
| **code** | Explain / review | Patch proposals | Inspect → propose → verify |
| **document** | Summarize / outline | Edit `.md` etc. | Read by heading, reshape docs, light verify (headings / links) |
| **data** | Schema / quality notes | Fix JSON / YAML / CSV / TSV | `profileData` / `queryData`, reshape, schema verify |
| **general** | Organize / break down | Update note files | Folder overview + tidy proposals |

Approval flows (Edit / Agent) stay the same. The preset only changes *what* is written.

---

## 10. Scope split

### v1 (this spec) — shipped

- Type: `UseCasePreset`
- `ChatRequest` / user `ChatMessage` / `AppSettings.defaultUseCasePreset`
- Composer select + settings default
- Role swap in prompts (ja / en)
- `code` behaves like today (regression)

### v1.5 — shipped

- Short per-preset user reminders
- “Remember last use case”
- Workspace default preset (`.compass/settings.json`)
- Templates (built-in Markdown + workspace `.compass/templates/`)
- Agent light verify for document / data (`agent-verify-light.ts`)

### Document Agent strengthen — shipped

- Markdown `readFile` with optional `heading` for section reads
- Document light verify: duplicate headings and broken relative `.md` links
- Index context prioritizes Documents and follows sibling / doc links

### Data Agent tools — shipped

- `profileData` / `queryData` (data use-case only): column profiles + read-only in-memory SQLite SELECT sandbox (`agent-data-sandbox.ts`)
- Stronger data verify: duplicate first-column / id keys, mixed column types, TSV support

### Later (related work)

- Document-oriented index (headings / summaries beyond light verify)
- Stronger Markdown UX (preview toggle, outline jump, readable doc diffs)
- Broader chat references (multi-file sets, images, PDF text extraction)
- MCP / plugins (core stays folder + approved AI; external skills via extensions)

---

## 11. Acceptance (v1)

1. Composer can switch among four presets and the next send’s system prompt reflects it
2. Preset is independent of Ask / Edit / Agent (not the same dropdown)
3. New chats start from `defaultUseCasePreset` (workspace default wins when set)
4. Session restore brings back the last sent preset
5. `code` + existing modes behave substantially like today
6. `document` reduces code-centric phrasing on doc tasks (manual check OK)

---

## 12. Fixed design decisions

1. **Use case ≠ mode**
2. **v1 is prompt + UI + persistence only** (no tool / index changes)
3. **Composer for the active chat; Settings (app / workspace) for the default**
4. **Unset → `general`** (workspace-first default; existing saved settings keep their value)

---

## 13. Suggested follow-on order

After shipping presets:

1. Use-case presets (document / data / general) ← this spec v1 (shipped)
2. Markdown UX + document-friendly diffs
3. Heading / summary-based index
4. Image / PDF text as references
5. Light per-preset checks and templates (light verify / templates shipped)

**Already useful without extra features:** polish Markdown plans / procedures / minutes (Edit / Agent); tidy JSON / YAML / CSV; open a notes folder and Ask for summary / organization.
