---
title: FAQ
keywords:
  - FAQ
  - Frequently asked questions
  - Shortcuts
  - Save
  - History
  - Use case
  - Claude
  - Language
  - Locale
  - English
  - Japanese
category: troubleshooting
related:
  - common-errors.md
  - ../getting-started/welcome.md
  - ../ai/chat.md
  - ../ai/agent.md
---

# FAQ

## What is Compass?

An AI workspace for local folders. Edit text in a VS Code–like editor and work with AI via Ask / Edit / Agent. → [Welcome](../getting-started/welcome.md)

## Is it a Cursor or VS Code replacement?

Different goals. Compass focuses on “open a folder and write with AI.” There is no extension ecosystem or GitHub integration yet.

## Can I use Claude?

There is no dedicated Claude provider. Use **OpenRouter** (or similar) and pick an Anthropic model. → [AI setup](../getting-started/ai-provider.md)

## How do I switch between English and Japanese?

Open **Settings → Language** and choose `English` or `日本語`. The UI, help articles, and AI Help answers follow that setting. If Help is already open, the articles switch when you change the language.

## Is there autosave?

No. Save explicitly. If you close a dirty editor tab or quit the app, Compass asks whether to save.

## Where is chat history?

In the open workspace: `.compass/chat-history.json`.

## Ask / Edit / Agent vs General / Document / Data / Code?

- Ask / Edit / Agent … **how it behaves** (read-only / propose / tool loop)
- Use-case presets … **what role it speaks as**

Both are available around chat. With **Data** + Agent you also get table profiling and read-only queries; with **Document** + Agent, heading-aware reads and light structure checks. → [AI chat](../ai/chat.md) / [Agent](../ai/agent.md)

## How do I search across files?

Open the **Search** tab on the left sidebar (folder must be open). → [Search](../getting-started/search.md)

## GitHub or MCP?

Not available. → [GitHub](../integrations/github.md) / [MCP](../integrations/mcp.md)

## I’m getting errors

Start with [Common errors](common-errors.md).

## Related

- [Common errors](common-errors.md)
- [Welcome](../getting-started/welcome.md)
- [Index](../index.md)
