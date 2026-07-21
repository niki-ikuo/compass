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
  - search.md
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

- Open, edit, and save text files
- Create files from the tree (including templates)
- Rename with **F2** (stem selected by default)
- Open Word / Excel / PowerPoint / OpenDocument files with the **OS default app** (not the editor). Explorer also has **Open with Default App**
- Reveal items in the OS file manager from Explorer
- Send the current file / selection to AI for Q&A or edits
- Use Agent across multiple files in the workspace (folder required)

## The `.compass` folder

A `.compass/` directory may appear at the workspace root.

| Example contents | Purpose |
|------------------|---------|
| Structure index | File list and similar for AI context |
| `chat-history.json` | Persisted chat history |
| `settings.json` | Workspace settings (e.g. default use-case preset) |
| `templates/` | Document templates (optional) |

You usually don’t need to edit these by hand.

## FAQ

**Q. Agent says “Open a folder”**  
A. Agent requires a workspace. Open a folder first → [Agent](../ai/agent.md)

**Q. Why don’t I see `node_modules` or `.git`?**  
A. They are hidden in the tree by design.

**Q. Double-clicking a `.docx` opens Word instead of the editor**  
A. Intended. Office / OpenDocument files open with the OS default app.

## Related

- [Welcome](welcome.md)
- [Search in the workspace](search.md)
- [AI provider setup](ai-provider.md)
- [AI chat](../ai/chat.md)
- [Agent](../ai/agent.md)
