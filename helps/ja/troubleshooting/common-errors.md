---
title: よくあるエラー
keywords:
  - エラー
  - API
  - API Key
  - ネットワーク
  - Ollama
  - Agent
  - 接続
  - 401
  - 更新
category: troubleshooting
related:
  - faq.md
  - ../getting-started/ai-provider.md
  - ../ai/agent.md
commands:
  - Open Settings
  - Open Folder
---

# よくあるエラー

症状から直します。

## APIキーが設定されていません

**意味:** 選択中プロバイダ用の API Key が空です。

**対処:**

1. **設定** を開く
2. 正しいプロバイダを選ぶ
3. そのプロバイダの Key を入れて保存

→ [AIプロバイダー設定](../getting-started/ai-provider.md)

## API Base URL が設定されていません

**意味:** カスタムなど、URL 必須なのに空です。

**対処:** プロバイダをプリセットに戻すか、OpenAI 互換の Base URL を入れる。

## Ollama が見つからない / 接続できない

**確認:**

1. 本機で `ollama` が起動しているか
2. 設定の URL が `http://localhost:11434/v1` 付近か
3. モデルを `ollama pull …` 済みか

Agent は Ollama では使えません（Ask / Edit のみ）。

## Agent が動かない / トグルがない

| 原因 | 対処 |
|------|------|
| Ollama | Edit を使うか、別プロバイダへ |
| tools 非対応モデル | モデル変更 |
| フォルダ未オープン | [フォルダを開く](../getting-started/open-project.md) |

## ネットワーク / 401 / 403

- Key の誤り・期限切れ・権限不足
- 会社プロキシやファイアウォール
- プロバイダ側の障害・レート制限

設定のプロバイダ・モデル・Key を見直し、ブラウザや `curl` で同じ API に届くか切り分ける。

## 更新できない

インストーラ版は、[最新リリース](https://github.com/niki-ikuo/compass/releases/latest) の新しい `Setup` を入れ直すのが確実です。

## 関連

- [FAQ](faq.md)
- [AIプロバイダー設定](../getting-started/ai-provider.md)
- [Agent](../ai/agent.md)
