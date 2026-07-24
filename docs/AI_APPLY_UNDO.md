# AI Apply Undo — design proposal

**English** | [日本語](ja/AI_APPLY_UNDO.md)

Status: **Phase 1 implemented** (Change Set on Apply, Undo Last, delete backups, stale checks, minimal UI). Related: [AGENT.md](./AGENT.md) (preview / apply gate), [ARCHITECTURE.md](./ARCHITECTURE.md), [SPEC.md](./SPEC.md).

This document records a blunt assessment of the gap after AI workspace Apply, the feature to build, and **how far to go right now**. Phase 2+ remains backlog.

---

## 0. Verdict (read this first)

| Question | Answer |
|----------|--------|
| Is undo after Apply needed? | **Yes. Not “nice to have” — a real safety hole.** |
| Does preview / reject already solve it? | **No.** That only helps *before* disk write. |
| What should we ship first? | **Phase 1 only** (see §8): Change Set on Apply + Undo Last + delete backup + stale checks + minimal UI. |
| What should we *not* build yet? | Chat-wide rollback UI, history panel, git auto-stash, Template / `exec` undo, infinite timeline. |
| Multi chat tabs? | **Supported by design** if Change Sets are workspace-scoped and store `chatId` (see §5). |

Approval before write is damage *prevention*. Users still mis-read diffs and hit Apply. Without post-apply recovery — especially for deletes and non-git folders — the product is incomplete for an AI workspace.

---

## 1. Problem (current behavior)

Today’s flow (Edit and Agent share it):

```
propose → previewActions (holds oldContent for writes) → user Apply / Reject
                                                      → applyActions writes disk
                                                      → previewOriginal discarded
```

| Capability | Status |
|------------|--------|
| Reject / partial reject **before** Apply | Exists |
| Per-file Apply while preview remains | Exists |
| Undo **after** Apply | **Missing** |
| Restore deleted files/dirs after Apply | **Missing** |
| Persist pre-apply bytes for recovery | **Missing** (thrown away on success) |
| Attribute applied changes to a chat tab | **Missing** |

Relevant code today:

- Preview / apply: `electron/services/filesystem.ts` (`previewWorkspaceActions`, `applyWorkspaceActions`)
- Store apply path: `src/stores/app-store.ts` (`applyWorkspacePreview`, `applyPreviewFile`, `revertWorkspacePreview`)
- Types: `ActionPreviewItem` / `WorkspaceAction` in `src/types/index.ts`
- Agent write gate: `proposeActions` → `ai:needApproval` → same preview UI

Note: Agent’s `checkpoint` tool is **plan resume metadata**, not a filesystem snapshot. Do not overload that name in UI copy.

---

## 2. Goals and non-goals

### Goals

1. After a successful AI Apply, the user can restore the previous workspace state for that apply.
2. Works **without git**.
3. Covers `writeFile` / `mkdir` / `deleteFile` / `deleteDir` (same action set as preview).
4. Safe under multiple chat tabs (no silent cross-tab corruption).
5. Does not invent a second write path — sits on top of existing `applyActions`.

### Non-goals (explicitly out of Phase 1+)

- Undoing manual edits, Template Manager writes, or Agent `exec` side effects
- Auto git commit / stash on every Apply
- Time-travel UI across the whole project history
- Letting the model call “undo” as a tool
- Making Monaco `Ctrl+Z` mean “undo AI apply” (conflicts with editor undo)

---

## 3. Core model: Change Set

One **Change Set** = one successful Apply unit (Apply All **or** single-file Apply).

```ts
type WorkspaceChangeSet = {
  id: string
  chatId: string
  createdAt: number
  source: 'preview-all' | 'preview-file'
  workspaceRoot: string
  entries: WorkspaceChangeEntry[]
  status: 'applied' | 'undone' | 'stale'
}

type WorkspaceChangeEntry =
  | {
      type: 'writeFile'
      relativePath: string
      before: string | null // null = file did not exist (create)
      after: string
      wasNew: boolean
    }
  | {
      type: 'mkdir'
      relativePath: string
      alreadyExisted: boolean // if true, undo is a no-op for this entry
    }
  | {
      type: 'deleteFile'
      relativePath: string
      before: string
      backupRef?: string
    }
  | {
      type: 'deleteDir'
      relativePath: string
      backupRef: string // mandatory — tree moved/copied under .compass
    }
```

### Stack policy (Phase 1)

- Change Sets live in a **per-workspace LIFO stack**.
- **Undo Last** always targets the newest `applied` set.
- Do not skip sets. If the user wants an older set, they undo newer ones first (or accept stale failure).

Rationale: disk is one timeline. Chat-scoped “pick any apply” without LIFO invites silent overwrites.

---

## 4. Rollback rules

Undo applies entries in **reverse apply order**.

| Applied | Undo |
|---------|------|
| `writeFile` overwrite | Write `before` back |
| `writeFile` create (`wasNew`) | Delete file **only if** current content still equals `after` |
| `mkdir` new | Remove dir **only if empty**; else fail that entry / mark stale |
| `mkdir` already existed | No-op |
| `deleteFile` | Restore from `before` or `backupRef` |
| `deleteDir` | Restore tree from `backupRef` |

### Stale checks (required)

Before mutating disk on undo:

1. For each `writeFile`, current file content must equal `after` (missing/changed → stale).
2. Paths touched by a **newer** Change Set → older set cannot be undone out of order.
3. Prefer **all-or-nothing** undo for a single Change Set. If that is too hard in v1, report a clear partial result list — silent half-undos are unacceptable.

---

## 5. Multiple AI chat tabs

Chats are many; the filesystem is one.

| Concern | Design |
|---------|--------|
| Ownership | Every Change Set stores `chatId` for UI attribution and optional filters. |
| Undo Last | Workspace-global (most recent Apply from **any** tab). |
| “Undo this chat’s applies” | Phase 2+: walk that chat’s sets newest-first; stop on conflict with another chat’s newer set. |
| Concurrent previews | Today preview is effectively tied to active chat / pending approval. Undo does **not** fix simultaneous pending previews — that remains a separate limitation. |
| Example | Tab A applies `a.ts`, Tab B applies `b.ts` → Undo Last reverts B only. Same file A then B → Undo Last reverts B (restores A’s bytes); undoing A’s set directly while B is newer → reject as conflict. |

**Do not** keep separate undo stacks per chat for disk. That lies about reality.

---

## 6. Storage

Use workspace-local data (already ignored by indexer via `.compass`):

```
.compass/ai-undo/
  index.json           # metadata + ordered change set ids (cap N)
  backups/<changeSetId>/...
```

| Policy | Phase 1 recommendation |
|--------|------------------------|
| Retention | Last **10–20** change sets |
| Why on disk | App restart must still restore deletes |
| `deleteDir` | Backup (copy/rename into `backups/`) **before** delete; if backup fails, **fail Apply** (do not delete without undo material) |
| Size limits | Define a max backup bytes for `deleteDir`; over limit → block Apply with a clear error, or require explicit “apply without undo” (prefer block in Phase 1) |

In-memory-only undo is insufficient.

---

## 7. API and call sites (conceptual)

Main (privileged):

- Extend apply path: backup → apply → return / persist `WorkspaceChangeSet`
- `undoLastChangeSet(workspaceRoot)` / `undoChangeSet(workspaceRoot, id)`
- Optional: `listChangeSets(workspaceRoot)`

Renderer store:

- On successful `applyWorkspacePreview` / `applyPreviewFile`, push Change Set
- Expose `undoLastAiApply()`
- Keep `revertWorkspacePreview` as **pre-apply only** (name must not be confused with post-apply undo)

UI:

- Post-apply bar: “Applied N changes” + **Undo this apply**
- Command / menu: **Undo Last AI Apply** (not `Ctrl+Z`)
- Copy: “Undo apply” / 「適用を取り消す」— never “checkpoint”

Agent:

- Undo is a **user** action. Do not expose as a model tool.
- After undo, append a short chat note so later turns know disk changed (“User undid the last apply (N actions)”). Nice-to-have in Phase 1; required if Agent often continues after Apply.

---

## 8. Phased delivery

### Phase 1 — **Ship this now** (recommended scope)

- Persist Change Set on Apply All and per-file Apply
- Backup for deletes (file + dir)
- Undo Last (LIFO) with stale checks
- Minimal UI: apply success affordance + command/menu
- Multi-tab safe via workspace stack + `chatId` field (even if chat-filtered undo UI waits)

### Phase 2 — later

- Undo control on the chat message that recorded the apply
- Simple list of recent change sets
- Stronger Agent notification after undo
- Optional “undo applies from this chat” (newest-first, stop on conflict)

### Phase 3 — optional / maybe never

- Full project timeline UI
- git auto-stash integration
- Same machinery for Template Manager
- Retention / size settings in Preferences

---

## 9. Judgment: how far to go *right now*

**Stop at Phase 1.** Do not start Phase 2/3 in the same change.

Reasons:

1. **Highest risk today is irreversible Apply** (especially delete). Phase 1 closes that.
2. Preview already handles pre-apply mistakes; building a fancy history panel before basic undo is backwards.
3. Multi-tab is already covered by a workspace LIFO stack — no need for a second product surface yet.
4. Scope creep (git, templates, exec, chat-wide magic) will delay the one button users need: **Undo this apply**.

Implementation order inside Phase 1:

1. Types + `.compass/ai-undo` backup/index in Main
2. Hook into `applyActions` / store apply success paths
3. `undoLastChangeSet` + stale checks + tests (`filesystem` tests first)
4. Thin UI (bar + command) + help one-liner
5. Only then consider Agent chat note

Out of scope for the first PR even within “undo”:

- Redesigning preview
- Renaming Agent `checkpoint`
- Parallel pending previews across tabs

---

## 10. Test plan (Phase 1)

- Apply overwrite → undo restores `before`
- Apply new file → undo deletes file
- Apply deleteFile → undo restores content
- Apply deleteDir → undo restores tree; Apply fails if backup cannot be written
- Apply mkdir (new, empty) → undo removes dir; mkdir then add file → undo mkdir fails cleanly
- Two Applies (different files) → two undos in reverse order
- Two Applies (same file, two chats) → undo last only; older set undo rejected while newer exists
- After Apply, user edits file → undo reports stale, disk unchanged
- Restart app → delete undo still works from `.compass/ai-undo`

---

## 11. Doc / product follow-ups (when implementing)

- Help: `helps/*/ai/chat.md`, `helps/*/ai/agent.md` — state that Apply can be undone
- Optionally one line in [AGENT.md](./AGENT.md) § write gate pointing here
- Keep English as source of truth; update `docs/ja/AI_APPLY_UNDO.md` in the same change when this proposal evolves

---

## 12. Summary

Compass already does the right thing **before** write. It does the wrong thing **after** write: it throws away the only bytes needed to recover. Fix that with workspace Change Sets, disk backups for deletes, LIFO Undo Last, and stale checks. **Build Phase 1 only for now**; treat the rest as backlog, not part of the first delivery.
