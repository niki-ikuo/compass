# テキストワークスペース — 開発計画

[English](../TEXT_WORKSPACE_PLAN.md) | **日本語**

v2.0 以降の実装順。対象は **ローカルのあらゆるテキスト**。Cursor 対抗ではない。

関連: [SPEC.md](./SPEC.md)、[USE_CASE_PRESET.md](./USE_CASE_PRESET.md)、[AI_APPLY_UNDO.md](./AI_APPLY_UNDO.md)、[ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## ルール

1. この順番で作る。N が使える状態になるまで N+1 に着手しない。
2. 作らない: LSP、デバッガ、Composer パリティ、拡張マーケット、アプリ内 Office 編集、クラウド同期。
3. code プリセットは維持する。優先度は決めない。

---

## 今やること（チェックリスト）

### 1. ワークスペーステキスト検索（v2.1）

フォルダ内テキストの意味検索 / ハイブリッド検索を出す。

- [x] Markdown の見出し + 短い章要約を `.compass/` に索引
- [x] ワークスペーステキストをチャンク化（ignore 遵守）
- [x] ローカル埋め込み、またはキーワード + 埋め込みのハイブリッド検索
- [x] 左 Search: クエリ → パス + 見出し + スニペット → 見出し位置で開く
- [x] Agent ツール: `searchMeaning`（または `search` 拡張）で引用を返す
- [x] Ask/Agent が、毎回 `@` しなくても「X はどこ？」に答える

**完了:** `notes/` + `docs/` 混在で、全部開かずに正しい箇所に辿り着く。

**主な変更箇所:** `electron/services/project-indexer.ts`、workspace search IPC、`LeftSidebar` Search、`electron/services/agent-*.ts`。

---

### 2. 文書編集

`document` を最強の用途にする。

- [x] ワークスペースアウトライン: 全 Markdown 見出し、ファイル+見出しへジャンプ
- [x] 章単位編集: 見出し配下だけ提案 / 適用
- [x] 散文向け Diff（ノイズを畳む、見出し文脈を出す）
- [x] 文書 verify 強化: 重複見出し、壊れた `.md` リンク、基本的な用語チェック

**完了:** 手順書を章単位で書き換えられ、他の章を壊さずに適用できる。

**主な変更箇所:** LeftSidebar Outline、`index:getOutline`、`replaceSection` action、`DocumentDiffContent`、`.compass/glossary.md` 用語 verify。

**依存:** 横断アウトライン用データは (1) と共有してよい。

---

### 3. PDF / Office / 画像 → テキスト

バイナリはアプリ内編集しない。テキストとして使えるようにする。

- [x] PDF テキストを (1) の索引へ入れる
- [x] 抽出が安定する Office（`.docx` + `.xlsx`。無理な形式はスキップ）
- [x] 抽出テキストの検索 / @メンション
- [x] 「Markdown に要約」→ プレビュー → 適用（サイドカーまたは新規ファイル）
- [x] 本物の編集は「既定アプリで開く」のまま

**完了:** PDF + Markdown（+ 表計算テキスト）フォルダをコピペなしで質問・要約できる。

**主な変更箇所:** `extractable-document.ts` / `docx-text.ts` / `xlsx-text.ts`、`project-indexer`、chat 文脈・Agent `readFile`・keyword 検索、Explorer / PDF ビューアの「Markdown に要約」。

**依存:** (1)。

---

### 4. 人が使える Apply 履歴

出荷済み Change Set の上に積む（[AI_APPLY_UNDO.md](./AI_APPLY_UNDO.md)）。

- [x] タイムライン: いつ / どのチャットメッセージ / どのファイル
- [x] タイムラインからワンクリック Undo（「直前」だけに頼らない）
- [x] 任意で「変更要約を `.md` に保存」

**完了:** Git なしメモフォルダでの誤 Apply を、ターミナルなし・1分以内に直せる。

**主な変更箇所:** `AiApplyHistoryPanel`、`ai-undo` 連鎖 Undo、`messageId` 紐づけ、`.compass/apply-summaries/`。

---

### 5. ワークスペースルール

- [x] 人が編集できる `.compass/rules.md`（用語集は任意）
- [x] Ask / Edit / Agent に自動添付（コンテキスト予算を守る）
- [x] ルールを開いて編集する簡単な UI

**完了:** 次回セッションで、長いプロンプト再貼り付けなしにトーン / 用語が効く。

**主な変更箇所:** `workspace-rules`（Main + Renderer）、`buildUserMessagePayload`、ファイルメニュー / チャットヘッダ、`.compass/glossary.md` 任意添付。

---

### 6. データ結果をフォルダに残す

- [x] 複数 CSV/JSON への質問
- [x] 「結果を Markdown/CSV に保存」→ プレビュー → 適用
- [x] そのノートから前回クエリを再実行

**完了:** データへの答えが、元ファイルの横のファイルとして残る。

**主な変更箇所:** `data-result`（サイドカー / frontmatter）、Explorer「データについて聞く」「結果を保存」、`.result.md` から再実行、`ai.preset.data` ロール、Agent `queryData.paths`。

**依存:** (1) があると楽だが、薄い第一版はなくても可。

---

## あとで（1–4 の後）

| 項目 | 時期 |
|------|------|
| MCP / プラグイン | 1–4 出荷後 |
| 最小の Git diff/commit UI | 4 だけでは足りないと分かったときだけ |
| Anthropic ネイティブ API | OpenAI 互換が実ユーザーを止めるとき |
| macOS / Linux | Windows のテキストループが固まってから |
| `.pptx` / 古い `.doc` 抽出 | PDF/docx/xlsx のあと需要があれば |
| オフライン神経埋め込みモデル | API + ハッシュでも足りないとき |

---

## 一行の順序

```
1 検索 → 2 文書編集 → 3 PDF/Office 橋渡し → 4 Apply タイムライン → 5 ルール → 6 データ保存
```

出すのは **1**、次に **2 か 3**、その次に **4**。これが最小の実用プログラム。
