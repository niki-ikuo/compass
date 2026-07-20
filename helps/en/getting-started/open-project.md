---
title: Open a project
keywords:
  - Folder
  - Workspace
  - Project
  - Open
  - File tree
  - .compass
category: getting-started
related:
  - welcome.md
  - ai-provider.md
  - ../ai/chat.md
  - ../ai/agent.md
commands:
  - Open Folder
---

# Open a project

In Compass, a “project” is the local folder you open (the workspace).

## How to open

1. Menu **File** → **Open Folder**
2. Choose the folder you want
3. The file tree appears on the left

## What you can do

- Open, edit, and save files
- Create files from the tree (including templates)
- Send the current file / selection to AI for Q&A or edits
- Use Agent across multiple files in the workspace (folder required)

## The `.compass` folder

A `.compass/` directory may appear at the workspace root.

| Example contents | Purpose |
|------------------|---------|
| Structure index | File list and similar for AI context |
| `chat-history.json` | Persisted chat history |
| `templates/` | Document templates (optional) |

You usually don’t need to edit these by hand.

## FAQ

**Q. Agent says “Open a folder”**  
A. Agent requires a workspace. Open a folder first → [Agent](../ai/agent.md)

**Q. Why don’t I see `node_modules` or `.git`?**  
A. They are hidden in the tree by design.

## Related

- [Welcome](welcome.md)
- [AI provider setup](ai-provider.md)
- [AI chat](../ai/chat.md)
- [Agent](../ai/agent.md)
