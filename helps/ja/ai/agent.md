---
title: Agent
keywords:
  - Agent
  - ツール
  - proposeActions
  - exec
  - 承認
  - tools
  - Ollama
  - データ
  - profileData
  - queryData
  - 文書
category: ai
related:
  - chat.md
  - ../getting-started/ai-provider.md
  - ../getting-started/open-project.md
  - ../troubleshooting/common-errors.md
commands:
  - Open Settings
  - Open Folder
  - Focus Chat
---

# Agent

Agent は「長い Edit」ではありません。モデルがツールを呼び、結果を見て、また考えるループです。書き込みは必ずプレビュー承認のあとです。

## 何ができる？

- ワークスペース内のファイルを読んで調べる（Markdown は見出し単位でも読める）
- 変更案をまとめて提案（あなたが適用）
- 制限付きのコマンド実行（実行前に承認が必要なものあり）
- 計画・メモリを使いながらの複数ターン作業
- 用途が **文書** のとき: 編集後の構成チェック（見出し・相対リンク）
- 用途が **データ** のとき: CSV / TSV / JSON の列プロファイルと、取込テーブルへの読み取り専用クエリ

## 前提

1. [フォルダを開いている](../getting-started/open-project.md)こと（必須）
2. tools 対応のプロバイダ／モデルであること
3. チャットモードを **Agent** にする

### Agent が使えない場合

| 状況 | 結果 |
|------|------|
| Ollama | Agent 非表示（Ask / Edit のみ） |
| tools 非対応のモデル / プロバイダ | Agent 非表示、または **Edit** で再送する案内 |
| フォルダ未オープン | 「フォルダを開いてください」 |

## 使い方

1. チャットで **Agent** を選ぶ
2. 必要なら用途プリセットを選ぶ（文書向けは **文書**、表向けは **データ**）
3. やりたいことを具体的に書く（例:「このフォルダの README を現状に合わせて直して」）
4. ステップ表示（思考・ツール・承認待ち）を見る
5. 変更提案やコマンド実行の承認を出す／拒否する
6. 必要なら続行、またはキャンセル

## 覚えておくこと

- 書き込みは自動適用しない（Edit と同じプレビュー）
- パスは開いているワークスペース内に閉じる
- Agent の `exec` は短い子プロセス用で、下の統合ターミナルとは別物
- ターン数・ツール回数に上限がある（続行確認が出ることがある）
- `profileData` / `queryData` は用途が **データ** のときだけ使える（クエリは読み取り専用）

## よくある質問

**Q. Ollama で Agent したい**  
A. 現状できません。Edit を使うか、OpenAI / Gemini など tools 対応へ切り替えてください → [AI設定](../getting-started/ai-provider.md)

**Q. 途中で止まった**  
A. 承認待ちか、上限到達の続行待ちのことがあります。キャンセルもできます。

**Q. CSV を Agent で調べたい**  
A. 用途を **データ** にして依頼してください（例:「sales.csv をプロファイルして欠損率をまとめて」）。列の調査や読み取り専用クエリは、ファイル変更の承認前に行えます。

## 関連

- [AIチャット](chat.md)
- [AIプロバイダー設定](../getting-started/ai-provider.md)
- [よくあるエラー](../troubleshooting/common-errors.md)
- [MCP](../integrations/mcp.md)（未対応）
