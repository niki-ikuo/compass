---
title: Git / GitHub
keywords:
  - GitHub
  - Git
  - コミット
  - 差分
  - status
  - Issue
  - PR
  - リポジトリ
category: integrations
related:
  - ../getting-started/open-project.md
  - ../ai/chat.md
  - mcp.md
---

# Git / GitHub

## Compass 内の Git（status / diff / commit）

左サイドバーの **Git** タブ（`Ctrl+Shift+G`）、またはステータスバーのブランチ名から開けます。

できること:

- 変更 / ステージ済み / 未追跡ファイルの一覧
- ファイルの差分表示
- ステージ / ステージ解除
- メッセージ付きコミット

**PATH 上の `git`**（例: Git for Windows）と、すでに Git リポジトリになっているフォルダ（`git init` または clone）が必要です。

[AI 適用の取り消し](../ai/chat.md) とは別物です。Undo は `.compass/ai-undo/` のバックアップを戻すだけで、Git コミットは作りません。

## まだないもの

- push / pull / fetch
- ブランチ作成・切り替え UI
- GitHub 認証、Issue、Pull Request
- MCP

これらは統合ターミナルや外部の Git クライアントを使ってください。

## 関連

- [プロジェクトを開く](../getting-started/open-project.md)
- [AIチャット](../ai/chat.md)
- [MCP](mcp.md)
- [FAQ](../troubleshooting/faq.md)
