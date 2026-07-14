# Agent モード — 実装計画

[English](../AGENT_PLAN.md) | **日本語**

v2.0 **Agent** 自律実行（ツールループ・コマンド・複数ステップ）の実装計画です。関連: [SPEC.md](./SPEC.md) §10、[ARCHITECTURE.md](./ARCHITECTURE.md)。

ブランチ: `feature/ai-chat-agent`

---

## 1. 目標と境界

| モード | 意味 | 状態 |
|--------|------|------|
| **Ask** | 説明・レビューのみ。ワークスペース変更は提案しない | 実装済み |
| **Edit** | 作成・変更・削除を JSON で提案し、ユーザーがプレビュー承認して適用 | 実装済み |
| **Agent** | Cursor 風のツール呼び出しループ、任意のコマンド実行、複数ステップの自動化 | 未実装 |

Agent は「大きな Edit」ではない。Edit は一発提案 → 人間が適用のまま。Agent は model → tool → observation → model … のループを、完了・キャンセル・エラーまで回す。

### 非目標（本計画／初期フェーズ）

- MCP / プラグイン（SPEC v3.0）
- セマンティック RAG（SPEC v2.1）
- クラウド認証・マルチテナント（ローカル・ワークスペース単位のまま）
- Phase 1–2 での破壊的変更の自動適用（承認なし）

---

## 2. 設計上の制約（現行アーキテクチャ）

1. **ツールは Main のみ** — FS / AI / PTY と同じ権限モデル。Renderer は `window.compass` のみ。
2. **ワークスペース砂箱** — パスは開いているフォルダ内に解決（`resolveInsideWorkspace`）。`..` での脱出禁止。
3. **書き込みは人間承認** — Edit の preview → apply（`previewActions` / `applyActions`）を再利用。
4. **同時に 1 本のキャンセル可能なラン** — `ai:cancel` と同様の Abort 方針。
5. **OpenAI 互換 `tools` API** — `compass-actions` テキストプロトコルの拡張より native tool calling を優先。非対応プロバイダは後続でフォールバック。
6. **ターミナルの分離** — ユーザー用 PTY（xterm）と、Agent 用の短命・制御付き `exec` を分ける。

### 再利用できる資産

| 資産 | 場所 | Agent での用途 |
|------|------|----------------|
| Preview / apply | `WorkspaceAction`、`fs.previewActions` / `applyActions` | 書き込みゲート |
| 検索 / 構造索引 | `workspace-search`、`.compass` indexer | 初期の読取ツール |
| SSE + IPC + abort | `ai-client`、`ai:chunk` / `ai:done` / `ai:cancel` | ストリームとキャンセル |
| チャット履歴 | `.compass/chat-history.json` | ステップ・モードの永続化 |
| モード UI | `ChatPanel`、`ChatMode` | `agent` の正式復活 |

注意: `normalizeChatMode` は現状レガシー `'agent'` を `'edit'` にマップしている。Agent 出荷時はこの互換ルールを見直す。

---

## 3. Phase 0 — 契約（本実装の前）

ループ本実装より先に型と IPC を決め、UI と Main の食い違いを防ぐ。

### モードとラン状態

- `ChatMode` に `'agent'` を正式復活（新規セッションで agent → edit 正規化をやめる）。
- ランライフサイクル（概念）:

```
idle → thinking → tool_call → (waiting_approval)? → applying? → thinking → … → done | error | aborted
```

### 推奨 IPC イベント（既存 AI チャネルの拡張）

| イベント | 用途 |
|----------|------|
| `ai:chunk` | アシスタントテキストの delta（現状どおり） |
| `ai:toolStart` | ツール名 + 引数（UI 向けにサニタイズ） |
| `ai:toolResult` | 観測結果の要約 / 成功 / 失敗 |
| `ai:needApproval` | 書き込みプレビュー待ち（ループ一時停止） |
| `ai:step` | 任意のハイレベル手順ラベル |
| `ai:done` / `ai:error` / `ai:aborted` | 終端状態 |

名前は変更可。チャットに **ステップタイムラインを出せるだけのイベント** があることが重要。

### 永続化

**決定:** ツールステップは `ChatMessage.agentSteps` に埋め込む（アシスタントメッセージ）。Ask / Edit の会話は当該フィールドを無視する。履歴読込時、途中の `running` は `error` に矯正する。

### Phase 2 書き込みポリシー（決定済み）

| トピック | 決定 |
|----------|------|
| 書き込みツール | 一括 **`proposeActions`** → `WorkspaceAction[]` |
| 適用場所 | Renderer の `applyWorkspacePreview` / `revertWorkspacePreview`（Edit と同じ UX） |
| 却下後 | 観測結果をモデルに返しループを**続行**（再提案可） |
| 適用後 | 適用サマリを返し**続行** |
| ポーズ IPC | `ai:needApproval` + `ai:resolveApproval` |

### SPEC 更新

Ask / Edit / Agent の境界を SPEC に明記する（本計画はビルド用チェックリストとして残す）。

**完了条件:** TypeScript 型 + IPC スタブ合意、SPEC 用語更新。フルループは不要。

---

## 4. Phase 1 — 薄いランタイム（読取専用）

**目標:** ワークスペースを変更せずにツールループを端到端で証明する。

### 初期ツール

| ツール | 挙動 |
|--------|------|
| `readFile` | ワークスペース内ファイル読取（サイズ上限） |
| `listDir` | ディレクトリ一覧 |
| `search` | 既存のワークスペース検索 / 索引を利用 |

### 実装スケッチ

- `ai-client.ts` を際限なく肥大化させず、`electron/services/agent-runner.ts`（相当）を推奨。
- ターン数・ツール呼び出し数に上限を付け、暴走を防ぐ。
- アシスタントテキストをストリームしつつ、ツールイベントを Renderer へ。
- キャンセルは進行中 HTTP を中断し、以降のツールを止める。

### UI

- モード切替: Ask / Edit / Agent。
- チャット内のステップタイムライン（ツール名、結果の要約）。

**完了条件:** Agent に質問 → ツールでファイル読取 → ステップ表示 → キャンセル可。書き込みなし。

---

## 5. Phase 2 — 書き込み + 人間承認

**目標:** Edit と同等の安全性で、複数ステップ編集を可能にする。

**状態:** `feature/ai-chat-agent` で実装済み。

- ツール: `proposeActions({ actions: WorkspaceAction[] })`
- ループが**一時停止**し、プレビュー付きで `ai:needApproval` を送る
- UI は Edit の preview / PreviewBar を再利用。採用/拒否で `ai:resolveApproval`
- 却下・適用のどちらも観測結果を返し、ランは**続行**（却下で強制停止しない）
- Ask / Edit の経路は無変更

**完了条件:** 計画 → 読取 → 提案 → ユーザー承認 → 適用が複数ステップで成立。Ask / Edit は無変更。

---

## 6. Phase 3 — 制限付きコマンド実行

**目標:** テスト・lint・ビルドなどのフィードバックループを、生シェルと同視せずに閉じる。

**状態:** `feature/ai-chat-agent` で実装済み。

- ツール: `exec({ command, cwd?, timeoutMs? })`（`electron/services/agent-exec.ts`）
- cwd はワークスペース内、timeout 既定 30s（上限 120s）、stdout/stderr 上限（約 64KB）
- 非対話（stdin 無視）。ユーザー向け PTY とは分離
- **シェル:** Windows は Git Bash があれば優先（なければ `cmd.exe`）。他 OS は `/bin/sh`
- **deny-list** で危険パターンを拒否。キャンセル時は可能なら子プロセスを kill

**完了条件:** 安全なコマンドが実行され、出力がモデルに返り、UI にコマンドステップが出る。可能ならキャンセルで子プロセスを殺す。

---

## 7. Phase 4 — UX と堅牢化

**状態:** `feature/ai-chat-agent` で実装済み。

- **部分適用:** ファイル単位の適用/却下でプレビューキューが空になったら、適用/却下の観測を返して Agent 承認を再開（失敗後の再試行 UI は後回し）
- **進捗 / キャンセル:** `ai:step` のステータス表示、`waiting_approval` ステップ、中断時に承認と running/waiting をクリア
- **tools 非対応:** 明確なエラー（`ai.agentToolsUnsupported`）で Edit または tools 対応モデルへ誘導（自動 Edit フォールバックは未実装）
- **履歴:** 読込時に `waiting_approval` / `running` を安全に正規化
- **ガードレール:** ターン上限、ペイロード切り詰め、ツール引数・ログおよび `exec` 出力の秘密マスキング（`src/utils/redact.ts`）

**完了条件:** Compass が既に支える主要プロバイダで日常利用に耐える。

**後回し:** 失敗後の再試行 UI、tools 非対応時の自動 Ask/Edit フォールバック、プロバイダ別の Agent トグル非表示。

---

## 8. Phase 5 — 知能の拡張（後続ロードマップ）

SPEC に合わせる:

| Spec | 範囲 |
|------|------|
| v2.1 | セマンティック検索 / RAG / 埋め込み |
| v3.0 | MCP、プラグイン、非 OpenAI 互換ネイティブ API |
| ポリシー | 信頼できる読取専用ツールのみ、任意の自動承認 |

---

## 9. フェーズ図

```
Phase 0  契約（型、IPC、SPEC、永続化）
   ↓
Phase 1  読取専用ツールループ + ステップ UI
   ↓
Phase 2  preview/apply 経由の書き込み + 承認一時停止
   ↓
Phase 3  制限付き exec（ユーザー PTY と分離）
   ↓
Phase 4  UX、上限、プロバイダフォールバック
   ↓
Phase 5  RAG → MCP / プラグイン（SPEC v2.1 / v3.0）
```

---

## 10. 最初の実装スライス（推奨順）

1. SPEC / 型: Ask · Edit · Agent の境界、`'agent'` モード復活。
2. UI に Agent トグル（ランナーはスタブでも可）。
3. Main: 最大 N ターンの読取専用ランナー（ツール 1〜2 個）。
4. チャット: 新 IPC イベントからツールステップを描画。
5. その後に書き込みツール + 承認一時停止。

「コマンド実行 + 書き込みの自動適用」を一スライスに詰めない。キャンセル・承認・プロバイダ差・履歴が同時に衝突しやすい。

---

## 11. 未決事項

実装が進んだらここに決定を記録する:

| トピック | 選択肢 / メモ | 決定 |
|----------|---------------|------|
| 却下後の承認ポリシー | ラン停止 vs 書き込みなしで続行 | **却下観測を返して続行** |
| 書き込みツールの粒度 | 一括 `proposeActions` vs 複数ツール | **`proposeActions` 一括** |
| tools 非対応プロバイダ | Agent 非表示 / 警告 / フォールバック | **明確なエラーで警告**（Edit / モデル切替）。非表示トグル・自動フォールバックは後回し |
| ステップ永続化の形 | メッセージ上 vs 別ラン記録 | **`ChatMessage.agentSteps`** |
| exec の許可方式 | まず allow-list vs deny-list | **deny-list 優先**（`agent-exec.ts`） |
