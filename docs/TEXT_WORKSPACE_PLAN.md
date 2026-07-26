# Text workspace — development plan

**English** | [日本語](ja/TEXT_WORKSPACE_PLAN.md)

Build order after v2.0. Target: **all local text**. Not a Cursor competitor.

Related: [SPEC.md](./SPEC.md), [USE_CASE_PRESET.md](./USE_CASE_PRESET.md), [AI_APPLY_UNDO.md](./AI_APPLY_UNDO.md), [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Rule

1. Build in this order. Do not start N+1 until N ships a usable slice.
2. Do not build: LSP, debugger, Composer parity, extension marketplace, in-app Office editing, cloud sync.
3. Code preset stays supported. It does not set priority.

---

## Now → next (checklist)

### 1. Workspace text search (v2.1)

Ship semantic / hybrid search over folder text.

- [x] Index Markdown headings + short section summaries into `.compass/`
- [x] Chunk workspace text (honor ignore rules)
- [x] Local embeddings or hybrid keyword + embedding search
- [x] Left Search: query → path + heading + snippet → open at heading
- [x] Agent tool: `searchMeaning` (or extend `search`) returns citations
- [x] Ask/Agent can answer “where is X?” without manual `@` on every file

**Done:** mixed `notes/` + `docs/` folder finds the right section without opening every file.

**Touch:** `electron/services/project-indexer.ts`, workspace search IPC, `LeftSidebar` Search tab, Agent tools in `electron/services/agent-*.ts`.

---

### 2. Document edit

Make `document` the strongest use case.

- [x] Workspace outline: all Markdown headings across files, jump to file+heading
- [x] Section-scoped edit: propose/apply only one heading subtree
- [x] Diff UI for prose (collapse noise; show heading context)
- [x] Stronger document verify: duplicate headings, broken `.md` links, basic term checks

**Done:** rewrite a procedure doc by section; apply without wrecking the rest of the file.

**Touch:** LeftSidebar Outline, `index:getOutline`, `replaceSection` action, `DocumentDiffContent`, `.compass/glossary.md` term verify.

**Depends on:** (1) for cross-file outline data if shared.

---

### 3. PDF / Office / image → text

Do not edit binaries in-app. Make them usable as text.

- [x] Extract PDF text into the index from step 1
- [x] Extract Office text where reliable (`.docx` + `.xlsx`; skip hard formats)
- [x] @-mention / search hits on extracted text
- [x] Action: “Summarize to Markdown” → preview → apply (sidecar or new file)
- [x] Keep “Open with default app” for real editing

**Done:** PDF + Markdown (+ spreadsheet text) folder can be asked and summarized with no copy-paste.

**Touch:** `extractable-document.ts` / `docx-text.ts` / `xlsx-text.ts`, `project-indexer`, chat context / Agent `readFile` / keyword search, Explorer + PDF viewer “Summarize to Markdown”.

**Depends on:** (1).

---

### 4. Apply history people can use

Build on shipped Change Sets ([AI_APPLY_UNDO.md](./AI_APPLY_UNDO.md)).

- [x] Timeline: when / which chat message / which files
- [x] One-click undo from that timeline (not only “last”)
- [x] Optional “Save change summary as `.md`”

**Done:** wrong Apply on a non-git notes folder is fixed in under a minute, no terminal.

**Main touchpoints:** `AiApplyHistoryPanel`, cascade undo in `ai-undo`, `messageId` linking, `.compass/apply-summaries/`.

---

### 5. Workspace rules

- [x] Human-editable `.compass/rules.md` (and optional glossary)
- [x] Auto-attach to Ask / Edit / Agent (context budget aware)
- [x] Simple UI to open/edit rules

**Done:** second session follows tone/terms without pasting a long prompt.

**Touch:** `workspace-rules` (Main + Renderer), `buildUserMessagePayload`, File menu / chat header, optional `.compass/glossary.md` attach.

---

### 6. Data results stay in the folder

- [x] Ask across multiple CSV/JSON files
- [x] “Save result as Markdown/CSV” via preview → apply
- [x] Re-run last saved query from that note

**Done:** data answers become files next to the sources.

**Touch:** `data-result` (sidecar / frontmatter), Explorer Ask about data / Save result, re-run from `.result.md`, `ai.preset.data` role, Agent `queryData.paths`.

**Depends on:** (1) helpful but not required for a thin first cut.

---

## Later (after 1–4)

| Item | When |
|------|------|
| MCP / plugins | After 1–4 shipped |
| Minimal Git diff/commit UI | Only if 4 is not enough |
| Native Anthropic API | If OpenAI-compat blocks real users |
| macOS / Linux | After Windows text loop is solid |
| `.pptx` / legacy `.doc` extraction | Only if users hit the gap after PDF/docx/xlsx |
| Stronger local neural embeddings (offline model) | If API embeddings + hash still underdeliver |

---

## One-line sequence

```
1 search → 2 document edit → 3 PDF/Office bridge → 4 apply timeline → 5 rules → 6 data save
```

Ship **1**, then either **2 or 3**, then **4**. That is the minimum useful program.
