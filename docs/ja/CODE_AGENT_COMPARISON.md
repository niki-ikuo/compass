# コード用途 Agent 比較：Compass 対 Cursor

[English](../CODE_AGENT_COMPARISON.md) | **日本語**

**Compass Agent（用途プリセット `code`）** と **Cursor IDE / Desktop の Agent** の能力インベントリ。

作業指示用のギャップリストではない。差を埋める作業は [AGENT_CODEGEN_PLAN.md](./AGENT_CODEGEN_PLAN.md) のフェーズを引用する。ランタイムの動き: [AGENT.md](./AGENT.md)。用途とモードの直交: [USE_CASE_PRESET.md](./USE_CASE_PRESET.md)。

**比較時点:** Compass 2.5.9 Agent（`preset: code`）対 Cursor Agent 公開ドキュメント（2026-08）。モデル重みと Cursor 非公開システムプロンプトは対象外。

**根拠:** Compass は `electron/services/agent-runner.ts` の `AGENT_TOOLS` とランタイム定数。Cursor は Agent overview / tools / run-modes / cloud / MCP。

---

## 1. 結論

コード生成の**コア**（探す → 置換する → 診断する → 短いコマンド）は追いついた。まだ負けるのは仕事を**完走させる周辺**（Plan / Debug、サブエージェント、MCP、ブラウザ検証、PR、クラウド、Skills）と**書く速度**。Compass が勝つのは意図した結果で、承認ゲート、砂場、シークレットマスク、BYOK、Office 抽出、Windows のローカル無人ジョブ。

同じ仕事を同じ手数・同じ規模のリファクタで完走できる、とは**まだ言えない**。速度と自律度なら Cursor。レビューとローカル主権なら Compass。仕様書は先に「Cursor 互換が目的ではない」と書いてある。

| 件数 | 判定 |
|------|------|
| 24 | Cursorが上 |
| 8 | Compassが上 |
| 11 | 実用上は同等 |
| 4 | 設計が違う（勝ち負けではない） |
| **47** | **合計** |

「Cursorが上」は Compass の欠陥とは限らない。製品の重心が違う。「同等」はコード生成計画 Phase 1–7 を出荷した範囲。

### 用途「コード」が実際に変えるもの

プリセットは**役割**であり、別ランタイムではない。`code` で変わるのは:

- システムロール: コーディングアシスタント。コード・依存関係・`.compass` 索引を重視
- `verify` がプロジェクトの test / lint / typecheck を回す
- `profileData` / `queryData` は**出ない**（`data` 用途のみ）

ツール名、予算、承認ゲートは `general` と同じ。Cursor はコーディング Agent 製品。Compass はフォルダ作業アプリにコーディング役割を挿げたもの。

---

## 2. 表の読み方

| ラベル | 意味 |
|--------|------|
| **Cursorが上** | この時点のコーディング作業として Cursor が強い |
| **Compassが上** | Compass が強い。多くは設計上の選択 |
| **実用上は同等** | 同じクラスのコーディング作業なら足りる |
| **設計が違う** | トレードオフ。順位ではない |

---

## 3. 実務での意味

### まだ負ける作業（Cursor）

- 大きな木や複数リポジトリを並列で探索する
- ブラウザを操作して UI を検証する
- GitHub PR を切って CI を追う
- 計装付きデバッグ（仮説 → ログ → 再現 → 修正）
- 社内 MCP / Linear / 独自ツールを Agent から叩く
- 実行を止めずに方針を差し込む

### コード用途でも Compass を選ぶ理由

- ディスクに書く前に差分を見る（削除は必ず人手）
- API キーとモデルを自分で持つ。製品サブスクに縛られない
- パスはワークスペース内。秘密は観測から消す
- 同じフォルダの仕様 PDF / xlsx を参照しながら実装する
- Windows タスクスケジューラでローカル無人 Agent
- 小さな修正は Agent を回さず **Edit** で済む

---

## 4. 位置づけ

ここを誤ると後の表の読み方が全部歪む。比較対象は **コード専用 IDE の中核** 対 **フォルダ作業アプリのコード用途**。

| 項目 | Cursor Agent | Compass Agent（コード） | 判定 |
|------|--------------|-------------------------|------|
| 製品の中心 | Cursor 自体が coding agent。エディタはその実行面 | ローカルフォルダ向け AI ワークスペース。Agent は Ask / Edit と並ぶ一モード。コードは4用途のうち1つ | 設計が違う |
| 用途コードが変えるもの | 全部がコード向け。ツールも UI もモデルもコーディング前提 | 役割プロンプトと `verify`（test/lint/typecheck）。ツール集合は `general` と同じ。data 専用ツールは出ない | Cursorが上 |
| 実行面 | Desktop / Agents Window / CLI / Cloud / Web / iOS / Slack・GitHub・Linear | Windows の Electron アプリ。同一マシンの headless スケジュールあり。CLI・クラウド・モバイルなし | Cursorが上 |
| 課金とモデル供給 | サブスク前提。Composer / Grok など自前 agentic モデル。外部モデルも載る | アプリはローカル。LLM は BYOK の OpenAI 互換。自前モデルもルーターも無い。tools 非対応（Ollama 等）は Agent 非表示 | 設計が違う |
| IDE 基盤 | VS Code フォーク。LSP・デバッガ・拡張・マルチルートがそのまま使える | Monaco を載せた独自シェル。拡張エコシステムなし。言語サーバは同梱しない | Cursorが上 |

---

## 5. モードと隣接機能

Agent 単体ではなく、コーディング作業の入口が何本あるか。

| 項目 | Cursor Agent | Compass Agent（コード） | 判定 |
|------|--------------|-------------------------|------|
| 対話モード | Agent / Ask / Plan / Debug。Plan は調査して計画ファイルを作り、承認後に実装。Debug は計装→再現→ピンポイント修正 | Ask（書かない）/ Edit（1ターン提案）/ Agent（ツールループ）。Plan・Debug は無い。`updateTodo` が代用 | Cursorが上 |
| Edit 相当 | Inline Edit（Cmd+K）は選択範囲の1ショット。ルールは効かない | Edit モードはプレビュー付きの複数ファイル提案。ツールループなし。単純修正には過剰な Agent を使わずに済む | Compassが上 |
| インライン補完（Tab） | 複数行・複数ファイル予測、ジャンプ。課金理由の一つ | ゴーストテキストはある。一時停止後に提案、Tab 確定。クロスファイル予測は無い | Cursorが上 |
| 実行中の介入 | follow-up をキュー、即時注入、Stop、Steer。会話を消さず方針転換 | キャンセル（`ai:cancel`）。実行中のキューや途中注入は無い。終わるか止めるか | Cursorが上 |

---

## 6. 探す・読む

2.5 でコア契約は埋まった。差はエンジンの厚みと、コード以外の読み。

| 項目 | Cursor Agent | Compass Agent（コード） | 判定 |
|------|--------------|-------------------------|------|
| 識別子・正規表現検索 | Grep / Instant Grep。regex、glob、種別、前後行、件数、files_with_matches | `search`。`useRegex`、include/exclude glob、`wholeWord`、前後行 0–8、最大 200 件。バックエンドは JS 正規表現で rg ではない | 実用上は同等 |
| ファイル名検索 | Glob。`**/*.test.ts` を一発 | `globFiles`。同じ用途。ignore 遵守、最大 200。`listDir` は1階層のまま（glob で足りる） | 実用上は同等 |
| 意味検索 | コードベース索引のセマンティック検索。Grep と併用 | `searchMeaning`。ハイブリッド embeddings、パス・見出し・スニペット。最大 30。文書の「どこ？」には強い | 実用上は同等 |
| ソース読み取り | Read。行番号、offset/limit、並列、画像も渡せる | `readFile`。1始まり行番号、offset/limit、Markdown は `heading`、約 200KB、実行内キャッシュ。並列読取あり | 実用上は同等 |
| 画像 | ファイル Read でビジョン入力。生成ツールもある | ユーザー添付は予算上最大2枚・base64 約75KB。Agent の `readFile` は画像をビジョンにしない | Cursorが上 |
| PDF / Office | コード IDE としては弱い。抽出は主戦場ではない | PDF / docx / xlsx を抽出テキストで読める。コード用途でも仕様書・表を参照できる | Compassが上 |

---

## 7. 直す・ディスクへ書く

生成契約は揃った。残る差は「いつ書くか」と「失敗から戻るか」。

| 項目 | Cursor Agent | Compass Agent（コード） | 判定 |
|------|--------------|-------------------------|------|
| 既存ファイル | StrReplace（完全一致）。失敗したら読み直して別文字列 | `strReplace`（完全一致。`replaceAll` 以外は一意）。1呼び出し1パス。`proposeActions` / `applyPatch` は非推奨で残置 | 実用上は同等 |
| 新規・削除・mkdir | Write / Delete。ファイル単位 | `writeFile` / `deleteFile` / `deleteDir` / `mkdir`。ファイル単位。削除は自動適用しない | 実用上は同等 |
| ディスクへ書く時点 | ツール実行時に即書き。差分は事後レビュー。reject 可。デフォルトが速い | プレビュー承認が既定。`autoApplyAgentWrites` で即適用も可。削除・機密パスは人手。コーディング速度は落ちる | 設計が違う |
| 巻き戻し | 大きな変更前のチェックポイント。ファイルだけ戻す。Git とは別。会話は残る | 適用 Undo とエディタ Undo。Agent 実行単位のスナップショット復元は無い | Cursorが上 |
| Markdown 章置換 | StrReplace で代用 | `replaceSection`。コード用途ではほぼ使わないが、README 改稿では正しい | Compassが上 |

---

## 8. 回す・確かめる

コード用途の勝負所。ここが薄いと「直したつもり」で終わる。

| 項目 | Cursor Agent | Compass Agent（コード） | 判定 |
|------|--------------|-------------------------|------|
| シェル | 長時間、バックグラウンド、出力監視、並列。Run Mode で承認。macOS/Linux に砂場。Windows 砂場は公式に弱い | `exec`。既定 60s / 最大 300s、出力 20万字、非対話。ユーザー PTY と分離。バックグラウンド無し | Cursorが上 |
| 危険コマンド | Allowlist / Auto-review 分類器。誤分類しうる。`.cursorignore` はシェルを止めない | deny-list で OS 破壊・ワークスペース全消しを拒否。書き込み系とネットは承認。Windows でも同じ規則 | Compassが上 |
| 触ったファイルの診断 | ReadLints。LSP 診断を広く拾える | `readLints`。変更ファイルの TypeScript / ESLint。LSP サーバは同梱しない。言語が外れると空 | Cursorが上 |
| テスト / lint / 型一括 | Shell で `npm test` 等。失敗ログを読んで直す。専用ツールではない | `verify`。package scripts またはフォールバック。コーディング完了前に呼ぶ契約。無いとスキップして最終回答で触れない | 実用上は同等 |
| ランタイムデバッグ | Debug モード。仮説→計装ログ→ユーザー再現→証拠で直す | 無い。ログを `exec` で出すか、ユーザーに再現させるしかない | Cursorが上 |

---

## 9. Git / PR

読めることと、マージ可能な PR まで出すことは別。

| 項目 | Cursor Agent | Compass Agent（コード） | 判定 |
|------|--------------|-------------------------|------|
| 状態の読み取り | status / diff / ブランチ差分を文脈やツールで取る | `gitStatus` / `gitDiff`。ユーザーペイロードに dirty の短い要約。専用ツールは読み取り専用 | 実用上は同等 |
| commit / push | シェル + UI。コミットメッセージ生成、attribution。Agents Window から commit / PR | Git パネルは status/diff/stage/commit/push/pull/ブランチ。Agent ツールからは書けない。`exec` の `git commit` は deny-list 対象外（設計の穴） | Cursorが上 |
| PR / GitHub | `gh`、GitHub App、split-to-prs、babysit、Cloud がブランチを切って PR | PR 作成も GitHub 認証も無い。ヘルプに未対応と書いてある | Cursorが上 |
| レビュー自動化 | Agent Review、Bugbot、Security Agents、マージコンフリクトをチャットで解消 | 無い | Cursorが上 |

---

## 10. 外を見る

現行 API を引けるか、ブラウザで検証できるか、社内ツールに届くか。

| 項目 | Cursor Agent | Compass Agent（コード） | 判定 |
|------|--------------|-------------------------|------|
| Web 検索 / 取得 | WebSearch / Fetch。専用バックエンド。Auto-review 対象 | `webSearch` は DuckDuckGo HTML、最大 8 件、12s。`fetchUrl` は GET、15s、8万字、プライベートホスト拒否。動くが薄い | Cursorが上 |
| MCP | stdio / SSE / HTTP、OAuth、Apps。GitHub / Linear / ブラウザ等を動的ツール化 | 未対応（SPEC v3.0）。接続 UI も無い | Cursorが上 |
| ブラウザ操作 | ナビ・クリック・入力・スクショ・コンソール。Design Mode。Cloud は computer use | ブラウザタブはある。Agent は操作できない。UI 変更の検証は人の目 | Cursorが上 |
| 会話検索 | Agent が過去チャットを自分で検索 | ワークスペースの `chat-history.json`。Agent からの検索ツールは無い | Cursorが上 |

---

## 11. 文脈・ルール

モデルが毎回ゼロから賢くなるわけではない。何を自動で渡すか。

| 項目 | Cursor Agent | Compass Agent（コード） | 判定 |
|------|--------------|-------------------------|------|
| 永続指示 | Project / User / Team rules、ネスト `AGENTS.md`、Skills、Plugins、Commands。チーム enforce 可 | `.compass/instructions.md` の Role / Rules / Terms。1ファイル。ネストも glob も Skills も無い | Cursorが上 |
| @ 参照 | ファイル、フォルダ、Terminals、Chats、Git diffs、Browser | エクスプローラー指定と `@[path]`。端末出力・ブラウザ DOM・ブランチ diff の @ は無い | Cursorが上 |
| 自動添付 | 開いているファイル、最近見たファイル、索引 | 現在ファイル（約30k tok）、選択、開いているエディタパス、`.compass` 索引抜粋。最近見たファイル一覧は弱い | 実用上は同等 |
| 長期記憶 | IDE Agent 用 Memories は公式に薄い。Automations 側にはある。Rules が本体 | `remember` / `checkpoint` は会話内の作業メモリ。Continue 向け。学習型の横断記憶ではない | 実用上は同等 |
| 履歴のツール結果 | 実観測を残し、満杯近くで要約。コンテキストリングで内訳表示 | 過去ステップは1本の要約。永続観測 4000 字。長い Agent 会話は先に劣化する | Cursorが上 |

---

## 12. ループ・並列・リモート

中規模リファクタが「調査だけで予算切れ」しないか、大規模が並列で終わるか。

| 項目 | Cursor Agent | Compass Agent（コード） | 判定 |
|------|--------------|-------------------------|------|
| 基本ループ | model → tools → observation。ツール回数の公式上限なし | 同じ形。初期 32 ターン / 80 ツール。Continue で +16 / +50。nudge（計画・未完了 todo・未提案）がターンを食う | Cursorが上 |
| 同一ターンの並列 | 独立 I/O を同時。サブエージェントも並列 | 読取系（read/search/glob/git/lints）は並列。書き込みと `exec` は直列・ゲート | 実用上は同等 |
| サブエージェント | Explore / Bash / Browser + カスタム。worktree、best-of-n、クラウド handoff | 単一ループのみ。計画書でも後回し | Cursorが上 |
| コンテキスト窓 | モデルにより 200k–300k、一部 1M | 入力予算 約180k tok（chars÷3）。モデルの公称窓を使い切らない | Cursorが上 |
| クラウド / 無人 | 隔離 VM、PR、CI 修復、Automations、`/loop` `/goal` | Windows タスクスケジューラでローカル headless Agent。VM も GitHub 起動も無い。**ローカル**無人では先行 | 設計が違う |

---

## 13. 安全・運用

コーディング速度と引き換えに何を守っているか。ここは Compass が意図的に勝っている。

| 項目 | Cursor Agent | Compass Agent（コード） | 判定 |
|------|--------------|-------------------------|------|
| パス砂場 | プロジェクト中心。シェルと MCP は ignore を越えられる | パスはワークスペース内。機密パスの読取拒否 | Compassが上 |
| シークレット | ルールと分類器。ツール結果のマスクはまちまち | 引数と観測を `redactSecrets`。Web 取得にもマスク | Compassが上 |
| 書き込みの既定 | 実質デフォルト書き込み。速い。誤変更の回収はチェックポイントと reject | 既定は人間が差分を見る。自動適用は設定。削除は必ず人手 | Compassが上 |
| プロバイダ事故 | 自前ランタイムなので tools 非対応は稀 | tools 非対応なら Agent を出さない。Edit へ誘導。BYOK では必須 | Compassが上 |

---

## 14. 残差の性質

| 種類 | 内容 |
|------|------|
| **2.5 で埋まった差** | regex 検索、glob、`strReplace`、行番号 Read、`readLints`、git 読取、`webSearch` / `fetchUrl`、読取並列、予算 32/80。以前の「ツールが無くて先に壊れる」は解消済み。[AGENT_CODEGEN_PLAN.md](./AGENT_CODEGEN_PLAN.md) の Phase 1–7 は **完了**。同文書の付録 A は 2.5 以前の表面を記述しているので、現行比較としては使わない。 |
| **意図して埋めない差** | 即ディスク書き込みを既定にしない。承認ゲート、deny-list、BYOK、Ask / Edit / Agent 分離。SPEC: Cursor の複製が目的ではない。 |
| **まだ製品差** | MCP、サブエージェント、Plan / Debug、ブラウザ検証、PR、Cloud、Skills、実行中キュー、ファイルチェックポイント。コード生成計画の「後続」に並んでいるものが、いまの負け筋。 |

この表は **同じコーディング作業を任せたときの実効能力**。文書・データ用途での Compass の強みは加点しない。

---

## 15. 関連ドキュメント

| ドキュメント | 用途 |
|--------------|------|
| [AGENT.md](./AGENT.md) | ツールループの実際の動き |
| [AGENT_CODEGEN_PLAN.md](./AGENT_CODEGEN_PLAN.md) | コード生成差を埋める作業のフェーズ指定 |
| [USE_CASE_PRESET.md](./USE_CASE_PRESET.md) | `code` と `general` / `document` / `data` |
| [SPEC.md](./SPEC.md) | Cursor との製品境界、実装済み / 後回し |
| [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) | 承認ゲート、マスク、exec 方針 |
