---
title: Common errors
keywords:
  - Error
  - API
  - API Key
  - Network
  - Ollama
  - Agent
  - Connection
  - 401
  - Update
category: troubleshooting
related:
  - faq.md
  - ../getting-started/ai-provider.md
  - ../ai/agent.md
commands:
  - Open Settings
  - Open Folder
---

# Common errors

Fix by symptom.

## API key is not set

**Meaning:** The API key for the selected provider is empty.

**Fix:**

1. Open **Settings**
2. Select the correct provider
3. Enter that provider’s key and save

→ [AI provider setup](../getting-started/ai-provider.md)

## API Base URL is not set

**Meaning:** A URL is required (e.g. Custom) but it is empty.

**Fix:** Switch back to a preset provider, or enter an OpenAI-compatible Base URL.

## Ollama not found / can’t connect

**Check:**

1. Is `ollama` running on this machine?
2. Is the settings URL around `http://localhost:11434/v1`?
3. Have you `ollama pull …` the model?

Agent is unavailable on Ollama (Ask / Edit only).

## Agent doesn’t work / no toggle

| Cause | Fix |
|-------|-----|
| Ollama | Use Edit or switch provider |
| Model without tools | Change model |
| No folder open | [Open a folder](../getting-started/open-project.md) |

## Network / 401 / 403

- Wrong, expired, or under-permissioned key
- Corporate proxy / firewall
- Provider outage or rate limits

Re-check provider, model, and key; verify the same API with a browser or `curl`.

## Can’t update

For the installer build, reinstalling the newest `Setup` from the [latest release](https://github.com/niki-ikuo/compass/releases/latest) is the reliable path.

## Related

- [FAQ](faq.md)
- [AI provider setup](../getting-started/ai-provider.md)
- [Agent](../ai/agent.md)
