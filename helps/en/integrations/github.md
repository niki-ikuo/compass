---
title: Git / GitHub
keywords:
  - GitHub
  - Git
  - commit
  - diff
  - status
  - Issue
  - PR
  - Repository
category: integrations
related:
  - ../getting-started/open-project.md
  - ../ai/chat.md
  - mcp.md
---

# Git / GitHub

## Git in Compass (status / diff / commit)

Open the **Git** tab in the left sidebar (`Ctrl+Shift+G`), or click the branch name in the status bar.

You can:

- See changed / staged / untracked files
- Open a file’s diff
- Stage or unstage files
- Commit with a message

Requires **Git on PATH** (for example Git for Windows) and a folder that is already a Git repository (`git init` or a clone).

This is separate from [AI Apply Undo](../ai/chat.md): Undo restores Compass backups under `.compass/ai-undo/` and does not create Git commits.

## Not included yet

- Push / pull / fetch
- Branch create / switch UI
- GitHub auth, Issues, or Pull Requests
- MCP

Use the integrated terminal or an external Git client for those.

## Related

- [Open a project](../getting-started/open-project.md)
- [AI chat](../ai/chat.md)
- [MCP](mcp.md)
- [FAQ](../troubleshooting/faq.md)
