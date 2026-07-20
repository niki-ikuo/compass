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

- Read and inspect files in the workspace
- Propose batches of changes (you apply them)
- Run limited commands (some require approval first)
- Multi-turn work with plan / memory

## Requirements

1. A [folder is open](../getting-started/open-project.md) (required)
2. A tools-capable provider / model
3. Chat mode set to **Agent**

### When Agent is unavailable

| Situation | Result |
|-----------|--------|
| Ollama | Agent hidden (Ask / Edit only) |
| Model without tools | Error — switch to Edit or change provider |
| No folder open | “Open a folder” |

## How to use

1. Select **Agent** in chat
2. Describe the goal clearly (e.g. “Update this folder’s README to match the current project”)
3. Watch the step timeline (thinking / tools / waiting for approval)
4. Approve or reject change proposals and command runs
5. Continue if prompted, or cancel

## Keep in mind

- Writes are never auto-applied (same preview as Edit)
- Paths stay inside the open workspace
- Agent `exec` is a short-lived child process — not the integrated terminal
- Turn / tool limits may ask you to continue

## FAQ

**Q. Can I use Agent with Ollama?**  
A. Not currently. Use Edit, or switch to a tools-capable provider such as OpenAI / Gemini → [AI setup](../getting-started/ai-provider.md)

**Q. It stopped mid-run**  
A. It may be waiting for approval or a continue confirmation. You can also cancel.

## Related

- [AI chat](chat.md)
- [AI provider setup](../getting-started/ai-provider.md)
- [Common errors](../troubleshooting/common-errors.md)
- [MCP](../integrations/mcp.md) (not available)
