# Contributing to Compass

Thanks for your interest in contributing.

**Language:** English is preferred for issues, pull requests, and code review comments. Japanese is also welcome.

## Getting started

1. Read the [Development guide](docs/DEVELOPMENT.md)
2. Skim [Architecture](docs/ARCHITECTURE.md) if you touch IPC or main-process code
3. Fork / clone, then:

```bash
npm install
npm run dev
```

If `node-pty` fails to build, run `npm run rebuild-native` (Visual Studio Build Tools required on Windows).

## How to contribute

1. Open an issue for larger changes when possible (bugs, features, design questions)
2. Keep PRs focused — one concern per PR is easier to review
3. Match existing code style and patterns in the area you touch
4. Update docs when behavior or public APIs change:
   - **English** under `docs/` is the source of truth
   - Update `docs/ja/` when you can (or note in the PR that Japanese is pending)

## Project map

| Area | Path |
|------|------|
| UI | `src/` |
| Main process / IPC | `electron/` |
| UI i18n | `src/i18n/` (`en` default, `ja`) |
| Docs (EN) | `docs/` |
| Docs (JA) | `docs/ja/` |

## Pull request checklist

- [ ] Builds locally (`npm run build` or at least `npm run dev`)
- [ ] No secrets (API keys, tokens) in the diff
- [ ] Docs updated if needed
- [ ] New UI strings go through `src/i18n` (both `ja` and `en`)

## Code of conduct

Be respectful and constructive. We assume good intent and prefer clear, actionable feedback.
