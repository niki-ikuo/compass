# Clip — S-tier four features specification

**English** | [日本語](ja/DESK_LOOP.md)

Status: **Phase 1 implemented** (Capture / Clip / Outbox presets / Ship check Stage A + copy). Stage B, tray, etc. still later. Related: [SPEC.md](./SPEC.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [TEXT_WORKSPACE_PLAN.md](./TEXT_WORKSPACE_PLAN.md), [AI_APPLY_UNDO.md](./AI_APPLY_UNDO.md), [USE_CASE_PRESET.md](./USE_CASE_PRESET.md).

**Acceptance digested (2026-07-28):** Per-section checklists passed via unit tests + UI static review. Remaining: manual smoke of hotkey focus/open (product DoD demo).

Feature set that moves Compass from “an editor that writes and fixes” to a **workbench: capture → organize → check → ship**.  
The four features are not separate products. They are **four stops on one path**.

---

## 0. Bottom line

| Question | Answer |
|----------|--------|
| What do we build? | Capture hotkey / Clip / Outbox factory / Ship check |
| One experience? | External text → inbox → outbox draft → ship check → copy |
| Write path? | Prefer existing preview → Apply (do not add silent writes) |
| Cloud sync? | **No.** Local `.compass/` conventions only |
| MCP / real send? | Out of scope (later) |
| Two-week ship? | Phase 1 in §11. This doc is the full Phase 1–2 spec |

---

## 1. Goals and non-goals

### 1.1 Goals

1. **One intake** — drop text from Word / mail / browser into Compass  
2. **One desk** — see inbox / outbox in one place  
3. **Typed exits** — mail, minutes, report, chat drafts follow the same path  
4. **Stop before shipping** — secrets, TBD, glossary issues before copy  

### 1.2 Non-goals (whole spec)

- In-app Office editing, PDF export, print dialogs  
- Cloud sync, realtime multiplayer  
- Real send via Outlook / Gmail, COM automation  
- MCP host, extension marketplace  
- Meeting transcription  
- Full workspace backup/restore product  
- Dropping Apply approval for broader agent autonomy  
- Weekly digest (resume-cost summary generation). Explicitly out of scope (removed)  

---

## 2. Integrated experience (required path)

```
[External app] select text → copy
        ↓ global hotkey
[.compass/inbox/*.md] land + focus
        ↓ Desk or editor
[Outbox factory] pick preset → AI proposal → user Apply
        ↓
[.compass/outbox/*.md] status: draft
        ↓ ship check + copy
[Clipboard] + status: ready (auto on successful copy)
        ↓ anytime
[Desk] mark inbox done / list outbox
```

**Demo script (product DoD):**

1. Copy text outside Compass  
2. Hotkey lands in inbox  
3. “Mail draft” creates an outbox file (with Apply)  
4. Ship check flags TBD; body can be copied  
5. Desk can mark inbox done and show outbox  

Target: **under ~3 minutes** for a practiced user.

---

## 3. Shared data contract

### 3.1 Directory layout

Under the existing workspace `.compass/`:

```text
.compass/
  inbox/
    done/
  outbox/
  templates/             # existing; may add outbox presets
  rules.md
  glossary.md            # optional
  desk/
    settings.json        # optional desk-local settings
```

Create missing dirs on workspace open or on first use of capture / clip / outbox.

### 3.2 Frontmatter

| kind | Location | Required fields |
|------|----------|-----------------|
| `inbox` | `.compass/inbox/` | `capturedAt` (ISO8601), `source` |
| `outbox` | `.compass/outbox/` | `preset`, `status`, `createdAt` |

Invalid/missing frontmatter must not crash; show as unknown in lists; open body as normal Markdown.

### 3.3 Index / search policy

| Path | Keyword / semantic search | Auto AI context |
|------|---------------------------|-----------------|
| `inbox/`, `outbox/` | **Include** | Normal (size caps) |
| `inbox/done/` | Include | OK |
| `ai-undo/`, index JSON, chat-history, etc. | Existing excludes | Exclude |

### 3.4 Settings

| Item | Store |
|------|--------|
| Global hotkey | App settings (not workspace-specific) |
| Ship-check LLM on/off | App settings (on failure, rules-only still works) |
| Desk list limits etc. | Optional `.compass/desk/settings.json` |

### 3.5 i18n

All UI strings via `src/i18n/messages.ts` (ja + en together).

---

## 4. Feature 1 — Capture hotkey

### 4.1 Summary

| | |
|--|--|
| ID | `desk.capture` |
| Goal | Land external text into inbox without paste hell |
| Priority | S |

### 4.2 Stories

- As a user, I want one hotkey from mail/browser into Compass inbox.  
- As a user, if no folder is open, I want a clear failure, not a silent drop.

### 4.3 Requirements

1. While Compass is running, register an OS global shortcut.  
2. Default: `Ctrl+Alt+I` (Windows). Configurable / disableable in settings.  
3. On fire:
   1. `clipboard.readText()`  
   2. Empty/whitespace → notify, stop  
   3. No workspace → notify “Open a folder first”, stop  
   4. Filename `YYYYMMDD-HHMMSS.md` (suffix `-2`, `-3`… on collision)  
   5. Path `{workspace}/.compass/inbox/{name}`  
   6. Body:

```markdown
---
kind: inbox
capturedAt: 2026-07-28T09:00:00+09:00
source: clipboard
---

{clipboard text}
```

   7. Focus window; open the file (or Open Clip — setting; default open file).  
4. Image/file hotkey capture **out of scope** (point users at existing paste).  
5. Unregister on quit.  
6. On register failure (conflict), show error in settings and ask for another key.

### 4.4 UI

- Settings → Clip: accelerator recorder, enable flag, after-capture action  
- Toast/OS notify on success/failure  
- Explorer shows `.compass/inbox` normally  

### 4.5 IPC / Main

| Channel | Role |
|---------|------|
| `desk:captureClipboard` | Save flow (shortcut + Renderer) |
| `desk:getCaptureSettings` / `desk:setCaptureSettings` | Hotkey, enabled, after-capture |
| Main `globalShortcut.register` | Rebind on settings change |

Renderer must not touch `clipboard` / `globalShortcut` directly.

### 4.6 Edge cases

| Case | Behavior |
|------|----------|
| Huge clipboard (> ~512 KiB default) | Reject or truncate + warn |
| Cannot create inbox dir | Error notify; no crash |
| Rapid repeat | Default: new file each time |

### 4.7 Acceptance

- [x] Notepad copy → hotkey → inbox md opens focused — *capture write + hotkey register unit-tested; focus path reviewed in `desk-hotkey.ts` (manual smoke recommended)*
- [x] No workspace fails safely — `captureClipboardToInbox(null)`
- [x] Empty clipboard creates no file — `captureClipboardToInbox` empty
- [x] Disabled hotkey does not fire — `runDeskCaptureFromHotkey` / `refreshDeskCaptureHotkey`

### 4.8 Non-goals

- Always-on helper when app is quit (Phase 2: tray)  
- Win32 direct selection APIs  
- Browser extension / Share target  

---

## 5. Feature 2 — Clip panel

### 5.1 Summary

| | |
|--|--|
| ID | `desk.workbench` |
| Goal | One screen for inbox / outbox |
| Priority | S |

### 5.2 Stories

- As a user, I want captures and outbound drafts in one place.  
- As a user, I want to retire inbox items without deleting them.

### 5.3 Requirements

1. Add a **Clip** tab/view in the left sidebar. Keep it list-like, not a dashboard.  
2. Exactly **two sections** initially:

| Section | Source | Row fields | Actions |
|---------|--------|------------|---------|
| Inbox | `.compass/inbox/*.md` (not `done/`) | name, `capturedAt`, 40-char snippet | Open / **Draft…** / Done / Delete |
| Outbox | `.compass/outbox/*.md` | name, `preset`, `status`, subject or first heading | Open / Ship check & copy |

3. Cap **20** rows each (newest first); link to open folder for the rest.  
4. **Done:** `fs.move` to `.compass/inbox/done/` (suffix on name clash).  
5. Empty states: one-line help each (capture hotkey, how to create a draft).  
6. No workspace → placeholder only.  
7. Refresh on focus if no watcher (Phase 1 OK).

### 5.4 UI constraints

- No card grids, stat strips, or kanban.  
- One composition: lists + short meta.  

### 5.5 IPC

| Channel | Role |
|---------|------|
| `desk:listInbox` | inbox rows |
| `desk:listOutbox` | outbox rows |
| `desk:markInboxDone` | move to done |
| `desk:deleteInbox` | permanently delete inbox file (not `done/`) |
| `desk:ensureDirs` | create convention dirs |

Parse frontmatter in Main (`desk-frontmatter.ts`).

### 5.6 Acceptance

- [x] Two sections; click opens file — `DeskPanel` Inbox/Outbox + `openWorkspaceFile` (static review)
- [x] Done removes from inbox and appears under `done/` — `markInboxDone` / `listDeskInbox`
- [x] Empty state suggests next action — `desk.inboxEmpty` / `desk.outboxEmpty` (static review)
- [x] Outbox row can start ship check (§7) — `DeskPanel` ship button → `runShipCheck` (static review)

### 5.7 Non-goals

- Custom section editor  
- Full task manager (assignee, due dates)  
- Auto “unanswered mail” detection  

---

## 6. Feature 3 — Outbox factory

### 6.1 Summary

| | |
|--|--|
| ID | `desk.outboxFactory` |
| Goal | Fixed exit shapes into outbox |
| Priority | S |

### 6.2 Stories

- As a user, I want a mail draft from an inbox note in a fixed shape.  
- As a user, I want preview approval, not silent disk writes.

### 6.3 Presets (exactly four)

| preset | Label (en) | Example filename | Body shape |
|--------|------------|------------------|------------|
| `mail` | Mail | `mail-YYYYMMDD-HHMMSS.md` (suffix `-2`, `-3`… on collision) | `to` / `subject` + body |
| `minutes` | Minutes | `minutes-YYYYMMDD-HHMMSS.md` (same) | Decisions / TODOs / Share |
| `report` | Report | `report-YYYYMMDD-HHMMSS.md` (same) | Background / Status / Proposal |
| `chat` | Chat post | `chat-YYYYMMDD-HHMMSS.md` (same) | Short / bullets OK |

No preset CRUD UI in Phase 1. Template body overrides via existing `.compass/templates/` allowed; IDs stay fixed.

### 6.4 Outbox format

```markdown
---
kind: outbox
preset: mail
status: draft          # draft | ready | archived
to: ""
subject: ""
sourcePath: ".compass/inbox/20260728-090000.md"
createdAt: 2026-07-28T09:05:00+09:00
updatedAt: 2026-07-28T09:05:00+09:00
---

Body…
```

| status | Meaning |
|--------|---------|
| `draft` | Fresh / editing |
| `ready` | Copied via ship check (shipped / ready to send) |
| `archived` | Hidden from default Desk list; file kept |

### 6.5 Launch UI

1. Command / chat header / Desk: **Create draft…**  
2. Pick one of four presets  
3. Context: active editor file first; else chat instruction only  
4. Suggest `document` use-case; do not force  
5. **Canonical path:** Edit-equivalent single proposal or Agent `proposeActions` with one `writeFile` → existing preview → Apply  

Prompt must include: schema, outbox path, source body (truncated), rules/glossary.

### 6.6 Templates

Add built-in or workspace templates:

- `outbox-mail.md`
- `outbox-minutes.md`
- `outbox-report.md`
- `outbox-chat.md`

### 6.7 Acceptance

- [x] All four presets produce one outbox file after Apply — Edit request + unique path unit-tested (Apply rides existing AI Edit)
- [x] Frontmatter has `kind` / `preset` / `status` / `createdAt` — shape prompts + `serializeOutboxDocument`
- [x] No silent Apply — `buildOutboxDraftRequest` uses `mode: 'edit'`
- [x] Visible on Desk Outbox after refresh — Apply-triggered `refresh` (static) + `listDeskOutbox`

### 6.8 Non-goals

- mailto / Outlook draft creation  
- docx/HTML export  
- User-defined preset count UI  
- Thread sync with sent mail  

---

## 7. Feature 4 — Ship check

### 7.1 Summary

| | |
|--|--|
| ID | `desk.shipCheck` |
| Goal | Pre-copy quality / leak gate |
| Priority | S |

### 7.2 Stories

- As a user, I want TBD and API keys flagged before copy.  
- As a user, I want to copy anyway under my responsibility.

### 7.3 Launch

- Active outbox file, or Desk row **Ship check & copy**  
- Arbitrary Markdown via command = Phase 2; Phase 1 prioritizes outbox  

### 7.4 Pipeline

```
input (+ frontmatter)
  → Stage A: local rules (required, sync)
  → Stage B: LLM review (optional, setting)
  → results panel
  → copy / cancel / copy anyway
```

#### Stage A (required)

| Rule ID | Check | Severity |
|---------|-------|----------|
| `tbd_markers` | `TODO` / `TBD` / `要確認` / `FIXME` / `xxx` | warning |
| `secret_pattern` | api key / Bearer / `sk-`-like / long tokens | error |
| `glossary_mismatch` | light glossary violations when file exists | warning |
| `empty_body` | empty body | error |
| `mail_missing_subject` | mail preset + empty subject | warning |

No LLM; target &lt; 1s.

#### Stage B (optional)

- Short Ask-like request; no tools  
- Bulleted issues only; no full rewrite  
- On timeout/error, continue with Stage A; show B failed in one line  

### 7.5 Results UI

- Panel: **Pre-ship check**  
- Actions: **Copy body** (when no error/warning) / **Copy anyway** (confirm when error or warning remains) / **Close**  

### 7.6 Copy payload

| preset | Clipboard |
|--------|-----------|
| `mail` | Optional `To:`, `Subject:`, blank line, body (no frontmatter) |
| other | Markdown body without frontmatter |

After successful copy: set `status` to **`ready` automatically** (do not change `archived`). Ship check focuses on content (TBD, secrets, etc.); status is the “shipped” label.

### 7.7 IPC

| Channel | Role |
|---------|------|
| `desk:runShipCheck` | findings + stageBStatus |
| `desk:copyOutboxPayload` | format + clipboard write |

```ts
type ShipFinding = {
  id: string
  severity: 'error' | 'warning' | 'info'
  message: string
  source: 'rule' | 'llm'
  excerpt?: string
}
```

### 7.8 Acceptance

- [x] TBD always yields `tbd_markers` — `runShipCheckStageA`
- [x] Fake API key yields `secret_pattern` — `runShipCheckStageA`
- [x] Copied text has no YAML frontmatter — `formatOutboxCopyPayload`
- [x] Stage B off/fail still allows copy via Stage A — Stage B not implemented; Stage A alone suffices
- [x] No auto rewrite Apply — Stage A returns findings only; body unchanged

### 7.9 Non-goals

- One-click fix Apply (Phase 2)  
- Enterprise DLP completeness claims  
- Send / share-link issuance  

---

## 8. Shared types (draft)

```ts
type DeskWorkspaceSettings = {
  openAfterCapture?: 'file' | 'desk'
  outboxListIncludeArchived?: boolean
}

type DeskCaptureAppSettings = {
  enabled: boolean
  accelerator: string
  openAfterCapture: 'file' | 'desk'
}

type InboxDocMeta = {
  kind: 'inbox'
  capturedAt: string
  source: 'clipboard' | 'import' | 'unknown'
}

type OutboxDocMeta = {
  kind: 'outbox'
  preset: 'mail' | 'minutes' | 'report' | 'chat'
  status: 'draft' | 'ready' | 'archived'
  to?: string
  subject?: string
  sourcePath?: string
  createdAt: string
  updatedAt?: string
}

type ShipFinding = {
  id: string
  severity: 'error' | 'warning' | 'info'
  message: string
  source: 'rule' | 'llm'
  excerpt?: string
}
```

Place formally under `src/types` at implementation time.

---

## 9. Architecture placement

```
electron/services/
  desk-dirs.ts
  desk-frontmatter.ts
  desk-capture.ts
  desk-ship-check.ts
electron/main.ts          # globalShortcut + IPC
electron/preload.ts       # window.compass.desk.*

src/components/
  DeskWorkbench.tsx
  ShipCheckPanel.tsx
src/utils/
  outbox-copy.ts
  desk-presets.ts
```

FS / shortcut / clipboard writes: **Main only**. AI writes ride existing preview / apply / undo — no silent desk write IPC.

---

## 10. Security / privacy

1. Captured text stays local unless the user puts it in AI chat.  
2. Stage B sends body to LLM only on explicit ship check.  
3. `secret_pattern` is best-effort; help must not claim zero misses.  
4. Notifications must not include full body text.  

---

## 11. Phasing

### Phase 1 (two-week minimum)

Required: Capture / Desk lists / four outbox presets / Ship check Stage A + copy.  
Cuttable: Stage B, hotkey recorder UI (fixed default OK), tray, generic md ship check.

### Phase 2

- Findings → fix proposal (preview)  
- Tray + offline capture queue  
- outbox → `.eml` or better mailto  
- Inbox bulk “draftize” wizard  

### Phase 3 (beyond this spec)

- MCP external APIs  
- Outlook draft (no send)  
- PDF/docx as exit presets  

---

## 12. Docs to update at implementation

| Artifact | Content |
|----------|---------|
| `helps/en/getting-started/desk-loop.md` | User path |
| `helps/ja/...` | Japanese |
| [SPEC.md](./SPEC.md) | One-line feature list entry |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | `.compass/inbox|outbox` + `desk:*` IPC |

---

## 13. Testing

| Area | Tests |
|------|-------|
| Frontmatter parse | unit |
| Stage A rules | unit |
| Outbox copy formatting | unit |
| Capture name collision | unit |
| Desk listing | component or service |

E2E gate for Phase 1 = manual demo script checklist.

---

## 14. Traceability

| Feature | Section | Phase 1 required |
|---------|---------|------------------|
| 1 Capture | §4 | Yes |
| 2 Desk | §5 | Yes |
| 3 Outbox factory | §6 | Yes |
| 4 Ship check | §7 | Stage A + copy |

---

## 15. Open questions

| # | Question | Recommended default |
|---|----------|---------------------|
| Q1 | Default accelerator | `Ctrl+Alt+I` |
| Q2 | Auto `status: ready` after copy? | **Yes** (draft→ready; keep archived) |
| Q3 | Desk as left tab vs command-only | Left tab |
| Q4 | Draft gen via Edit vs Agent | Edit-equivalent single proposal (works without tools) |

---

## Revision history

| Date | Notes |
|------|-------|
| 2026-07-28 | Digested acceptance checklists (unit + static). Unified `markInboxDone` path checks with `deleteInbox`. Added capture/hotkey/list tests |
| 2026-07-28 | Removed weekly digest from scope; restructured as S-tier four features |
| 2026-07-28 | Initial combined S-tier five-feature spec |
