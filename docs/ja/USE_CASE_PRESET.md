# 用途プリセット仕様

[English](../USE_CASE_PRESET.md) | **日本語**

Compass をローカルフォルダ向けの **AI ワークスペース**（コード専用 IDE ではなく、メモ・文書・データ・コードなどテキスト作業全般）として位置づけるための **用途プリセット**（`general` / `document` / `data` / `code`）の製品仕様です。

関連: [SPEC.md](./SPEC.md)（Ask / Edit / Agent）、[ARCHITECTURE.md](./ARCHITECTURE.md)

**実装状態:** 実装済み（チャットヘッダ UI・アプリ／ワークスペース既定・用途別 system ロール・Agent の document/data 向け light verify）

---

## 1. 目指す姿

強み（フォルダ・Ask / Edit / Agent・差分承認・ターミナル）はそのまま使い、ローカルフォルダでテキストを扱う人全般（メモ・文書・データ・コード）を対象にする。

この方針では次をやらない。

- Monaco エディタを捨てること
- 巨大なダッシュボード化
- 「なんでも屋アプリ」への全面転換
- Office 連携を前提にすること

---

## 2. 定義と直交軸

**用途プリセット**は「何の専門家として振る舞うか」を決める軸。  
**Ask / Edit / Agent**は「どう動くか」を決める軸。混ぜない。

| 軸 | 値 | 変えるもの |
|---|---|---|
| 用途 | `general` / `document` / `data` / `code` | システムプロンプトの役割・文体・優先ファイル・注意点 |
| モード | `ask` / `edit` / `agent` | 変更可否・出力形式・ツール有無 |

```
最終 system ≈ 用途レイヤ + モードレイヤ
```

UI でも同じドロップダウンに同居させない。

---

## 3. 4プリセット

| ID | UI 表示 | 向いている作業 | AI の自己認識 |
|---|---|---|---|
| `general` | 一般 | メモ整理・タスク分解・フォルダ俯瞰 | 汎用ワークスペースアシスタント |
| `document` | 文書 | 企画・議事・手順・要約・構成 | 文書編集アシスタント |
| `data` | データ | CSV / JSON / YAML の整理・説明・整形 | データ整理アシスタント |
| `code` | コード | 実装・リファクタ・レビュー | コーディングアシスタント |

**デフォルト:** `general`（AI ワークスペース向け）。アプリ／ワークスペースに保存済みの設定はそのまま維持。

### UI の並び

`general` → `document` → `data` → `code`（広い → 狭い。デフォルトを先頭）

### 表示コピー

| ID | ラベル | 説明（1行） |
|---|---|---|
| general | 一般 | メモ整理・タスク分解 |
| document | 文書 | 企画・議事・手順の推敲 |
| data | データ | CSV / JSON / YAML の整理 |
| code | コード | 実装・レビュー・リファクタ |

---

## 4. 変えること / 変えないこと

### v1 で変える

1. システムプロンプトの「役割」部分（「あなたはコーディングアシスタントです」を用途別に差し替え）
2. 優先コンテキストの指示（コード構造 / 見出し / スキーマ / フォルダ全体）
3. 回答スタイル（文書は構成、データは列・型、一般は短く整理、など）
4. UI ラベル（セレクト表示名と短い説明）

### v1 では変えない

- Ask / Edit / Agent のルーティング
- `compass-actions` / `proposeActions` の形式
- Agent ツール一覧
- `verify` の中身（test / lint / typecheck のまま）※後段で用途別化
- 索引生成ロジック本体（見出し索引は別タスク）
- `temperature` / `maxTokens`（グローバルのまま）

---

## 5. プリセット別プロンプト方針

モード側の制約（Edit なら `compass-actions` 必須、Ask なら変更禁止 等）は現状どおり残す。差し替えるのは冒頭の役割と用途ヒント。

### `code`（現状維持）

- コード・依存関係・`.compass` インデックスを重視
- 既存の `ai.*SystemPrompt` と実質同等

### `document`

- Markdown / テキストの推敲・構成・要約が主
- 見出し階層・用語の一貫・読みやすさを優先
- 変更時は差分が読みやすい小さな patch を推奨（全文書き換え回避）
- 「正しい実装」より「読者向けの明確さ」
- Ask: 構成案・要約・レビュー。Edit / Agent: `.md` 等への反映

### `data`

- CSV / JSON / YAML を構造として扱う
- 列名・型・欠損・重複・ネストの説明を優先
- 変更時はスキーマ破壊を避ける（列順・キー名の勝手な変更禁止など）
- 大きな表は要約＋代表例。必要なら対象行・キーを明示

### `general`

- フォルダ内メモ・タスク・雑多なテキスト向け
- 断定しすぎず、整理・分類・次アクションを提示
- コード / 文書 / データの専門ルールは弱め、過剰な技術用語を避ける

---

## 6. プロンプト合成

現状は `getSystemPrompt(mode)` がモード全文を返す。用途追加後のイメージ:

```
system = [
  rolePrompt(preset),   // 用途の自己認識・文体・優先対象
  modePrompt(mode),     // Ask / Edit / Agent の制約（ほぼ現状）
].join('\n\n')
```

または mode プロンプト内の役割プレースホルダを `preset` で置換。

**リマインダー**（`buildUserMessage` 末尾）:

- モードリマインダーは現状維持
- v1 の用途リマインダーは任意（短く足すなら「文書向け: 見出しを壊さない」程度）
- Agent の verify 文言は v1 では変更しない

i18n キー例: `ai.preset.code.role` / `document` / `data` / `general`（ja / en）

---

## 7. 状態・永続化

| 層 | キー | 役割 |
|---|---|---|
| 送信時 | `ChatRequest.preset` | 実際に効く値 |
| メッセージ | `ChatMessage.preset?`（user） | 履歴から復元（`mode` と同様） |
| UI | `ChatPanel` の `sendPreset` | 今の会話で選んでいる用途 |
| 設定 | `AppSettings.defaultUseCasePreset` | 新規チャット / 起動時の初期値 |
| ワークスペース | `.compass/settings.json` → `defaultUseCasePreset` | フォルダ既定。アプリ設定より優先 |

**送信時の解決順:**

1. チャット UI の現在選択
2. ワークスペース既定（`.compass/settings.json`）
3. `defaultUseCasePreset`
4. フォールバック `general`（`DEFAULT_USE_CASE_PRESET`）

**セッション切替:** そのセッションの最後の user メッセージの `preset` を復元。なければ設定デフォルト。

**途中変更:** 同じチャットで切替可。次の送信から効く（過去メッセージは書き換えない）。

**モデル切替との違い:** モデルはコンポーザ変更で設定を即保存してよい。用途の「今の選択」は会話ローカルが主で、デフォルト変更は設定画面（アプリ / ワークスペース）のみ。

### 型のイメージ

```ts
export type UseCasePreset = 'general' | 'document' | 'data' | 'code'

// ChatRequest / ChatMessage(user) に追加
preset?: UseCasePreset

// AppSettings に追加（必須、初期値 'general'）
defaultUseCasePreset: UseCasePreset

// WorkspaceSettings（.compass/settings.json）
defaultUseCasePreset?: UseCasePreset
```

---

## 8. UI 配置

### 主: チャット入力フッタ（モードの隣）

```
[履歴] [+] …
────────────────────────────────
会話…
────────────────────────────────
[ Ask / Edit / Agent ▼ ] [ 用途: 一般 ▼ ] [ モデル ▼ ]  [送信]
```

- Ask / Edit / Agent ピッカーには入れない
- 選択肢は 4 つ＋短い説明
- コンポーザ切替は会話ローカル。設定のデフォルトは変えない

### 従: SettingsDialog

- Appearance または LLM 付近に「デフォルトの用途プリセット」（アプリ）
- フォルダを開いているときは「ワークスペース既定の用途」（`.compass/settings.json`）
- （任意）「最後に使った用途を覚える」トグル  
  - ON: 送信成功時に `defaultUseCasePreset` を更新  
  - OFF: 設定値のみ

### 避けた方がよい置き方

- 設定だけ（切替が面倒でプリセットの意味が薄れる）
- Ask / Edit / Agent の選択肢に「文書」を足す（「説明のみ」と「文書向け」が混ざる）
- メニューバーの奥（発見しにくい）

---

## 9. モードとの組み合わせ

| | Ask | Edit | Agent |
|---|---|---|---|
| **code** | 説明・レビュー | パッチ提案 | 調査 → 提案 → verify |
| **document** | 要約・構成案 | `.md` 等の修正提案 | 複数資料を読んで追記・整形 |
| **data** | スキーマ説明・品質指摘 | JSON / YAML / CSV の修正 | 複数ファイル横断の整形 |
| **general** | 整理・分解 | メモファイル更新 | フォルダ俯瞰して整理提案 |

どれも承認フロー（Edit / Agent）はそのまま。用途は「何を書くか」だけ変える。

---

## 10. スコープ分割

### v1（本仕様の本体）— 出荷済み

- 型: `UseCasePreset`
- `ChatRequest` / user `ChatMessage` / `AppSettings.defaultUseCasePreset`
- コンポーザセレクト＋設定デフォルト
- プロンプトの役割差し替え（ja / en）
- 既存 `code` は現状と同等（回帰）

### v1.5 — 出荷済み

- 用途別の短い user reminder
- 「最後に使った用途を覚える」
- ワークスペース既定用途（`.compass/settings.json`）
- テンプレ（内蔵 Markdown ＋ ワークスペース `.compass/templates/`）
- Agent の document / data 向け light verify（`agent-verify-light.ts`）

### 後続（別タスクと接続）

- 文書向け索引（light verify を超える見出し・要約）
- Markdown 体験強化（プレビュー往復・見出しアウトライン・文書向け差分）
- チャット参照拡張（複数ファイルセット、画像、PDF テキスト抽出）
- MCP / プラグイン（本体はフォルダ＋承認付き AI、外部能力は拡張）

---

## 11. 受け入れ条件（v1）

1. コンポーザで 4 用途を切り替えでき、次の送信の system に反映される
2. Ask / Edit / Agent と独立に選べる（同じドロップダウンに混ざらない）
3. 新規チャットは `defaultUseCasePreset`（ワークスペース既定があればそちら）で始まる
4. セッション復元で、最後に送った用途が戻る
5. `code` ＋既存モードで、現行と実質同等の振る舞い
6. `document` で文書系の依頼をしたとき、コード前提の言い回しが減る（手動確認で可）

---

## 12. 設計判断（固定）

1. **用途 ≠ モード**（混ぜない）
2. **v1 はプロンプト＋UI＋永続化のみ**（ツール / 索引は触らない）
3. **会話中の用途はコンポーザ、初期値は設定（アプリ / ワークスペース）**
4. **未指定は `general`**（ワークスペース優先の既定。保存済み設定は維持）

---

## 13. おすすめ着手順（周辺機能含む）

用途プリセット本体のあとに効きやすい順:

1. 用途プリセット（文書 / データ / 一般）← 本仕様 v1（出荷済み）
2. Markdown 体験＋文書向け差分
3. 見出し・要約ベースの索引
4. 画像・PDF テキストの参照
5. 用途別の軽い検証とテンプレ（light verify / テンプレは出荷済み）

**追加開発なしでもすでに向いている使い方:** Markdown の企画・手順・議事の推敲（Edit / Agent）、JSON / YAML / CSV の整理、メモ置き場フォルダを開いて Ask で要約・整理。
