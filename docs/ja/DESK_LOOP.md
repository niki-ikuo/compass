# クリップ（Clip）— S級4機能 仕様

[English](../DESK_LOOP.md) | **日本語**

状態: **Phase 1 実装済み**（Capture / Clip / Outbox 4プリセット / Ship Check Stage A + コピー）。Stage B・トレイ常駐などは未着手。関連: [SPEC.md](./SPEC.md)、[ARCHITECTURE.md](./ARCHITECTURE.md)、[TEXT_WORKSPACE_PLAN.md](./TEXT_WORKSPACE_PLAN.md)、[AI_APPLY_UNDO.md](./AI_APPLY_UNDO.md)、[USE_CASE_PRESET.md](./USE_CASE_PRESET.md)。

Compass を「書いて直すエディタ」から **「取って → 整理して → 検品して → 出す作業台」** に引き上げるための機能セット。  
4機能は別製品ではない。**1本の導線の4駅**として設計・実装する。

---

## 0. 結論（先に読む）

| 問い | 答え |
|------|------|
| 何を作るか？ | 取込ホットキー / クリップ / 下書き工場 / 検品ゲート |
| 一本の体験は？ | 外部テキスト → inbox → 下書き(outbox) → 検品 → コピー |
| 書き込み経路は？ | 原則既存の preview → Apply（自動黙殺書き込みを増やさない） |
| クラウド同期は？ | **作らない**。ローカル `.compass/` 規約のみ |
| MCP・メーラー送信は？ | 本仕様の範囲外（後続） |
| 2週間で出すなら？ | §11 の Phase 1。本ドキュメントは Phase 1〜2 の完全仕様 |

---

## 1. 目的と非目的

### 1.1 目的

1. **入口を一つにする** — Word / メーラー / ブラウザ等からテキストを Compass に落とせる
2. **机を一つにする** — inbox / outbox が一覧できる
3. **出口を型にする** — メール・議事録・報告・チャット投稿の下書きが同じ手順で残る
4. **出す前に止める** — 秘密情報・未確定・用語ゆれをコピー前に見せる

### 1.2 非目的（本仕様全体）

- アプリ内 Office 編集、PDF 書き出し、印刷ダイアログ
- クラウド同期、複数人リアルタイム共同編集
- Outlook / Gmail への実送信、COM 自動化
- MCP サーバーホスト、拡張マーケット
- 音声会議の文字起こし
- ワークスペース全体のバックアップ＆リストア製品化
- Cursor 互換の Agent 自動化拡大（承認ゲートは維持）
- 週次ダイジェスト（再開コスト削減のための要約生成）。本仕様の範囲外（削除済み）

---

## 2. 統合体験（必須導線）

```
[外部アプリ] テキスト選択 → コピー
        ↓ グローバルホットキー
[.compass/inbox/*.md] 着地・前面化
        ↓ クリップ or エディタ
[下書き工場] プリセット選択 → AI 提案 → ユーザー Apply
        ↓
[.compass/outbox/*.md] status: draft
        ↓ 検品してコピー
[クリップボード] ＋ status: ready（コピー成功で自動更新）
        ↓ 随時
[クリップ] inbox 処理済み / outbox 一覧
```

**受け入れのデモ脚本（製品 DoD）:**

1. 外部で文章をコピーする  
2. ホットキーで inbox に着地する  
3. 「メール下書き」で outbox にファイルができる（Apply 承認あり）  
4. 検品が TBD 等を指摘し、本文をコピーできる  
5. クリップで inbox を処理済みにでき、outbox が見える  

所要の目安: 熟練ユーザーで **3分以内**。

---

## 3. 共通データ契約

### 3.1 ディレクトリ規約

ワークスペースルート直下（既存 `.compass/` に相乗り）:

```text
.compass/
  inbox/                 # 取込された生テキスト
    done/                # 処理済み（削除せず移動）
  outbox/                # 外向け下書き
  templates/             # 既存。出口プリセット雛形を追加可
  rules.md               # 既存
  glossary.md            # 既存（任意）
  desk/                  # クリップメタ（任意）
    settings.json        # ホットキー以外の机ローカル設定
```

初回: ワークスペースオープン時、またはクリップ／取込／下書きのいずれかの初回利用時に不足ディレクトリを作成する。

### 3.2 Frontmatter 共通

すべての机ファイルは YAML frontmatter を持つ。`kind` で種別を判別する。

| kind | 配置 | 必須フィールド |
|------|------|----------------|
| `inbox` | `.compass/inbox/` | `capturedAt`（ISO8601）, `source` |
| `outbox` | `.compass/outbox/` | `preset`, `status`, `createdAt` |

パーサは既存 Markdown frontmatter 慣習に合わせる。不正・欠落時は一覧では「不明」扱いし、本文は通常 Markdown として開く（クラッシュしない）。

### 3.3 索引・検索ポリシー

| パス | キーワード/意味検索 | AI 自動文脈 |
|------|---------------------|-------------|
| `inbox/`, `outbox/` | **含める** | 通常どおり（サイズ上限遵守） |
| `inbox/done/` | 含める（低優先でも可） | 含めてよい |
| `ai-undo/`, 索引 JSON, chat-history 等 | 既存どおり除外 | 除外 |

### 3.4 設定の置き場

| 項目 | 置き場 |
|------|--------|
| グローバルホットキー | アプリ設定（`settings` / ユーザー設定）。ワークスペース非依存 |
| 検品の LLM 利用 ON/OFF | アプリ設定（既定 ON でも、失敗時はルールのみで続行） |
| クリップの表示件数など | `.compass/desk/settings.json`（任意。無くても既定値） |

API キーを inbox/outbox 本文に書かない。検品がそれを検出する（§7）。

### 3.5 i18n

UI 文字列は既存 `src/i18n/messages.ts` 経由。日本語 / 英語の両方を同時追加する。

---

## 4. 機能① 取り込みホットキー（Capture）

### 4.1 概要

| 項目 | 内容 |
|------|------|
| ID | `desk.capture` |
| 目的 | 外部アプリのテキストを、コピペ地獄なしで inbox に落とす |
| 優先度 | S（導線の起点） |

### 4.2 ユーザーストーリー

- 利用者として、メーラーやブラウザで選んだ文をホットキー一発で Compass の inbox に残したい。  
- 利用者として、フォルダを開いていないときに誤って消えないよう、失敗を明示してほしい。

### 4.3 機能要件

1. Compass プロセス起動中、OS グローバルショートカットを登録する。  
2. 既定ショートカット: `Ctrl+Alt+I`（Windows）。設定画面で変更・無効化できる。  
3. 発火時:
   1. `clipboard.readText()` でテキスト取得  
   2. 空または空白のみ → 通知「コピーしたテキストがありません」で終了  
   3. ワークスペース未オープン → 通知「先にフォルダを開いてください」で終了  
   4. ファイル名: `YYYYMMDD-HHMMSS.md`（同一秒の衝突時は `-2`, `-3`…）  
   5. パス: `{workspace}/.compass/inbox/{name}`  
   6. 内容:

```markdown
---
kind: inbox
capturedAt: 2026-07-28T09:00:00+09:00
source: clipboard
---

{クリップボード本文}
```

   7. ウィンドウを前面化（focus）し、作成ファイルをエディタで開く。設定で「クリップを開く」も選択可（既定はファイルを開く）。  
4. 画像・ファイルのホットキー取込は **対象外**（既存のチャット／エディタへのペーストを案内）。  
5. アプリ終了時にショートカットを unregister。  
6. 登録失敗（他アプリと衝突）時は設定にエラー表示し、代替キーを促す。

### 4.4 UI

- **設定:** 「クリップ」セクション — ショートカット録音 UI、有効/無効、着地後の動作（ファイルを開く / クリップを開く）  
- **通知:** OS 通知またはアプリ内トースト（既存パターンに合わせる）  
- **エクスプローラー:** `.compass/inbox` は通常ツリーに見える（隠しすぎない）

### 4.5 IPC / Main

| チャネル | 方向 | 内容 |
|----------|------|------|
| `desk:captureClipboard` | invoke | 上記保存処理。Renderer / ショートカット両方から可 |
| `desk:getCaptureSettings` / `desk:setCaptureSettings` | invoke | ホットキー文字列・有効フラグ・着地後動作 |
| （Main）`globalShortcut.register` | — | 設定変更のたびに張り直し |

Renderer は直接 `clipboard` / `globalShortcut` を触らない（既存セキュリティモデル遵守）。

### 4.6 エッジケース

| ケース | 挙動 |
|--------|------|
| 巨大クリップボード（例: > 1MB 文字） | 拒否または先頭 N 文字＋警告。既定上限 **512 KiB** 文字相当 |
| `.compass/inbox` 作成失敗 | エラー通知。クラッシュしない |
| 連続連打 | 1.5s デバウンス、または都度別ファイル（既定: **都度別ファイル**、連打はユーザー責任） |

### 4.7 受け入れ基準

- [ ] メモ帳でコピー → ホットキー → inbox に md ができ、前面で開く  
- [ ] ワークスペース無しで安全に失敗する  
- [ ] 空クリップボードでファイルを作らない  
- [ ] 設定でホットキー無効にすると発火しない  

### 4.8 非目的（本機能）

- アプリ未起動時の常駐フック専用プロセス（Phase 2 候補: トレイ常駐）  
- 選択テキストの Win32 直接取得（クリップボード経由で足りる）  
- ブラウザ拡張 / 「共有」ターゲット  

---

## 5. 機能② クリップパネル（Clip）

### 5.1 概要

| 項目 | 内容 |
|------|------|
| ID | `desk.workbench` |
| 目的 | inbox / outbox を一画面で見渡し、処理する |
| 優先度 | S（司令塔） |

### 5.2 ユーザーストーリー

- 利用者として、今やるべき取込と、外に出す前の下書きを同じ場所で見たい。  
- 利用者として、inbox を消さずに「処理済み」へ退けたい。

### 5.3 機能要件

1. 左サイドバーに **クリップ** タブ（またはビュー）を追加する。アイコンは既存トーンに合わせ、ダッシュボード化しすぎない。  
2. 画面構成は **2セクションのみ**（初期）:

| セクション | データ源 | 行に出す情報 | 操作 |
|------------|----------|--------------|------|
| Inbox | `.compass/inbox/*.md`（`done/` 除外） | ファイル名、`capturedAt`、本文先頭40字 | 開く / **下書き…** / 処理済み / 削除 |
| Outbox | `.compass/outbox/*.md` | ファイル名、`preset`、`status`、`subject` or 先頭見出し | 開く / 検品してコピー |

3. 一覧上限: 各 **20件**（新しい順）。「フォルダをエクスプローラーで開く」リンクで全件へ。  
4. **処理済み:** ファイルを `.compass/inbox/done/` へ `fs.move`（同名時は后缀）。Undo は通常のファイル操作／必要なら AI Undo 対象外（手動 move）。  
5. 空状態: 各セクションに1行ヘルプ（取込ホットキー、下書きの作り方）。  
6. ワークスペース未オープン時はプレースホルダのみ。  
7. ファイル監視: 既存 watcher があれば inbox/outbox 変更で一覧更新。無ければフォーカス時リフレッシュで可（Phase 1）。

### 5.4 UI 制約（デザイン）

- カード乱立・統計ストリップ・マルチカラム看板は禁止。  
- **リスト＋短いメタ** の一枚構成。  
- ブランド／製品名をクリップヒーローで押し潰さない（既存シェル内ビュー）。

### 5.5 IPC

| チャネル | 内容 |
|----------|------|
| `desk:listInbox` | `{ path, capturedAt, snippet, relativePath }[]` |
| `desk:listOutbox` | `{ path, preset, status, subject, snippet, relativePath }[]` |
| `desk:markInboxDone` | inbox → done へ move |
| `desk:deleteInbox` | inbox ファイルを完全削除（`done/` は対象外） |
| `desk:ensureDirs` | 規約ディレクトリ作成 |

Frontmatter パースは Main 側ユーティリティに集約（`desk-frontmatter.ts` 想定）。

### 5.6 受け入れ基準

- [ ] 2セクションが表示され、クリックでファイルが開く  
- [ ] 処理済みで inbox から消え、`done/` に存在する  
- [ ] 空状態でも次の行動が分かる  
- [ ] outbox 行から検品（§7）を起動できる  

### 5.7 非目的（本機能）

- カスタムセクション編集 UI  
- カンバン、担当者、期限フィールドの本格タスク管理  
- メール未返信の自動推定  

---

## 6. 機能③ 下書き工場（Outbox Factory）

### 6.1 概要

| 項目 | 内容 |
|------|------|
| ID | `desk.outboxFactory` |
| 目的 | 出口の型を固定し、下書きを outbox に残す |
| 優先度 | S（価値の顔） |

### 6.2 ユーザーストーリー

- 利用者として、inbox のメモからメール下書きを、決まった形で outbox に残したい。  
- 利用者として、AI が勝手にディスクへ書かず、プレビュー承認したい。

### 6.3 プリセット（固定4つ）

| preset | ラベル（ja） | 出力ファイル名例 | 本文構成 |
|--------|--------------|------------------|----------|
| `mail` | メール | `mail-YYYYMMDD-HHMMSS.md`（衝突時 `-2`, `-3`…） | frontmatter `to`/`subject` + 本文 |
| `minutes` | 議事録 | `minutes-YYYYMMDD-HHMMSS.md`（同上） | 決定 / TODO / 共有事項 |
| `report` | 報告 | `report-YYYYMMDD-HHMMSS.md`（同上） | 背景 / 現状 / 提案 |
| `chat` | チャット投稿 | `chat-YYYYMMDD-HHMMSS.md`（同上） | 短文・箇条書き可 |

プリセットの追加 UI は Phase 1 では作らない。テンプレ上書きは `.compass/templates/` の既存仕組みで **中身の雛形のみ** 変更可（ID は上記固定）。

### 6.4 Outbox ファイル形式

```markdown
---
kind: outbox
preset: mail
status: draft          # draft | ready | archived
to: ""
subject: ""
sourcePath: ".compass/inbox/20260728-090000.md"   # 任意
createdAt: 2026-07-28T09:05:00+09:00
updatedAt: 2026-07-28T09:05:00+09:00
---

本文…
```

| status | 意味 |
|--------|------|
| `draft` | 作成直後〜編集中 |
| `ready` | 検品コピー済み（外に出した／提出可） |
| `archived` | クリップの既定一覧から隠す（ファイルは残す） |

### 6.5 起動 UI

1. コマンドパレット / チャットヘッダ / クリップ: **下書きを作る…**  
2. プリセット選択（4択）  
3. 文脈:
   - 優先: 現在のエディタファイル（inbox や任意 md）  
   - なければ: ユーザーがチャットに書いた指示のみ  
4. モード: 用途が `document` でなければ、確認のうえ `document` を推奨（強制はしない）  
5. 生成経路（いずれか一方を実装の正とする）:

**正（推奨）:** Edit モード相当の内部リクエスト、または Agent `proposeActions` で `writeFile` を1件提案 → 既存プレビュー UI → ユーザー Apply。

システム／ユーザプロンプトに含めるもの:

- 選択プリセットの出力スキーマ（frontmatter 必須キー）  
- 出力パス（`.compass/outbox/...`）  
- ソース本文（サイズ上限で切詰め）  
- `.compass/rules.md` / `glossary.md`（既存添付ロジック）

### 6.6 テンプレート

内蔵または `.compass/templates/` に以下を追加:

- `outbox-mail.md`
- `outbox-minutes.md`
- `outbox-report.md`
- `outbox-chat.md`

frontmatter: `label`, `fileName` パターン, `order`。AI へのヒントを本文コメントまたは別フィールドで持ってよい。

### 6.7 受け入れ基準

- [ ] 4プリセットいずれも Apply 後に outbox へ1ファイルできる  
- [ ] frontmatter に `kind/preset/status/createdAt` がある  
- [ ] 自動で Apply されない（プレビュー必須）  
- [ ] クリップ Outbox に即座またはリフレッシュ後に見える  

### 6.8 非目的（本機能）

- mailto / Outlook 下書き作成  
- docx/HTML 書き出し  
- プリセット数のユーザー増減 UI  
- 送信済みメールとのスレッド同期  

---

## 7. 機能④ 検品ゲート（Ship Check）

### 7.1 概要

| 項目 | 内容 |
|------|------|
| ID | `desk.shipCheck` |
| 目的 | 外に出す直前の品質・漏洩ゲート |
| 優先度 | S（信頼） |

### 7.2 ユーザーストーリー

- 利用者として、コピーする前に TBD や API キーが残っていないか知りたい。  
- 利用者として、指摘があっても自己責任でコピーを続けたい。

### 7.3 起動条件

- Outbox ファイルがアクティブ、またはクリップ Outbox 行の **検品してコピー**  
- 任意 Markdown でもコマンドから実行可（Phase 1 は outbox 優先、汎用は Phase 2）

### 7.4 検品パイプライン

```
入力テキスト（＋ frontmatter）
    → Stage A: ローカル規則（必須・同期）
    → Stage B: LLM レビュー（任意・設定で OFF 可）
    → 結果パネル
    → コピー / キャンセル / それでもコピー
```

#### Stage A（必須）

| ルール ID | 内容 | 重大度 |
|-----------|------|--------|
| `tbd_markers` | `TODO` / `TBD` / `要確認` / `FIXME` / `xxx`（単語境界配慮） | warning |
| `secret_pattern` | `api[_-]?key`, `secret`, `Bearer `, `sk-` 風、長い Base64/Hex | error |
| `glossary_mismatch` | `.compass/glossary.md` があるとき、禁止語・推奨語の簡易違反（既存 document verify と共有可能な粒度） | warning |
| `empty_body` | 本文が実質空 | error |
| `mail_missing_subject` | preset=mail かつ subject 空 | warning |

Stage A は LLM 不要。1秒以内を目標。

#### Stage B（任意）

- Ask 相当の短リクエスト。ツール呼び出しなし。  
- 指示: 問題点の箇条書きのみ。修正文・全文書き直しは禁止。  
- タイムアウト / API エラー時は Stage A 結果だけで続行（サイレント成功扱いにしない。B 失敗を1行表示）。

### 7.5 結果 UI

- パネル名: **提出前チェック**  
- 一覧: 重大度アイコン、ルール ID または LLM 項目、該当箇所の抜粋（可能なら）  
- アクション:
  - **本文をコピー** — findings が error / warning 0 件ならそのまま  
  - **それでもコピー** — error または warning が残っているとき表示。確認ダイアログ後にコピー  
  - **閉じる**

### 7.6 コピーペイロード

| preset | クリップボード内容 |
|--------|-------------------|
| `mail` | 1行目 `Subject: {subject}`、空行、本文（frontmatter 除外）。`to` があれば先頭に `To: {to}` |
| その他 | frontmatter を除いた Markdown 本文 |

コピー成功後: `status` を **`ready` に自動更新**する（`archived` は変更しない）。検品は中身（TBD・秘密情報など）を見、status は「出した」ラベルとして使う。

### 7.7 IPC

| チャネル | 内容 |
|----------|------|
| `desk:runShipCheck` | `{ path }` → `{ findings: ShipFinding[], stageBStatus }` |
| `desk:copyOutboxPayload` | frontmatter 除去＋preset 整形して clipboard へ（Main または preload 経由） |

```ts
type ShipFinding = {
  id: string
  severity: 'error' | 'warning' | 'info'
  message: string
  source: 'rule' | 'llm'
  excerpt?: string
}
```

### 7.8 受け入れ基準

- [ ] TBD 入り outbox で必ず `tbd_markers` が出る  
- [ ] 疑似 API キー文字列で `secret_pattern` が出る  
- [ ] コピー内容に YAML frontmatter が含まれない  
- [ ] Stage B オフまたは失敗でも Stage A だけでコピー可能  
- [ ] 自動 Apply で本文を書き換えない（指摘のみ）  

### 7.9 非目的（本機能）

- 指摘のワンクリック自動修正 Apply（Phase 2 候補）  
- DLP 製品レベルの完全性  
- 送信・共有リンク発行  

---

## 8. 型（共有ドラフト）

```ts
/** .compass/desk/settings.json */
type DeskWorkspaceSettings = {
  openAfterCapture?: 'file' | 'desk'
  outboxListIncludeArchived?: boolean
}

type DeskCaptureAppSettings = {
  enabled: boolean
  accelerator: string // Electron accelerator
  openAfterCapture: 'file' | 'desk'
}

type InboxDocMeta = {
  kind: 'inbox'
  capturedAt: string
  source: 'clipboard' | 'import' | 'unknown'
}

type OutboxDocMeta = {
  kind: 'outbox'
  preset: 'mail' | 'minutes' | 'report' | 'chat'
  status: 'draft' | 'ready' | 'archived'
  to?: string
  subject?: string
  sourcePath?: string
  createdAt: string
  updatedAt?: string
}

type ShipFinding = {
  id: string
  severity: 'error' | 'warning' | 'info'
  message: string
  source: 'rule' | 'llm'
  excerpt?: string
}
```

実装時は `src/types` に正式配置する。

---

## 9. アーキテクチャ配置

```
electron/services/
  desk-dirs.ts          # 規約ディレクトリ ensure
  desk-frontmatter.ts   # 読み書き・一覧用パース
  desk-capture.ts       # クリップボード保存
  desk-ship-check.ts    # Stage A 規則
electron/main.ts        # globalShortcut + IPC 登録
electron/preload.ts     # window.compass.desk.*

src/components/
  DeskPanel.tsx         # クリップ2セクション
  ShipCheckPanel.tsx    # 検品結果
src/utils/
  outbox-copy.ts        # ペイロード整形（Main 寄せでも可）
  desk-presets.ts       # 4プリセット定義
```

権限モデル: ファイル I/O・ショートカット・clipboard 書き込みは **Main のみ**。Renderer は `window.compass.desk`。

AI 書き込みは既存 `previewActions` / `applyActions` / AI Undo に載せる。机専用の黙殺 write IPC を新設しない。

---

## 10. セキュリティ / プライバシー

1. ホットキー取込内容はローカルディスクのみ。外部送信しない（ユーザーが AI チャットに載せる場合を除く）。  
2. 検品 Stage B はユーザーが明示実行したときのみ LLM へ本文を送る。  
3. `secret_pattern` はベストエフォート。見逃しをゼロと謳わない（ヘルプに明記）。  
4. 通知に本文全文を載せない（「inbox に保存しました」程度）。  

---

## 11. フェーズ分割

### Phase 1（2週間・出荷最小）

必須: Capture / Desk 一覧 / Outbox 4プリセット / Ship Check Stage A + コピー。  
切り捨て可: Stage B、ホットキー変更 UI（既定キーのみでも可）、トレイ常駐、汎用 md 検品。

### Phase 2

- 検品の指摘 → 修正提案（preview）  
- トレイ常駐＋未起動時の取込キュー  
- outbox → `.eml` 生成または mailto の改善  
- inbox 一括「下書き化」ウィザード  

### Phase 3（本仕様外への接続）

- MCP で外部 API  
- Outlook 下書き（送信なし）  
- PDF/docx 書き出しを出口プリセットに追加  

---

## 12. ヘルプ / ドキュメント更新（実装時）

| 成果物 | 内容 |
|--------|------|
| `helps/ja/getting-started/desk-loop.md`（新規） | 利用者向け一本道 |
| `helps/en/...` | 英語版 |
| [SPEC.md](./SPEC.md) | 機能一覧にクリップループを1行追加 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | `.compass/inbox|outbox` と `desk:*` IPC |

---

## 13. テスト方針

| 領域 | テスト |
|------|--------|
| frontmatter パース | 単体（欠落・不正・BOM） |
| Stage A 規則 | 単体（TBD、密钥、空本文、mail subject） |
| outbox コピー整形 | 単体（mail の Subject 行、frontmatter 除去） |
| capture ファイル名衝突 | 単体 |
| クリップ一覧 | コンポーネント or サービス結合 |

E2E はデモ脚本の手動チェックリストを Phase 1 のリリースゲートとする。

---

## 14. 機能別要件トレース

| 機能 | 章 | Phase 1 必須 |
|------|----|--------------|
| ① 取り込みホットキー | §4 | はい |
| ② クリップ | §5 | はい |
| ③ 下書き工場 | §6 | はい |
| ④ 検品ゲート | §7 | Stage A + コピー |

---

## 15. オープン質問（実装前に決める）

| # | 質問 | 推奨デフォルト |
|---|------|----------------|
| Q1 | ホットキー既定の最終決定 | `Ctrl+Alt+I` |
| Q2 | コピー後に `status: ready` を自動更新するか | **する**（draft→ready。archived は維持） |
| Q3 | クリップを左タブにするかコマンドのみか | 左タブ（発見性優先） |
| Q4 | 下書き生成を Edit 固定か Agent 可か | Edit 相当の単発提案（tools 不要モデルでも動く） |

---

## 改訂履歴

| 日付 | 内容 |
|------|------|
| 2026-07-28 | 週次ダイジェストを範囲外として削除。S級4機能に再構成 |
| 2026-07-28 | 初版。S級5機能の統合仕様 |
