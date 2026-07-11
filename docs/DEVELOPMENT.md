# Development guide

**English** | [日本語](ja/DEVELOPMENT.md)

## Environment

- Windows 10 / 11 (x64)
- Node.js 18+
- npm
- Visual Studio Build Tools (for `node-pty` native builds; without them `rebuild-native` may fail)

## Setup

```bash
npm install
```

`postinstall` runs `scripts/setup-electron.js` and fetches the Electron binary if missing.

If you hit `node-pty` errors:

```bash
npm run rebuild-native
```

## Day-to-day workflow

```bash
npm run dev
```

- Main / preload / renderer are watched and hot-reloaded by electron-vite
- UI changes: mostly `src/`
- IPC, FS, AI, terminal: `electron/`

### Where to look

| You want to change… | Look at |
|---------------------|---------|
| Layout / panels | `src/App.tsx`, `src/components/` |
| App state | `src/stores/app-store.ts` |
| Shared types | `src/types/index.ts` |
| IPC public API | `electron/preload.ts` |
| IPC handlers | `electron/main.ts` |
| File ops | `electron/services/filesystem.ts` |
| AI networking | `electron/services/ai-client.ts` |
| LLM provider presets | `src/utils/llm-providers.ts` |
| Settings persistence | `electron/services/settings.ts` |
| UI strings / i18n | `src/i18n/` |

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev launch |
| `npm run build` | Production build to `out/` |
| `npm run preview` | Preview the build |
| `npm run dist` | Build then electron-builder (NSIS) |
| `npm run rebuild-native` | Rebuild `node-pty` for Electron |

## Path alias

In the renderer, `@` → `src/` (`electron.vite.config.ts`).

```ts
import { useAppStore } from '@/stores/app-store'
```

## Implementation notes

1. **Keep privileged work in Main**  
   FS, network, PTY, and settings persistence must not run directly in the renderer.

2. **When adding IPC**  
   Update `ipcMain.handle` / `on` in `main.ts` and `window.compass` in `preload.ts` together. Prefer types in `src/types`.

3. **AI streaming**  
   Response body arrives via `ai:chunk` / `ai:done` / `ai:error` events, not as the invoke return value.

4. **Workspace index (`.compass/`)**  
   Opening a folder builds and watches a structure index under `.compass/` (`files.json`, `graph.json`, etc.). See `project-indexer.ts` / `index-watcher.ts`. Not semantic search (RAG).

5. **Ask / Edit**  
   Ask is explain-only. Edit proposes changes via `compass-actions` and requires user approval. Separate from an autonomous Agent tool loop (see SPEC).

6. **Multi-LLM**  
   Assumes OpenAI-compatible endpoints. Provider presets live in `src/utils/llm-providers.ts`. API keys are encrypted per provider. Non-compatible APIs (e.g. Claude) go through OpenRouter.

7. **Encoding**  
   Read/write goes through the encoding service. UI helpers: `src/utils/file-encoding.ts`.

8. **i18n**  
   UI locales are `en` (default) and `ja` under `src/i18n/`. Docs: English at `docs/`, Japanese at `docs/ja/`.

## Debugging

- Open DevTools from the menu or shortcut (`shell:view` → `toggleDevTools`)
- Main process logs go to the launch terminal
- Renderer logs go to the DevTools Console

## Pre-release checks

```bash
npm run build
npm run dist
```

- Output: `release/`
- Windows target: NSIS (`build` in `package.json`)

## Related docs

- [Product spec](./SPEC.md)
- [Architecture](./ARCHITECTURE.md)
- [Contributing](../CONTRIBUTING.md)
