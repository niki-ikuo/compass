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

- ワークスペース内のファイルを読んで調べる
- 変更案をまとめて提案（あなたが適用）
- 制限付きのコマンド実行（実行前に承認が必要なものあり）
- 計画・メモリを使いながらの複数ターン作業

## 前提

1. [フォルダを開いている](../getting-started/open-project.md)こと（必須）
2. tools 対応のプロバイダ／モデルであること
3. チャットモードを **Agent** にする

### Agent が使えない場合

| 状況 | 結果 |
|------|------|
| Ollama | Agent 非表示（Ask / Edit のみ） |
| tools 非対応モデル | エラー。Edit へ切り替えるかプロバイダ変更 |
| フォルダ未オープン | 「フォルダを開いてください」 |

## 使い方

1. チャットで **Agent** を選ぶ
2. やりたいことを具体的に書く（例:「このフォルダの README を現状に合わせて直して」）
3. ステップ表示（思考・ツール・承認待ち）を見る
4. 変更提案やコマンド実行の承認を出す／拒否する
5. 必要なら続行、またはキャンセル

## 覚えておくこと

- 書き込みは自動適用しない（Edit と同じプレビュー）
- パスは開いているワークスペース内に閉じる
- Agent の `exec` は短い子プロセス用で、下の統合ターミナルとは別物
- ターン数・ツール回数に上限がある（続行確認が出ることがある）

## よくある質問

**Q. Ollama で Agent したい**  
A. 現状できません。Edit を使うか、OpenAI / Gemini など tools 対応へ切り替えてください → [AI設定](../getting-started/ai-provider.md)

**Q. 途中で止まった**  
A. 承認待ちか、上限到達の続行待ちのことがあります。キャンセルもできます。

## 関連

- [AIチャット](chat.md)
- [AIプロバイダー設定](../getting-started/ai-provider.md)
- [よくあるエラー](../troubleshooting/common-errors.md)
- [MCP](../integrations/mcp.md)（未対応）
