---
title: AIチャット
keywords:
  - AI
  - Chat
  - Ask
  - Edit
  - チャット
  - ストリーミング
  - 用途プリセット
  - 差分
  - Apply
category: ai
related:
  - agent.md
  - ../getting-started/ai-provider.md
  - ../getting-started/open-project.md
  - ../troubleshooting/common-errors.md
commands:
  - Open Settings
  - Focus Chat
---

# AIチャット

右パネルのチャットで、今のファイルや選択範囲を踏まえて AI に聞けます。

## 何ができる？

| モード | できること | ファイル変更 |
|--------|------------|--------------|
| **Ask** | 説明・質問・整理 | しない |
| **Edit** | 変更案を出す | プレビュー → あなたが適用 |
| **Agent** | ツールで読み取り・提案・（制限付き）実行 | 同上（詳細は [Agent](agent.md)） |

Ask / Edit / Agent とは別に、用途プリセット（一般 / 文書 / データ / コード）があります。話し方・方針の軸です。

## 開き方

1. [AIを設定](../getting-started/ai-provider.md)する
2. （推奨）[フォルダを開く](../getting-started/open-project.md)
3. 右のチャットに入力して送信

## 使い方

- **Enter** … 送信
- **Shift+Enter** … 改行
- 開いているファイル全文と、選択中のテキストがあればそれもコンテキストに載ります
- 応答はストリーミング表示
- 履歴はワークスペースの `.compass/chat-history.json` に残ります

### Edit の適用

1. AI が変更を提案する
2. 差分プレビュー（追加＝緑、削除＝赤）を確認
3. **適用** または拒否

自動では書き込みません。

## よくある質問

**Q. 何も返ってこない / エラー**  
A. [よくあるエラー](../troubleshooting/common-errors.md) を確認。まずは API Key とモデル。

**Q. Agent と Edit の違いは？**  
A. Edit は1回の応答で提案。Agent は読み取りやコマンドを挟みながら複数ステップ → [Agent](agent.md)

## 関連

- [Agent](agent.md)
- [AIプロバイダー設定](../getting-started/ai-provider.md)
- [プロジェクトを開く](../getting-started/open-project.md)
- [FAQ](../troubleshooting/faq.md)
