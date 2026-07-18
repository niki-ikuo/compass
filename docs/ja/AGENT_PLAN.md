# Agent モード — 実装計画

[English](../AGENT_PLAN.md) | **日本語**

**v2.0 Agent** 自律実行（ツールループ・コマンド・複数ステップ）の段階的実装記録です。**Phase 0–4 は現行製品に出荷済み**（`package.json` の version 2.0.x）。今日のランタイムの動きは [AGENT.md](./AGENT.md) を参照。関連: [SPEC.md](./SPEC.md) §10、[ARCHITECTURE.md](./ARCHITECTURE.md)。

フェーズチェックリスト・決定済みポリシー・**残りの**後回し項目を残す文書であり、「未着手の計画書」ではない。

---

## 1. 目標と境界

| モード | 意味 | 状態 |
|--------|------|------|
| **Ask** | 説明・レビューのみ。ワークスペース変更は提案しない | 実装済み |
| **Edit** | 作成・変更・削除を JSON で提案し、ユーザーがプレビュー承認して適用 | 実装済み |
| **Agent** | Cursor 風のツール呼び出しループ、制限付きコマンド実行、複数ステップの自動化（Phase 0–4） | 実装済み（v2.0） |

Agent は「大きな Edit」ではない。Edit は一発提案 → 人間が適用のまま。Agent は model → tool → observation → model … のループを、完了・キャンセル・エラーまで回す。

### 非目標（引き続き対象外 / 後続）

- MCP / プラグイン（SPEC v3.0）
- セマンティック RAG（SPEC v2.1）
- クラウド認証・マルチテナント（ローカル・ワークスペース単位のまま）
- 破壊的変更の自動適用（承認なし）

---

## 2. 設計上の制約（現行アーキテクチャ）

1. **ツールは Main のみ** — FS / AI / PTY と同じ権限モデル。Renderer は `window.compass` のみ。
2. **ワークスペース砂箱** — パスは開いているフォルダ内に解決（`resolveInsideWorkspace`）。`..` での脱出禁止。
3. **書き込みは人間承認** — Edit の preview → apply（`previewActions` / `applyActions`）を再利用。
4. **同時に 1 本のキャンセル可能なラン** — `ai:cancel` と同様の Abort 方針。
5. **OpenAI 互換 `tools` API** — native tool calling（`compass-actions` テキストプロトコルではない）。tools 非対応プロバイダは明確なエラー（自動 Edit フォールバックは後回しのまま）。
6. **ターミナルの分離** — ユーザー用 PTY（xterm）と、Agent 用の短命・制御付き `exec` を分ける。

### 再利用できる資産

| 資産 | 場所 | Agent での用途 |
|------|------|----------------|
| Preview / apply | `WorkspaceAction`、`fs.previewActions` / `applyActions` | 書き込みゲート |
| 検索 / 構造索引 | `workspace-search`、`.compass` indexer | 読取ツール |
| SSE + IPC + abort | `ai-client`、`ai:chunk` / `ai:done` / `ai:cancel` | ストリームとキャンセル |
| チャット履歴 | `.compass/chat-history.json` | ステップ・モードの永続化 |
| モード UI | `ChatPanel`、`ChatMode` | `'agent'` は第一級モード |

`ChatMode` に `'agent'` を含み、`normalizeChatMode` も受け入れる（agent → edit の再マップなし）。

---

## 3. Phase 0 — 契約 — **実装済み**

型と IPC を決め、UI と Main の食い違いを防ぐ。

### モードとラン状態

- `ChatMode` に `'agent'` を含む。
- ランライフサイクル（概念）:

```
idle → thinking → tool_call → (waiting_approval)? → applying? → thinking → … → done | error | aborted
```

### IPC イベント（AI チャネル）

| イベント | 用途 |
|----------|------|
| `ai:chunk` | アシスタントテキストの delta |
| `ai:toolStart` | ツール名 + 引数（UI 向けにサニタイズ） |
| `ai:toolResult` | 観測結果の要約 / 成功 / 失敗 |
| `ai:needApproval` | 書き込みプレビュー待ち（ループ一時停止） |
| `ai:step` | ハイレベル手順ラベル |
| `ai:done` / `ai:error` / `ai:aborted` | 終端状態 |

### 永続化

ツールステップは `ChatMessage.agentSteps` に埋め込む（アシスタントメッセージ）。Ask / Edit の会話は当該フィールドを無視する。履歴読込時、途中の `running` / `waiting_*` は `error` に矯正する。

### Phase 2 書き込みポリシー（決定済み）

| トピック | 決定 |
|----------|------|
| 書き込みツール | 一括 **`proposeActions`** → `WorkspaceAction[]`（`writeFile` / **`applyPatch`** / mkdir / 削除） |
| 適用場所 | Renderer の `applyWorkspacePreview` / `revertWorkspacePreview`（Edit と同じ UX） |
| 却下後 | 観測結果をモデルに返しループを**続行**（再提案可） |
| 適用後 | 適用サマリを返し**続行** |
| ポーズ IPC | `ai:needApproval` + `ai:resolveApproval` |

**完了条件:** 達成済み。

---

## 4. Phase 1 — 薄いランタイム（読取専用）— **実装済み**

ワークスペースを変更せずにツールループを端到端で証明する。

| ツール | 挙動 |
|--------|------|
| `readFile` | ワークスペース内ファイル読取（サイズ上限） |
| `listDir` | ディレクトリ一覧 |
| `search` | ワークスペース検索 / 索引 |

- ランナー: `electron/services/agent-runner.ts`
- ターン数・ツール呼び出し数に上限。テキストストリーム + ツールイベント。キャンセルで HTTP と以降のツールを止める
- UI: Ask / Edit / Agent 切替、チャット内ステップタイムライン

**完了条件:** 達成済み。

---

## 5. Phase 2 — 書き込み + 人間承認 — **実装済み**

- ツール: `proposeActions({ actions: WorkspaceAction[] })` — 既存ファイルは **`applyPatch`** 優先、`writeFile` は新規／短い全置換向け
- ループが**一時停止**し、プレビュー付きで `ai:needApproval` を送る
- UI は Edit の preview / PreviewBar を再利用。採用/拒否で `ai:resolveApproval`
- 却下・適用のどちらも観測結果を返し、ランは**続行**
- Ask / Edit の経路は無変更

**完了条件:** 達成済み。

---

## 6. Phase 3 — 制限付きコマンド実行 — **実装済み**

- ツール: `exec({ command, cwd?, timeoutMs? })`（`electron/services/agent-exec.ts`）
- cwd はワークスペース内、timeout 既定 30s（上限 120s）、stdout/stderr 上限（約 64KB）
- 非対話。ユーザー向け PTY とは分離
- **シェル:** Windows は Git Bash があれば優先（なければ `cmd.exe`）。他 OS は `/bin/sh`
- **deny-list** で危険パターンを拒否。キャンセル時は可能なら子プロセスを kill

**完了条件:** 達成済み。

---

## 7. Phase 4 — UX と堅牢化 — **実装済み**

- **部分適用:** ファイル単位の適用/却下でプレビューキューが空になったら、適用/却下の観測を返して Agent 承認を再開
- **適用失敗 → 再提案:** 適用エラー時はプレビューを残して再試行可能。**Agentに修正させる** でプレビューを閉じ、失敗観測を返してループが再提案できる
- **検証ループ:** `verify` ツールでプロジェクトの test / lint / typecheck をスクリプト（または安全なフォールバック）経由で実行
- **進捗 / キャンセル:** `ai:step` のステータス表示、`waiting_approval` ステップ、中断時に承認と running/waiting をクリア
- **tools 非対応:** 明確なエラー（`ai.agentToolsUnsupported`）で Edit または tools 対応モデルへ誘導
- **履歴:** 読込時に `waiting_approval` / `running` を安全に正規化
- **ガードレール:** ターン上限、ペイロード切り詰め、秘密マスキング（`src/utils/redact.ts`）および `exec` 出力
- **計画レイヤ:** `updateTodo` + `checkpoint`（`electron/services/agent-plan.ts`）
- **コンテキスト保持（RAG 前段階）:** `remember` + 観測の自動要約（`agent-memory.ts`）；強化された `.compass` 要約；ラン内 `readFile` キャッシュ（`agent-read-cache.ts`）

**完了条件:** 主要 OpenAI 互換プロバイダでの日常利用として達成済み。

### 後回し（未着手のまま）

| 項目 | メモ |
|------|------|
| tools 非対応時の自動 Ask/Edit フォールバック | 現状は明確なエラーのみ |
| プロバイダ別の Agent トグル非表示 | 任意の UX 磨き |

---

## 8. Phase 5 — 知能の拡張（後続ロードマップ）

SPEC に合わせる:

| Spec | 範囲 | 状態 |
|------|------|------|
| v2.1 | セマンティック検索 / RAG / 埋め込み | 未着手 |
| v3.0 | MCP、プラグイン、非 OpenAI 互換ネイティブ API | 未着手 |
| ポリシー | 信頼できる読取専用ツールのみ、任意の自動承認 | 未着手 |

---

## 9. フェーズ図

```
Phase 0  契約（型、IPC、SPEC、永続化）              ✅ 出荷済み
   ↓
Phase 1  読取専用ツールループ + ステップ UI          ✅ 出荷済み
   ↓
Phase 2  preview/apply 経由の書き込み + 承認一時停止 ✅ 出荷済み
   ↓
Phase 3  制限付き exec（ユーザー PTY と分離）         ✅ 出荷済み
   ↓
Phase 4  UX、上限、プロバイダエラー、plan/memory     ✅ 出荷済み（v2.0）
   ↓
Phase 5  RAG → MCP / プラグイン（SPEC v2.1 / v3.0）  ○ 後続
```

---

## 10. 実装順（履歴）

v2.0 出荷までに実際に使った順:

1. SPEC / 型: Ask · Edit · Agent の境界、`'agent'` モード
2. UI に Agent トグル
3. Main: 最大 N ターンの読取専用ランナー
4. チャット: IPC イベントからツールステップを描画
5. 書き込みツール + 承認一時停止
6. 制限付き `exec`、続けて Phase 4 の UX / verify / plan / memory

「コマンド実行 + 書き込みの自動適用」を一スライスに詰めない。キャンセル・承認・プロバイダ差・履歴が同時に衝突しやすい。

---

## 11. 決定事項（記録）

| トピック | 選択肢 / メモ | 決定 |
|----------|---------------|------|
| 却下後の承認ポリシー | ラン停止 vs 書き込みなしで続行 | **却下観測を返して続行** |
| 書き込みツールの粒度 | 一括 `proposeActions` vs 複数ツール | **`proposeActions` 一括** |
| tools 非対応プロバイダ | Agent 非表示 / 警告 / フォールバック | **明確なエラーで警告**（Edit / モデル切替）。非表示トグル・自動フォールバックは後回し |
| ステップ永続化の形 | メッセージ上 vs 別ラン記録 | **`ChatMessage.agentSteps`** |
| exec の許可方式 | まず allow-list vs deny-list | **deny-list 優先**（`agent-exec.ts`） |
