# Agent ランタイム

[English](../AGENT.md) | **日本語**

Compass の **Agent** モードがプログラム上どう動くか — 呼び出し経路、ツールループ、承認、永続化 — を説明するランタイム資料です。段階的な実装計画は [AGENT_PLAN.md](./AGENT_PLAN.md)、プロセス構成は [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

---

## 1. Agent とは（何ではないか）

| モード | 実装 | 書き込み |
|--------|------|----------|
| **Ask** | 1 回の SSE ストリーム（`ai-client.streamChat`） | なし |
| **Edit** | 同上。応答後に `` ```compass-actions`` `` をパース | プレビュー → ユーザー適用 |
| **Agent** | 複数ターンの **ツールループ**（`agent-runner.runAgent`） | `proposeActions` → 同じプレビュー → 適用ゲート |

Agent は「長い Edit」ではない。**model → tool → observation → model** を、ツールなし終了・キャンセル・エラー・予算拒否まで繰り返す。

コード上の設計制約:

1. ツールと FS は **Main のみ**
2. パスは開いているワークスペース内に閉じる
3. 書き込みは自動適用しない — Edit と同じ preview / apply
4. ランは 1 つまでキャンセル可能（`ai:cancel` と共有の `AbortController`）
5. OpenAI 互換の `tools` API（Agent では `compass-actions` テキストプロトコルは使わない）
6. Agent の `exec` は短命の子プロセス — ユーザー用 PTY ターミナルとは別

---

## 2. エントリポイント

```
ChatPanel (mode: 'agent')
  → window.compass.ai.chat(request)
  → IPC ai:chat
  → main.ts: request.mode === 'agent' なら runAgent(webContents, request)
             それ以外は streamChat(...)
```

| 層 | ファイル | 役割 |
|----|----------|------|
| UI | `src/components/ChatPanel.tsx` | 送信、ストリーム / ツール / 承認購読、`agentSteps` 構築 |
| タイムライン | `src/components/AgentStepTimeline.tsx` | `agentSteps` 表示 |
| Preload | `electron/preload.ts` | `compass.ai.*` 公開 |
| IPC | `electron/main.ts` | `ai:chat` / `ai:cancel` / 承認・続行の resolve |
| ループ | `electron/services/agent-runner.ts` | `runAgent` — 本体 |
| 型 | `src/types/index.ts` | `ChatMode`、`AgentToolStep`、IPC イベント |
| プロンプト | `src/i18n/messages.ts` | `ai.agentSystemPrompt` とステップ文言 |

キャンセル: `ai:cancel` → `ai-client` の AbortController → 待ち中の承認/続行を reject → `ai:aborted`。

---

## 3. ライフサイクル

概念的なラン状態（`AgentRunState`）:

```
idle → thinking → tool_call → (waiting_approval | waiting_continue)? → thinking → … → done | error | aborted
```

各 `AgentToolStep` の UI 状態: `running` | `waiting_approval` | `waiting_continue` | `done` | `error`。

履歴読込時、途中の `running` / `waiting_*` は `error`（interrupted）に矯正される。

---

## 4. 典型ラン（ステップバイステップ）

### 4.1 準備（`runAgent`）

1. `workspaceRoot` 必須
2. `agentToolsSupport === 'unsupported'` のプロバイダは明確なエラーで拒否（自動 Edit フォールバックなし）
3. API Key / Base URL 検証
4. API messages を組み立て:
   - `system`: Agent システムプロンプト
   - 過去の user/assistant（`agentSteps` からツール文脈を再構築）
   - 今回の user（`buildUserMessage` — 開いているファイル、選択、参照、`.compass` 要約）
5. 履歴から **plan** / **memory** を再構築（`agent-plan`、`agent-memory`）
6. ラン内 **read キャッシュ** を作成（`agent-read-cache`）
7. 予算は初期 **16 turns** / **40 tool calls**（Continue で延長可）

### 4.2 ターンループ

```
while true:
  if aborted → ai:aborted; return
  if turn >= turnBudget → Continue 確認; 拒否なら ai:done
  ai:step「Thinking turn N」
  POST /chat/completions (stream, tools=AGENT_TOOLS, tool_choice=auto)
  streamAgentTurn → テキスト差分 + tool_calls 累積
  if tool_calls なし:
    if open todo（pending/in_progress）があり open-todo nudge が 2 回未満
      → assistant テキスト + user nudge を追加してループ継続
    else → ai:done; return
  if ツール予算超過 → Continue 確認
  assistant(+tool_calls) を messages に追加
  for each tool_call:
    ai:toolStart
    ツール実行（承認で一時停止しうる）
    観測を記録（remember 以外）
    ai:toolResult
    role:tool を追加
  turn++
```

自然終了は **tool_calls のないターン**。ただし計画に未完了 todo が残っている場合は、ランタイムが user ロールの nudge を注入して継続する（1 ランあたり最大 **2** 回）。「finish」専用ツールはない。

### 4.3 1 ターンの SSE（`streamAgentTurn`）

- `delta.content` → `ai:chunk`
- `delta.tool_calls` を index ごとに `{ id, name, arguments }` へ累積
- tools 非対応らしい HTTP エラーは UI 向け専用メッセージに変換

Agent の `max_tokens` は下限 **32 768**（大きな `proposeActions` JSON の途中切れを減らす）。

---

## 5. ツール一覧

OpenAI function schema は `AGENT_TOOLS`（`agent-runner.ts`）。`executeTool` / 特別扱いの `proposeActions` で振り分け。

| ツール | 主な実装 | 動き | ユーザー介入 |
|--------|----------|------|--------------|
| `readFile` | `agent-read-cache` | 最大約 200 KB、アウトライン、`force=true` 以外はキャッシュ | なし |
| `listDir` | runner | 1 階層、最大 200 エントリ | なし |
| `search` | `workspace-search` | 本文検索、最大 30 件 | なし |
| `proposeActions` | `agent-propose-actions` + `filesystem` | 正規化 → プレビュー → **一時停止** | 適用 / 却下 / 部分適用 / Agent に修正させる |
| `exec` | `agent-exec` | cwd は WS 内、deny-list、タイムアウト、出力上限 | 書込系は `ai:needExecApproval` |
| `verify` | `agent-verify` | test / lint / typecheck（スクリプト or フォールバック） | なし（内部 exec） |
| `updateTodo` | `agent-plan` | チェックリスト | なし |
| `checkpoint` | `agent-plan` | 再開用サマリ | なし |
| `remember` | `agent-memory` | Continue / フォローアップ用の事実メモ | なし |

主な上限（`agent-runner.ts` 定数）:

| 定数 | 初期値 |
|------|--------|
| `MAX_AGENT_TURNS` | 16 |
| `MAX_TOOL_CALLS` | 40 |
| `CONTINUE_TURN_GRANT` / `CONTINUE_TOOL_GRANT` | +12 / +30 |
| `MAX_TOOL_RESULT_CHARS` | 24 000（モデル向け） |
| `MAX_PERSISTED_OBSERVATION_CHARS` | 4 000（履歴 / UI） |

適用成功後の観測には `VERIFY_AFTER_APPLY_NUDGE` が付き、モデルに `verify` を促す。

---

## 6. 書き込みとパッチ

### 6.1 提案（Main — ループ一時停止）

1. JSON 引数のパース / 修復（`agent-propose-actions`）
2. 途中切れの不完全 JSON で復元アクションなし → エラー観測のみ（プレビューしない）
3. `normalizeWorkspaceActions` → `previewWorkspaceActions`
4. `ai:needApproval` + `ai:step`（承認待ち）
5. `waitForApproval(callId)` でツールループをブロック（`agent-approval.ts` の Map）

### 6.2 適用（Renderer → Main FS）

1. ChatPanel / store が Edit と同じプレビュー UI を表示
2. ユーザー Apply → `fs.applyActions`
3. Main がアクションを実体化。**`applyPatch`** はディスク上の原文に `applyUnifiedDiff`（`src/utils/apply-patch.ts`）を当ててから `writeFile` 相当で保存
4. 成功 → `ai:resolveApproval({ approved: true, detail })` → ループ再開
5. 却下 → `approved: false` → ループ継続（再提案可）
6. 適用失敗 → プレビュー残置。**Agent に修正させる** で失敗観測を返し再提案可能に
7. 部分適用/却下でキューが空 → 適用/却下の detail で承認を resolve

既存ファイルの編集は全置換の `writeFile` より **`applyPatch`**（`@@` hunk の unified diff）が推奨。Cursor 風の `*** Begin Patch` ラッパーはパッチ util 側で除去される。

---

## 7. 承認と Continue

`agent-approval.ts` は call/continue id をキーにした 2 つの Map:

| 一時停止 | Main → UI | UI → Main |
|----------|-----------|-----------|
| ファイル変更 | `ai:needApproval` | `ai:resolveApproval` |
| 危険な exec | `ai:needExecApproval` | `ai:resolveApproval` |
| ターン/ツール予算 | `ai:needContinue` | `ai:resolveContinue` |

Continue = yes: 予算加算し **plan + memory** を user メッセージとして再注入（`injectOrientationAfterContinue`）。Continue = no: `ai:done`。

---

## 8. IPC イベント一覧

### Main → Renderer

| チャネル | 用途 |
|----------|------|
| `ai:chunk` | アシスタント文字差分 |
| `ai:step` | 高水準ラベル（thinking、承認待ちなど） |
| `ai:toolStart` | ツール名 + マスク済み引数 |
| `ai:toolResult` | ok / summary / 切り詰め観測 |
| `ai:needApproval` | ワークスペース変更プレビュー |
| `ai:needExecApproval` | 危険コマンド承認 |
| `ai:needContinue` | 予算超過 |
| `ai:done` / `ai:error` / `ai:aborted` | 終端 |

### Renderer → Main

| チャネル | 用途 |
|----------|------|
| `ai:chat` | ラン開始 |
| `ai:cancel` | 中断 |
| `ai:resolveApproval` | ファイル / exec の可否 |
| `ai:resolveContinue` | 予算延長の可否 |

---

## 9. ターン・フォローアップでの文脈保持

| 仕組み | 役割 |
|--------|------|
| アシスタントの `agentSteps` | タイムライン + 履歴永続化 |
| 過去ツール文脈 | フォローアップで観測要約を再注入（`buildPriorAgentContext`） |
| Plan（`updateTodo` / `checkpoint`） | チェックリスト + 再開メモ。履歴から再構築、Continue 時に再注入 |
| Memory（`remember` + 自動観測） | 耐久メモ。履歴から再構築 |
| Read キャッシュ | 同一ラン内のフル再読込を抑制 |

引数・観測中のシークレットは `redactSecrets` / `redactSecretsInArgs` でマスク。

---

## 10. モジュール対応表

```
electron/services/
  agent-runner.ts           # runAgent、ツール schema、ターンループ、read/list/search/propose
  agent-approval.ts         # 承認・続行の wait / resolve
  agent-propose-actions.ts  # JSON パース / 修復 / 不完全検出
  agent-exec.ts             # deny-list シェル、リスク分類
  agent-verify.ts           # test/lint/typecheck
  agent-plan.ts             # todos + checkpoint
  agent-memory.ts           # remember + 観測キャプチャ
  agent-read-cache.ts       # ラン内 readFile キャッシュ
  agent-paths.ts            # ワークスペース相対パス正規化
  ai-client.ts              # AbortController、ヘッダ、buildUserMessage、Ask/Edit
  filesystem.ts             # preview / apply / applyPatch 実体化
  workspace-search.ts       # search 実装

src/
  components/ChatPanel.tsx
  components/AgentStepTimeline.tsx
  stores/app-store.ts       # プレビュー適用/却下、承認 resolve
  utils/apply-patch.ts
  utils/workspace-actions.ts
  utils/agent-tools.ts      # tools 非対応エラー codec
  utils/redact.ts
```

---

## 11. メッセージフロー（概要）

```
┌─ Renderer (ChatPanel) ──────────────────────────┐
│  mode=agent で送信                               │
│  chunk / tool* / step / approval / done を購読   │
│  agentSteps → タイムライン + 履歴                │
└────────────────────┬────────────────────────────┘
                     │ ai:chat
┌────────────────────▼────────────────────────────┐
│  Main: runAgent                                  │
│  ┌─ ターンループ ──────────────────────────────┐ │
│  │  streamAgentTurn (LLM SSE)                  │ │
│  │  tool_calls → 実行 / proposeActions         │ │
│  │  proposeActions / 危険 exec / 予算 ────┐    │ │
│  │                                        ▼    │ │
│  │                               waitFor* Map  │ │
│  └─────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────┘
                     │ ai:needApproval
┌────────────────────▼────────────────────────────┐
│  プレビュー UI（Edit と同じ）                    │
│  apply → fs.applyActions → resolveApproval(true) │
│  却下 / 修正依頼 → resolve → ループ継続          │
└─────────────────────────────────────────────────┘
```

---

## 12. 関連ドキュメント

| ドキュメント | 用途 |
|--------------|------|
| [AGENT_PLAN.md](./AGENT_PLAN.md) | Phase 0–4 出荷記録と後続ロードマップ |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | プロセス / IPC 全体像 |
| [SPEC.md](./SPEC.md) | Ask / Edit / Agent の製品境界 |
| [USE_CASE_PRESET.md](./USE_CASE_PRESET.md) | 用途プリセット（モードとは別軸） |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 日常開発で触る場所 |
