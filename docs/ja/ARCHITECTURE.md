# アーキテクチャ

[English](../ARCHITECTURE.md) | **日本語**

Compass は Electron のメイン / プリロード / レンダラーの 3 層構成です。ファイルシステム・AI 通信・設定・ターミナルなど特権処理はメインプロセス側に置き、レンダラーは `contextBridge` 経由の IPC のみを使います。

## プロセス構成

```
┌─────────────────────────────────────────────────┐
│                  Renderer Process               │
│  FileTree / Editor / ChatPanel / Terminal など  │
│                     │                           │
│              Zustand Store                      │
└─────────────────────┬───────────────────────────┘
                      │ IPC (preload / contextBridge)
┌─────────────────────┴───────────────────────────┐
│                  Main Process                   │
│  filesystem / ai-client / agent-runner / settings / terminal   │
│  project-indexer / chat-history など            │
└─────────────────────────────────────────────────┘
```

| 層 | 主な責務 |
|----|----------|
| Renderer (`src/`) | UI、編集状態、チャット表示、ユーザー操作 |
| Preload (`electron/preload.ts`) | `window.compass` API の公開 |
| Main (`electron/`) | FS、AI SSE、設定保存、索引、PTY |

## ディレクトリ役割

```
electron/
├── main.ts                 # ウィンドウ生成・IPC 登録
├── preload.ts              # Renderer 向け API
└── services/
    ├── filesystem.ts       # ディレクトリ・ファイル操作
    ├── ai-client.ts        # OpenAI 互換 API / SSE（Ask / Edit）
    ├── agent-runner.ts     # Agent ツールループ（Phase 1–4）
    ├── agent-exec.ts       # Agent 用の制限付きコマンド実行
    ├── settings.ts         # 設定の読み書き
    ├── project-indexer.ts  # ワークスペース索引
    ├── index-watcher.ts    # 索引のファイル監視
    ├── chat-history.ts     # チャット履歴
    └── encoding.ts         # 文字コード

src/
├── App.tsx                 # ルート UI・ワークスペース起動
├── components/             # 画面コンポーネント
├── stores/app-store.ts     # Zustand ストア
├── utils/                  # プレビュー・索引・エンコーディング等
└── types/                  # 共有型定義
```

## IPC（概要）

Renderer からは `window.compass.*` を呼び出します。実装の正は `electron/preload.ts` と `electron/main.ts` です。

| 名前空間 | 用途 |
|----------|------|
| `fs:*` | フォルダ選択、読み書き、作成・移動・削除、アクション適用 |
| `ai:*` | チャット送信、チャンク / 完了 / エラー / ツールイベント、インライン補完 |
| `settings:*` | 設定の取得・保存 |
| `workspace:*` | 直近ワークスペース・最近開いたフォルダ |
| `index:*` | プロジェクト索引の構築・監視 |
| `chat:*` | チャット履歴の読み書き |
| `terminal:*` | PTY の生成・入出力・リサイズ・終了 |
| `shell:*` / `menu:*` | アプリ操作・メニューイベント |

## データフロー（AI チャット）

1. Renderer が現在ファイル・選択範囲・参照コンテキストを組み立てる（Ask / Edit / Agent）
2. Main が `.compass` の構造索引を確保し、AI 向けコンテキストに付与する
3. `ai:chat` で Main にリクエストを送る
4. Main がモードで振り分ける:
   - **Ask / Edit**: `ai-client` の SSE（`delta.content` のみ）
   - **Agent**: `agent-runner` のツールループ（OpenAI 互換 `tools` + SSE）
5. トークンを `ai:chunk` で返す。Agent は `ai:toolStart` / `ai:toolResult` / `ai:step` も送る
6. 完了時に `ai:done`、失敗時に `ai:error`、キャンセル時に `ai:aborted`
7. **Ask**: 説明のみ（ファイル変更アクションは出さない）
8. **Edit**: `compass-actions` をパース → プレビュー → ユーザー承認で適用（自律ツールループではない）
9. **Agent（Phase 1–4）**: 読取ツール、`proposeActions`（一時停止 → プレビュー → 承認、部分適用含む）、制限付き `exec`、ターン/ペイロード上限、秘密マスキング、tools 非対応エラー、`waiting_approval` UI — 詳細: [AGENT.md](./AGENT.md)

## `.compass` 索引

ワークスペース直下の `.compass/` に構造索引を保存する（`project-indexer.ts`）。

| ファイル | 内容 |
|----------|------|
| `meta.json` | バージョン・更新時刻など |
| `files.json` | パス・言語・import/export・シンボル概要 |
| `graph.json` | ファイル間 import エッジ |
| `summary.txt` | AI 向け要約テキスト |

チャット時に関連部分をコンテキストへ載せる。埋め込みベクトルによる RAG 検索ではない。

## マルチ LLM

設定の `providerId` で OpenAI 互換プロバイダを切り替える（`src/utils/llm-providers.ts`）。

| 項目 | 内容 |
|------|------|
| プリセット | OpenAI / Google Gemini / DeepSeek / Groq / OpenRouter / Ollama / カスタム |
| API Key | プロバイダ別に暗号化保存し、切替時に復元 |
| モデル | 設定画面またはチャットヘッダから切替（自由入力可） |
| 通信 | Main の `ai-client` が `/chat/completions` SSE で接続 |

Claude など OpenAI 非互換のネイティブ API は未対応。OpenRouter 経由で利用する。

## セキュリティ方針

- API キーは Renderer から直接外部 API を叩かない（Main 経由）
- 設定の機密情報は平文で扱わない想定（Credential Manager 等）
- `nodeIntegration` を有効にせず、preload の公開面だけを使う
