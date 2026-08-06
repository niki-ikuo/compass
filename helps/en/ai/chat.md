---
title: AI chat
keywords:
  - AI
  - Chat
  - Ask
  - Edit
  - Streaming
  - Use-case preset
  - Diff
  - Apply
category: ai
related:
  - agent.md
  - ../getting-started/ai-provider.md
  - ../getting-started/open-project.md
  - ../troubleshooting/common-errors.md
commands:
  - Open Settings
  - Open Chat Settings
  - Open Provider
  - Focus Chat
---

# AI chat

Use the right-hand chat to ask AI about the current file or selection.

## What can you do?

| Mode | What it does | File changes |
|------|--------------|--------------|
| **Ask** | Explain, answer, organize | None |
| **Edit** | Propose changes | Preview → you apply |
| **Agent** | Read / propose / (limited) run tools | Same (see [Agent](agent.md)) |

Separately from Ask / Edit / Agent, use-case presets (General / Document / Data / Code) control tone and approach.

Workspace-wide tone and terms live in `.compass/rules.md` (optional `.compass/glossary.md`). Open via **File → Edit Workspace Rules** or the rules button in the chat header. They are auto-attached to Ask / Edit / Agent within the context budget.

| Preset | Typical Agent extras |
|--------|----------------------|
| **Document** | Read Markdown by heading; light checks for headings / relative links |
| **Data** | Column profiles and read-only queries on CSV / TSV / JSON; save answers next to sources as `.result.md` / `.result.csv` |
| **Code** / **General** | Standard tools (read / search / propose / exec / verify) |

## How to open

1. [Configure AI](../getting-started/ai-provider.md)
2. (Recommended) [Open a folder](../getting-started/open-project.md)
3. Type in the right-hand chat and send

## How to use

- **Enter** … send
- **Shift+Enter** … new line
- The open file (and selection, if any) are included as context
- Drop **files** onto chat to attach them as read-only references (**folders are not allowed**):
  - From the **left Explorer** (workspace files)
  - From the **OS file manager** (e.g. Windows Explorer) — external files outside the folder, when a workspace is open
- You can also drag **editor tabs** into chat as references
- Replies stream in
- History is saved to `.compass/chat-history.json` in the workspace
- For CSV / JSON: select one or more files in Explorer → **Ask about data** or **Save result as Markdown/CSV** (Agent + Data; preview → apply). Saved `.result.md` notes keep the query in frontmatter — right-click the note (or its editor tab) → **Re-run query**

### Applying Edit proposals

1. AI proposes a change
2. Review the diff (additions green, deletions red)
3. **Apply** or reject
4. After apply, use **Undo this apply** on the message, the success bar, Edit → Undo AI Apply / `Ctrl+Shift+Z`, or **AI Apply History**. The history timeline shows when / which chat message / which files, and lets you undo any apply in one click (newer applies are undone together when needed). You can optionally save a change summary as Markdown under `.compass/apply-summaries/`. You can also undo applies from the current chat (newest-first).

Nothing is written automatically. If you edit those files after apply, undo is blocked. Newer applies must be undone before older ones.

### Tabs

Right-click a chat tab for **Close** / **Close Others** / **Close All**. Closing the last chat tab hides the chat panel.

## FAQ

**Q. No reply / errors**  
A. Check [Common errors](../troubleshooting/common-errors.md). Start with API key and model.

**Q. Agent vs Edit?**  
A. Edit proposes in one response. Agent loops with reads/commands across steps → [Agent](agent.md)

## Related

- [Agent](agent.md)
- [AI provider setup](../getting-started/ai-provider.md)
- [Open a project](../getting-started/open-project.md)
- [FAQ](../troubleshooting/faq.md)
