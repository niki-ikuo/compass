---
title: FAQ
keywords:
  - FAQ
  - よくある質問
  - ショートカット
  - 保存
  - 履歴
  - 用途
  - Claude
  - 表示言語
  - 英語
  - 日本語
  - Language
category: troubleshooting
related:
  - common-errors.md
  - ../getting-started/welcome.md
  - ../ai/chat.md
  - ../ai/agent.md
---

# FAQ

## Compass は何のソフト？

ローカルフォルダ向けの AI ワークスペースです。VS Code 互換のエディタでテキストを編集しながら、Ask / Edit / Agent で AI と進めます。→ [はじめに](../getting-started/welcome.md)

## Cursor や VS Code の置き換え？

目的が違います。Compass は「フォルダを開いてテキストと AI で書く」ことに絞っています。拡張エコシステムや GitHub 連携はまだありません。

## Claude は使える？

専用の「Claude」プロバイダはありません。**OpenRouter** などで Anthropic モデルを選ぶ方法が現実的です。→ [AI設定](../getting-started/ai-provider.md)

## 英語と日本語の切り替えは？

**設定 → 表示言語** で `日本語` / `English` を選びます。UI・ヘルプ記事・AIヘルプの回答言語がこれに合わせます。ヘルプを開いたまま切り替えた場合も、記事側はすぐ差し替わります。

## 自動保存はある？

ありません。明示的に保存してください。未保存のエディタタブを閉じるときや、アプリを終了するときは保存確認が出ます。

## チャット履歴はどこ？

開いているワークスペースの `.compass/chat-history.json` です。

## Ask / Edit / Agent と「一般・文書・データ・コード」の違いは？

- Ask / Edit / Agent … **どう動くか**（読むだけ / 提案 / ツールループ）
- 用途プリセット … **どんな役で話すか**

両方ともチャットまわりで選べます。→ [AIチャット](../ai/chat.md)

## ファイル横断で検索したい

左サイドバーの **検索** タブを開きます（フォルダ必須）。→ [検索](../getting-started/search.md)

## GitHub や MCP は？

未対応です。→ [GitHub](../integrations/github.md) / [MCP](../integrations/mcp.md)

## エラーが出る

先に [よくあるエラー](common-errors.md) を見てください。

## 関連

- [よくあるエラー](common-errors.md)
- [はじめに](../getting-started/welcome.md)
- [目次](../index.md)
