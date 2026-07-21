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

### Applying Edit proposals

1. AI proposes a change
2. Review the diff (additions green, deletions red)
3. **Apply** or reject

Nothing is written automatically.

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
