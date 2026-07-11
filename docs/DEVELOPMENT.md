# 開発ガイド

## 環境

- Windows 10 / 11（x64）
- Node.js 18 以上
- npm
- Visual Studio Build Tools（`node-pty` のネイティブビルド用。未導入だと `rebuild-native` が失敗することがある）

## セットアップ

```bash
npm install
```

`postinstall` で `scripts/setup-electron.js` が走り、Electron バイナリが無ければ取得します。

`node-pty` 周りでエラーが出る場合:

```bash
npm run rebuild-native
```

## 日常の開発フロー

```bash
npm run dev
```

- メイン / プリロード / レンダラーは electron-vite が監視・ホットリロードします
- UI 変更は主に `src/`
- IPC・FS・AI・ターミナルは `electron/`

### よく触る場所

| 変更したいこと | 見る場所 |
|----------------|----------|
| 画面レイアウト・パネル | `src/App.tsx`, `src/components/` |
| アプリ状態 | `src/stores/app-store.ts` |
| 共有型 | `src/types/index.ts` |
| IPC 公開 API | `electron/preload.ts` |
| IPC ハンドラ | `electron/main.ts` |
| ファイル操作 | `electron/services/filesystem.ts` |
| AI 通信 | `electron/services/ai-client.ts` |
| 設定保存 | `electron/services/settings.ts` |

## コマンド一覧

| コマンド | 説明 |
|----------|------|
| `npm run dev` | 開発起動 |
| `npm run build` | `out/` へ本番ビルド |
| `npm run preview` | ビルド結果のプレビュー |
| `npm run dist` | ビルド後に electron-builder（NSIS） |
| `npm run rebuild-native` | `node-pty` を Electron 向けに再ビルド |

## パスエイリアス

レンダラーでは `@` → `src/` です（`electron.vite.config.ts`）。

```ts
import { useAppStore } from '@/stores/app-store'
```

## 実装上の注意

1. **特権処理は Main に置く**  
   FS・ネットワーク・PTY・設定の永続化は Renderer から直接行わない。

2. **IPC を追加するとき**  
   `main.ts` の `ipcMain.handle` / `on` と `preload.ts` の `window.compass` をセットで更新する。型は `src/types` に寄せる。

3. **AI ストリーミング**  
   応答本体は invoke の戻り値ではなく、`ai:chunk` / `ai:done` / `ai:error` イベントで運ぶ。

4. **ワークスペース索引（`.compass/`）**  
   フォルダオープン時に構造索引の構築・監視が走る。成果物はワークスペースの `.compass/`（`files.json` / `graph.json` 等）。関連は `project-indexer.ts` / `index-watcher.ts`。意味検索（RAG）ではない。

5. **Ask / Edit**  
   Ask は説明のみ。Edit は `compass-actions` による変更提案＋ユーザー承認。コマンド実行や複数ステップの自律ループ（SPEC 上の「Agent 自律実行」）とは別。

6. **文字コード**  
   読み書きは encoding サービス経由。UI 側の補助は `src/utils/file-encoding.ts`。

## デバッグ

- メニューまたはショートカットから DevTools を開ける（`shell:view` の `toggleDevTools`）
- Main プロセスのログは起動ターミナル側に出る
- Renderer のログは DevTools Console

## 配布前チェック

```bash
npm run build
npm run dist
```

- 出力先: `release/`
- Windows ターゲット: NSIS（`package.json` の `build` 設定）

## 関連ドキュメント

- [製品仕様](./SPEC.md)
- [アーキテクチャ](./ARCHITECTURE.md)
