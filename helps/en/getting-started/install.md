---
title: Install
keywords:
  - Install
  - Download
  - Setup
  - Windows
  - Installer
  - Node.js
  - Dev mode
category: getting-started
related:
  - welcome.md
  - ai-provider.md
  - ../troubleshooting/common-errors.md
commands:
  - Open Settings
---

# Install

## Recommended: installer

1. Open the [latest release](https://github.com/niki-ikuo/compass/releases/latest)
2. Download `Compass Setup x.y.z.exe`
3. Run it (Windows 10/11 x64)

After launch, go to [AI provider setup](ai-provider.md).

## For developers: run from source

Requirements:

- Windows 10 / 11 (x64)
- [Node.js](https://nodejs.org/) 18+
- npm

```bash
git clone https://github.com/niki-ikuo/compass.git
cd compass
npm install
npm run dev
```

If `node-pty` fails to build:

```bash
npm run rebuild-native
```

### Useful commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev launch |
| `npm run build` | Production build |
| `npm run dist` | Create installer (`release/`) |

## FAQ

**Q. Where is it installed?**  
A. Follow the Windows installer prompts. Settings and workspace data are stored in the app’s local data area.

**Q. I can’t update**  
A. Reinstall with the newest `Setup`, or check the release page. See [Common errors](../troubleshooting/common-errors.md).

## Related

- [Welcome](welcome.md)
- [AI provider setup](ai-provider.md)
- [Common errors](../troubleshooting/common-errors.md)
