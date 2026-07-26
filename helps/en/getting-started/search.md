---
title: Search in the workspace
keywords:
  - Search
  - Find
  - Replace
  - Meaning
  - Hybrid
  - Workspace
  - Sidebar
  - Regex
  - PDF
category: getting-started
related:
  - welcome.md
  - open-project.md
  - ../ai/chat.md
commands:
  - Open Folder
---

# Search in the workspace

Search text across files in the open folder from the left **Search** tab. Besides Markdown and other text, extracted text from PDFs and `.docx` files is included.

## How to open

1. [Open a folder](open-project.md)
2. Click the **Search** tab at the top of the left sidebar (next to **Explorer** / **Outline**)

Or use **View → Show Search**, or **Edit → Find in Files** (Ctrl+Shift+F). Search is disabled until a folder is open.

## Search modes

| Mode | Use when |
|------|----------|
| **Meaning** | Looking by topic or wording (hybrid keyword + neural embeddings over the index; Settings → Chat) |
| **Text** | Exact-ish text match. Replace is available here |

## What you can do

- Search across workspace text (including PDF / `.docx` extracts)
- See path, heading, and snippet — click to open at that location
- Optional **replace** (text mode; toggle in the Search panel)
- Match options: case sensitive, whole word, regular expression (text mode)
- Include / exclude globs to narrow the scope

## Tips

- Large folders may take a moment to index or search
- Ignored folders such as `node_modules` and `.git` are skipped, same as Explorer
- For a heading map only, use the left **Outline** tab (Ctrl+Shift+O)

## Related

- [Welcome](welcome.md)
- [Open a project](open-project.md)
- [AI chat](../ai/chat.md)
