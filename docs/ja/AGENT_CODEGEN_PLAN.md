# Agent コード生成計画

[English](../AGENT_CODEGEN_PLAN.md) | **日本語**

Compass Agent と Cursor Agent の **コード生成** 差を埋めるための指示用ドキュメント。作業を渡すときはフェーズ範囲を引用する。次フェーズは、今のフェーズの **完了条件** を満たしてから。

この文書の Phase **1–7** は作業指示用のスライスである。[AGENT_PLAN.md](./AGENT_PLAN.md) の v2.0 Phase 1–4（出荷済み）とは番号が別。

現行ランタイム: [AGENT.md](./AGENT.md)。v2.0 出荷済みフェーズ: [AGENT_PLAN.md](./AGENT_PLAN.md)。製品境界: [SPEC.md](./SPEC.md)。

**比較時点:** Compass 2.2.x Agent（Phase 0–4 出荷済み）対 Cursor IDE エージェントの公開ツール面。モデル重みと Cursor 内部プロンプトは対象外。

---

## 作業の渡し方

「Cursor と同じにして」とは言わない。下のいずれかで指示する。

| 指示 | 意味 | フェーズ |
|------|------|----------|
| **Phase 1 だけ** | ファイルと識別子を探す | 1 |
| **Phase 2 まで** | 探す + 1 ファイル単位の編集 | 1–2 |
| **必須** | 中規模のコード変更がループで完走できる | 1–6 |
| **必須 + やる** | 必須にランタイム磨き | 1–7 |
| **Phase N** | そのスライスだけ（前提フェーズは出荷済みであること） | N |

ルール:

1. フェーズ順に実装する。N の **完了条件** が満たされるまで N+1 に入らない。
2. 各フェーズは **やる / このフェーズではやらない / 完了条件 / 触る場所** を持つ。「やらない」は「今はやらない」であり「永久禁止」ではない（§この計画ではやらない、は計画全体の外）。
3. §制約を守る。Cursor の「承認なしで即ディスク」だけを真似しない。
4. `applyPatch` 修復・propose JSON 復旧・nudge 文言を厚くしない。弱いツールの対症療法。

---

## 制約（守る）

1. ツールと FS は **Main のみ**。Renderer は `window.compass` のみ。
2. パスは開いているワークスペース内（`resolveInsideWorkspace`）。
3. 書き込みは現行のプレビュー / 適用 / Undo（`autoApplyAgentWrites` 含む）。**承認ゲートは残す**。変えるのは生成契約（ファイル単位ツール）であり、安全モデルではない。
4. `replaceSection`、`searchMeaning`、`profileData` / `queryData`、文書/データ light verify、シークレットマスク、機密パス拒否、exec deny-list は残す。
5. Ask / Edit / Agent は分離のまま。用途プリセットは直交のまま。この計画は、後続フェーズが明示しない限り Edit の `compass-actions` を書き換えない。
6. OpenAI 互換 `tools` API。tools 非対応プロバイダでは Agent を出し続けない。

---

## この計画ではやらない

| 項目 | 理由 |
|------|------|
| MCP / プラグイン / 非 OpenAI ネイティブ API | SPEC v3.0。必須の後。 |
| サブエージェント（`Task`） | Grep / Glob が無いと無意味。 |
| ブラウザ自動操作 | UI 検証は後。タブは既にある。 |
| Plan / Debug モード | `updateTodo` で足りる。 |
| Skills / `.cursor/rules` の複製 | `instructions.md` で足りる。 |
| ripgrep バイナリ同梱 | `workspace-search.ts` が既に regex / glob を持つ。 |
| `applyPatch` のさらなる寛容パース | プリミティブが間違い。 |
| proposeActions JSON の復旧強化 | 書き込みをファイル単位に分ける。 |
| `remember` / `checkpoint` / nudge の高度化 | 対症療法。 |
| Agent からの commit / push、GitHub PR | Phase 5 は git 読み取りのみ。 |
| Composer 相当の自前モデル | BYOK のまま。 |

---

## フェーズ

状態: Phase 1–7（必須 + やる）**完了**。

### Phase 1 — 探す

**指示:** 「Phase 1 だけ」、または必須の最初のスライス。

検索パネルが既に持っている能力を Agent に出す。glob ツールを足し、`listDir` 1 階層の往復をやめる。

**やる**

- [x] Agent `search`: `useRegex`、`include` / `exclude` glob、`caseSensitive`、任意で `wholeWord`、前後行、上限引き上げ（30 件では足りない。files-with-matches 要約も可）。
- [x] 新ツール `globFiles({ pattern, path? })` — ワークスペース相対、ignore 遵守、件数上限（例: 200）。
- [x] システムプロンプト / `ai.agentModeReminder`: 識別子は `search`、パスパターンは `globFiles`、意味は `searchMeaning`。

**このフェーズではやらない**

- 検索パネル UI の変更
- `searchMeaning` の置換・弱体化
- ripgrep 同梱
- 再帰 `listDir`（glob で足りる）

**完了条件:** Agent が regex で `export function foo` を見つけ、`**/*.test.ts` を列挙し、パス・行・スニペットを返す。`listDir` を 10 回繰り返さない。

**触る場所:** `electron/services/agent-runner.ts`（`AGENT_TOOLS`、`executeSearch*`）、`electron/services/workspace-search.ts`、`src/i18n/messages.ts`（`ai.agentSystemPrompt`、`ai.agentModeReminder`）、テスト。

**依存:** なし。

---

### Phase 2 — 編集プリミティブ

**指示:** Phase 1 完了後に「Phase 2 まで」。

「unified diff を 1 つの JSON バッチに詰める」を、ファイル単位ツールに替える。プレビュー / 適用 / Undo は残す。

**やる**

- [x] ツール: `strReplace({ path, oldString, newString, replaceAll? })`、`writeFile({ path, content })`、`deleteFile` / `deleteDir` / `mkdir` を独立呼び出し（1 呼び出し 1 パス）。
- [x] 成功した呼び出しは、現行と同じプレビュー項目として積む（`autoApplyAgentWrites` が許すときは即適用）。1 ファイルの途中切れが他ファイルの提案を消さない。
- [x] `strReplace` は完全一致（`replaceAll` 以外は `oldString` が一意）。不一致時は観測でエラー、`readFile`（force）して再試行。unified diff は使わない。
- [x] プロンプト: 既存ファイルは `strReplace`、新規・ごく短い全置換は `writeFile`、Markdown 1 章は `replaceSection`。`*** Begin Patch` 禁止。
- [x] Agent プロンプト上 `proposeActions` / `applyPatch` は非推奨。このフェーズでは互換のため残してよい。修復ロジックは増やさない。

**このフェーズではやらない**

- Edit モード `compass-actions` の書き換え
- プレビュー UI / Undo の削除
- `replaceSection` の削除
- 削除・機密パスの自動適用
- hunk の fuzzy 照合を増やす

**完了条件:** 複数ファイル変更が複数ツール呼び出しになる。1 つの `writeFile` 途中切れが残りを消さない。既存ファイル編集が `applyPatch` より `strReplace` で成功する。

**触る場所:** `agent-runner.ts`、`agent-propose-actions.ts`、`filesystem.ts` / preview apply、`src/utils/workspace-actions.ts`、ChatPanel のプレビューキュー、`ai.agentSystemPrompt`、テスト。

**依存:** Phase 1 推奨（正しい文字列を先に見つける）。指示があれば Phase 1 後すぐ。

---

### Phase 3 — 読む

**指示:** 必須の一部。担当が分かれるなら Phase 2 と並行可（スキーマ衝突に注意）。

**やる**

- [x] `readFile`: 返す本文に 1 始まりの行番号。`offset` + `limit`（行単位）。Markdown の `heading` と `force` は残す。
- [x] 省略時の案内は「offset/limit を使え」。200KB 全文ダンプだけにしない。

**このフェーズではやらない**

- 200KB 上限の引き上げを主対策にすること
- 画像を Agent ツール化（後続）
- Office / PDF 抽出器の変更

**完了条件:** 大きい `.ts` の 80–140 行だけ読め、その行番号を引用できる。

**触る場所:** `agent-runner.ts` の `executeReadFile`、`agent-read-cache.ts`、テスト。

**依存:** 厳密にはなし。Phase 1 の後がよい。

---

### Phase 4 — 触ったファイルの診断

**指示:** 必須。Phase 2 の後（適用パスが要る）。

**やる**

- [x] 適用後、または `readLints({ paths })`: **変更ファイルだけ** の診断（TypeScript / ESLint 等。リポジトリ全体の `eslint .` ではない）。
- [x] 観測は直せる形（ファイル・行・メッセージ）。次は `strReplace`。
- [x] `verify`（test/lint/typecheck スクリプト）は残す。プロンプト: 編集直後はファイル診断、コーディング完了前に `verify`。

**このフェーズではやらない**

- 文書/データ light verify の置き換え
- `verify` フルスイートの作り直し
- LSP サーバの同梱

**完了条件:** 今触ったファイルの型エラーが、テスト全実行なしでツール観測として返る。

**触る場所:** 新規（例: `agent-lints.ts`）、`agent-runner.ts`、`agent-verify.ts`（呼び出し順のみ）、プロンプト、テスト。

**依存:** Phase 2。

---

### Phase 5 — Git 読み取り

**指示:** 必須。ほぼ `electron/services/git.ts` の配線。

**やる**

- [x] Agent のユーザーペイロードに dirty の短い要約（ファイル名。フル diff を毎回載せない）。
- [x] ツール: `gitStatus`、`gitDiff({ path?, side? })` — 読み取り専用、既存の上限。
- [x] プロンプト: 進行中の変更に重ねる前に git 状態を見る。

**このフェーズではやらない**

- Agent からの `commit` / `push` / `pull` / ブランチ切替
- GitHub 認証 / PR
- Git パネルの置き換え

**完了条件:** Agent が `exec git status` なしで未ステージファイルを知り、1 ファイルの diff を取れる。

**触る場所:** `git.ts`、`ai-client.ts` の `buildUserMessagePayload`、`agent-runner.ts`、プロンプト、テスト。

**依存:** 厳密にはなし。

---

### Phase 6 — Web 読み取り

**指示:** 必須の最後。ネットワークは製品リスクなのでゲートを残す。

**やる**

- [x] `webSearch({ query })` と `fetchUrl({ url })` — GET/読取、サイズ上限、タイムアウト、シークレットマスク。
- [x] ネットワークは承認または allowlist（exec のネットワーク承認と同じ思想）。黙った外部送信は禁止。
- [x] プロンプト: 現行ライブラリ API / ドキュメント用。ページがあるのに API を捏造しない。

**このフェーズではやらない**

- MCP
- 任意 POST / 認証付きスクレイピング
- 検索エンジン API キーを必須依存にする（使うなら設定と文書）

**完了条件:** Agent がライブラリの現行シグネチャを URL 付きで引け、`exec curl` に頼らない。

**触る場所:** 新規 `agent-web.ts`（Main のみ）、`agent-runner.ts`、必要なら承認 IPC、プロンプト、テスト。

**依存:** 厳密にはなし。1–2 の後の方が、取得結果をコードに落とせる。

---

### Phase 7 — やる（ランタイム磨き）

**指示:** 「必須 + やる」、または 7a–7d を個別指定。必須（1–6）が終わる前に始めない。ただし書き込みツールが既にあるなら 7b/7a だけ先、は可。

**やる**

- [x] **7a 並列:** 同一ターンの独立読取（`readFile` / `search` / `globFiles` / `gitStatus`）を同時実行。書き込みと `exec` は直列・ゲートのまま。
- [x] **7b 予算:** 中規模リファクタが調査だけで Continue に達しないよう初期ターン/ツールを上げる。ツールが揃ったあと、計画・propose nudge の全文 LLM ラウンドを削る。
- [x] **7c exec:** テスト/ビルド向けに timeout と出力上限を上げる。deny-list と書き込み承認は残す。ユーザー PTY とは混ぜない。
- [x] **7d 文脈 / プロンプト:** 開いているエディタパスを注入。`ai.agentSystemPrompt` からパッチ儀式を削る。役割・安全・ツール名は残す。

**このフェーズではやらない**

- サブエージェント、MCP、Plan モード、監視プロセスの常駐
- Agent exec とユーザー端末の統合

**完了条件:** 典型的な複数ファイルのコーディングが Continue なしで終わる。読取は並列。システムプロンプトが unified diff の説明書ではない。

**触る場所:** `agent-runner.ts` ループと定数、`ai-client.ts` ペイロード、`messages.ts`、`agent-exec.ts` 上限、テスト。

**依存:** Phase 1–6。

---

## 後続（この計画の外）

1–7 のあと、やるならこの順: MCP → GitHub PR → サブエージェント → ブラウザ検証 → Plan モード。「必須」に混ぜない。

---

## 付録 A — 比較一覧（指示ラベル付き）

**必須** = Phase 1–6。**やる** = Phase 7。**後回し** = この計画の外。**守る** = Compass が強いので Cursor を真似しない。**やらぬ** = 投資しない。

### 探す

| 項目 | Cursor | Compass | ラベル | Phase |
|------|--------|---------|--------|-------|
| 識別子・正規表現検索 | Grep（regex / glob / 種別 / 前後行） | `search` はリテラル、最大 30、1 ファイル 5 行 | 必須 | 1 |
| ファイル名検索 | Glob `**/*.test.ts` | `listDir` 1 階層・最大 200 | 必須 | 1 |
| 意味検索 | 内部 + Grep | `searchMeaning` | 守る | — |
| 検索バックエンド | Agent から rg 相当 | UI は regex/glob 済み。Agent スキーマに無い | 必須 | 1 |

### 読む

| 項目 | Cursor | Compass | ラベル | Phase |
|------|--------|---------|--------|-------|
| ファイル読み取り | 行番号、offset/limit、並列 | 全文〜200KB、行番号なし | 必須 | 3 |
| ディレクトリ | Glob | `listDir` 1 階層 | 必須 | 1 |
| Office / PDF | 弱い | 抽出テキスト | 守る | — |
| 表データ | 読むかシェル | `profileData` / `queryData` | 守る | — |
| 画像ツール | Read で画像 | ペイロード最大 2 枚。Agent ツールではない | 後回し | — |

### 直す・適用

| 項目 | Cursor | Compass | ラベル | Phase |
|------|--------|---------|--------|-------|
| 既存ファイル | StrReplace 完全一致 | JSON 内 `applyPatch` | 必須 | 2 |
| 新規ファイル | Write、1 ファイル 1 呼出 | `actions` 配列に同梱 | 必須 | 2 |
| 複数ファイル | ファイル単位 | 1 バッチ。途中切れで全部破棄 | 必須 | 2 |
| 削除 | Delete ツール | `proposeActions` 内 | やる | 2 |
| Markdown 章 | StrReplace | `replaceSection` | 守る | — |
| ディスクへ書く時点 | ツール実行時 | プレビュー承認まで（自動適用は任意） | 必須（契約）/ 守る（ゲート） | 2 |
| プレビュー / Undo | ゲートは弱い | Edit と同じ。Undo あり | 守る | — |
| パッチ修復 | 不要 | 同一 hunk 拒否、fuzzy、writeFile フォールバック | やらぬ | — |

### 回す・確かめる

| 項目 | Cursor | Compass | ラベル | Phase |
|------|--------|---------|--------|-------|
| シェル | 長時間、バックグラウンド、並列 | 既定 30s / 最大 120s、64KB | やる | 7c |
| 危険コマンド | ポリシー | deny-list | 守る | — |
| ファイル診断 | ReadLints | なし。`verify` は scripts | 必須 | 4 |
| テスト一括 | Shell | `verify` テンプレ | やる | 7 |
| 文書/データ検証 | なし | light verify | 守る | — |

### 文脈

| 項目 | Cursor | Compass | ラベル | Phase |
|------|--------|---------|--------|-------|
| 現在ファイル / 選択 | + 最近見たファイル | 現在ファイル + 選択 | やる | 7d |
| @ 参照 | @Files 等 | エクスプローラー + `@[path]` | 守る | — |
| git 状態 | status/diff 注入 | パネルはある。Agent に乗らない | 必須 | 5 |
| ユーザー端末 | Shell 共有 | PTY と exec が別 | 後回し | — |
| ルール | `.cursor/rules`、Skills | `instructions.md` | 後回し | — |
| 構造索引 | 内部 | `.compass` + 抜粋 | 守る | — |
| 履歴のツール結果 | 実観測を残す | 1 本の要約、観測 4000 字 | やる | 7 |

### ループ

| 項目 | Cursor | Compass | ラベル | Phase |
|------|--------|---------|--------|-------|
| ループ形 | model → tools → observe | 同じ + nudge | 守る | — |
| 同一ターン並列 | 独立 I/O を同時 | `for await` 直列 | やる | 7a |
| 予算 | 中規模リファクタが通る | 16 ターン / 40 ツール。nudge が食う | やる | 7b |
| コンテキスト刈り | 長い会話に耐える | 約 180k tok、ツール対ごと削除 | 守る | — |
| サブエージェント | Task | 単一ループ | 後回し | — |
| キャンセル | 中断 | `ai:cancel` | 守る | — |
| プロバイダ | Composer + 外部 | BYOK。Ollama は Agent 非表示 | 守る | — |

### 外

| 項目 | Cursor | Compass | ラベル | Phase |
|------|--------|---------|--------|-------|
| Web 検索 / 取得 | WebSearch / WebFetch | なし | 必須 | 6 |
| MCP | 動的ツール | SPEC v3.0 未着手 | 後回し | — |
| GitHub / PR | gh + MCP | パネルに commit/push。PR なし。Agent から呼べない | 後回し | — |
| ブラウザ操作 | あり | タブはある。Agent は操作できない | 後回し | — |

### 計画・プロンプト

| 項目 | Cursor | Compass | ラベル | Phase |
|------|--------|---------|--------|-------|
| チェックリスト | TodoWrite | `updateTodo` 上限 8 | 守る | — |
| checkpoint / remember | 不要 | 予算ワークアラウンド | やらぬ | — |
| モード | Agent / Plan / Debug / Ask | Ask / Edit / Agent + プリセット | 守る | — |
| Plan モード | 設計専用 | todo nudge のみ | 後回し | — |
| システムプロンプト | 運用ルール。契約はツール側 | パッチ儀式の説明書 | やる | 7d |
| nudge | ほぼ無し | 計画 / propose / open-todo | やらぬ | 7b で削る |

### 安全・運用

| 項目 | Cursor | Compass | ラベル | Phase |
|------|--------|---------|--------|-------|
| 砂場 | プロジェクト中心。Shell は広い | ワークスペース内。機密拒否 | 守る | — |
| シークレット | まちまち | `redactSecrets` | 守る | — |
| 自動適用 | 実質デフォルト書き込み | 設定。削除・機密は人手 | 守る | — |
| スケジュール | Cloud agents | Windows headless | 守る | — |
| tools 非対応 UX | 稀 | Agent 非表示 + Edit フォールバック | 守る | — |

---

## 付録 B — 実装順（一行）

1. 探す（regex + glob）→ 2. ファイル単位 strReplace/write → 3. 行番号付き read → 4. 触ったファイルの診断 → 5. git 読み取り → 6. Web 読み取り → 7. 並列 / 予算 / exec / プロンプト。

スライスが 1 つだけなら **Phase 1**。コードを実際に当てたいなら **Phase 2 まで**。Cursor 級のコーディングループが欲しいなら **必須（1–6）**。
