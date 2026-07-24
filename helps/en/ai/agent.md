---
title: Agent
keywords:
  - Agent
  - Tools
  - proposeActions
  - exec
  - Approval
  - tools
  - Ollama
  - Data
  - profileData
  - queryData
  - Document
category: ai
related:
  - chat.md
  - ../getting-started/ai-provider.md
  - ../getting-started/open-project.md
  - ../troubleshooting/common-errors.md
commands:
  - Open Settings
  - Open Folder
  - Focus Chat
---

# Agent

Agent is not “a longer Edit.” The model calls tools, observes results, and thinks again. Writes always go through preview approval.

## What can you do?

- Read and inspect files in the workspace (Markdown can be read by heading)
- Propose batches of changes (you apply them)
- Run limited commands (some require approval first)
- Multi-turn work with plan / memory
- With the **Document** use case: structure checks after edits (headings, relative links)
- With the **Data** use case: profile CSV / TSV / JSON and run read-only SQL-style queries on imported tables

## Requirements

1. A [folder is open](../getting-started/open-project.md) (required)
2. A tools-capable provider / model
3. Chat mode set to **Agent**

### When Agent is unavailable

| Situation | Result |
|-----------|--------|
| Ollama | Agent hidden (Ask / Edit only) |
| Model / provider without tools | Agent hidden, or guided prompt to resend in **Edit** |
| No folder open | “Open a folder” |

## How to use

1. Select **Agent** in chat
2. Pick a use-case preset if needed (**Document** for docs, **Data** for tables)
3. Describe the goal clearly (e.g. “Update this folder’s README to match the current project”)
4. Watch the step timeline (thinking / tools / waiting for approval)
5. Approve or reject change proposals and command runs
6. Continue if prompted, or cancel

## Keep in mind

- Writes are never auto-applied (same preview as Edit)
- After apply, you can undo the last apply (same as Edit), including from the chat message, apply history, or “this chat”
- Paths stay inside the open workspace
- Agent `exec` is a short-lived child process — not the integrated terminal
- Turn / tool limits may ask you to continue
- `profileData` / `queryData` appear only when the use case is **Data** (queries are read-only)
- CSV-like files load into an in-run temporary SQLite sandbox (not a persistent DB). For tables, Agent should prefer `profileData` then `queryData` (avoid whole-table `readFile`). A tool-step summary of `imported …` (fresh load) or `cached …` (reuse in the same run) means the table is in the sandbox

## FAQ

**Q. Can I use Agent with Ollama?**  
A. Not currently. Use Edit, or switch to a tools-capable provider such as OpenAI / Gemini → [AI setup](../getting-started/ai-provider.md)

**Q. It stopped mid-run**  
A. It may be waiting for approval or a continue confirmation. You can also cancel.

**Q. How do I analyze a CSV with Agent?**  
A. Set the use case to **Data**, then ask (e.g. “profile sales.csv and summarize null rates”). Tabular files should go through temporary SQLite (`profileData` / `queryData`); Agent can profile columns and run read-only queries without writing files until you approve a change. Check the step summary for `imported` / `cached` / `import failed` to see whether the load succeeded.

## Related

- [AI chat](chat.md)
- [AI provider setup](../getting-started/ai-provider.md)
- [Common errors](../troubleshooting/common-errors.md)
- [MCP](../integrations/mcp.md) (not available)
