---
title: プロジェクトを開く
keywords:
  - フォルダ
  - ワークスペース
  - プロジェクト
  - 開く
  - ファイルツリー
  - .compass
category: getting-started
related:
  - welcome.md
  - ai-provider.md
  - ../ai/chat.md
  - ../ai/agent.md
commands:
  - Open Folder
---

# プロジェクトを開く

Compass では「プロジェクト」＝開いたローカルフォルダ（ワークスペース）です。

## 開き方

1. メニュー **ファイル** → **フォルダを開く**
2. 作業したいフォルダを選ぶ
3. 左にファイルツリーが表示される

## 何ができる？

- ファイルを開いて編集・保存
- ツリーから新規作成（テンプレート含む）
- AI に今のファイルや選択範囲を渡して質問・編集
- Agent でワークスペース内の複数ファイルを扱う（要フォルダ）

## `.compass` フォルダ

ワークスペース直下に `.compass/` ができることがあります。

| 中身の例 | 用途 |
|----------|------|
| 構造索引 | AI コンテキスト用のファイル一覧など |
| `chat-history.json` | チャット履歴の永続化 |
| `templates/` | 文書テンプレート（任意） |

通常は手動で触る必要はありません。

## よくある質問

**Q. Agent で「フォルダを開いてください」と言われる**  
A. Agent はワークスペース必須です。先にフォルダを開いてください → [Agent](../ai/agent.md)

**Q. `node_modules` や `.git` が見えない**  
A. ツリーでは非表示です。意図した挙動です。

## 関連

- [はじめに](welcome.md)
- [AIプロバイダー設定](ai-provider.md)
- [AIチャット](../ai/chat.md)
- [Agent](../ai/agent.md)
