---
title: Git / GitHub
keywords:
  - GitHub
  - Git
  - commit
  - diff
  - status
  - push
  - pull
  - branch
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

## Git in Compass

Open the **Git** tab in the left sidebar (`Ctrl+Shift+G`), or click the branch name in the status bar.

You can:

- See changed / staged / untracked files
- Open a file’s diff
- Stage or unstage files
- Commit with a message
- Discard working-tree changes (with confirmation; untracked files are deleted)
- Pull (fast-forward only) / Push
- Switch local branches

Requires **Git on PATH** (for example Git for Windows) and a folder that is already a Git repository (`git init` or a clone).

This is separate from [AI Apply Undo](../ai/chat.md): Undo restores Compass backups under `.compass/ai-undo/` and does not create Git commits.

## Not included yet

- Branch create, stash, merge / rebase, or conflict-resolution UI
- GitHub auth, Issues, or Pull Requests
- MCP

Use the integrated terminal or an external Git client for those.

## Related

- [Open a project](../getting-started/open-project.md)
- [AI chat](../ai/chat.md)
- [MCP](mcp.md)
- [FAQ](../troubleshooting/faq.md)
