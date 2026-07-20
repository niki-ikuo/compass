---
title: AI provider setup
keywords:
  - AI
  - API Key
  - Provider
  - OpenAI
  - Gemini
  - DeepSeek
  - Groq
  - OpenRouter
  - Ollama
  - Claude
  - Anthropic
  - Model
  - Settings
category: getting-started
related:
  - welcome.md
  - open-project.md
  - ../ai/chat.md
  - ../ai/agent.md
  - ../troubleshooting/common-errors.md
commands:
  - Open Settings
  - Open Provider
---

# AI provider setup

Before using AI, configure the provider and model.

## How to open

Open **Settings** from the menu.

## Settings

| Item | Description |
|------|-------------|
| Provider | OpenAI / Gemini / DeepSeek / Groq / OpenRouter / Ollama / Custom |
| API Key | Stored per provider (not required for Ollama) |
| Model | Pick a suggestion or type freely |
| Base URL | Set automatically by provider (manual for Custom) |

## Provider cheat sheet

| Provider | API Key | Agent |
|----------|---------|-------|
| OpenAI | Required | Available |
| Google Gemini | Required | Available |
| DeepSeek | Required | Available |
| Groq | Required | Available |
| OpenRouter | Required | Depends on model (Claude via here) |
| Ollama (local) | Not required | **Unavailable** (Ask / Edit only) |
| Custom (OpenAI-compatible) | Usually required | Depends on endpoint |

There is no dedicated Claude provider. Use **OpenRouter** (or similar) and pick an Anthropic model.

## Ollama (local)

1. Start [Ollama](https://ollama.com/) on this machine
2. Set provider to **Ollama** (default URL: `http://localhost:11434/v1`)
3. Pull the model you want (e.g. `ollama pull llama3.2`)

If it can’t connect, see [Common errors](../troubleshooting/common-errors.md).

## Typical flow

1. Choose a provider
2. Enter the API key (if required)
3. Choose a model
4. Save
5. [Open a folder](open-project.md) → [Chat](../ai/chat.md)

## FAQ

**Q. “API key is not set”**  
A. The key for the currently selected provider is empty. Open Settings again.

**Q. No Agent toggle**  
A. Providers without tools support (e.g. Ollama) hide Agent and keep Ask / Edit only. See [Agent](../ai/agent.md).

## Related

- [Open a project](open-project.md)
- [AI chat](../ai/chat.md)
- [Agent](../ai/agent.md)
- [Common errors](../troubleshooting/common-errors.md)
