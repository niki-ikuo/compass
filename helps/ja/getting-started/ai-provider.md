---
title: AIプロバイダー設定
keywords:
  - AI
  - API Key
  - Provider
  - OpenAI
  - Gemini
  - DeepSeek
  - Groq
  - OpenRouter
  - Ollama
  - Claude
  - Anthropic
  - モデル
  - 設定
category: getting-started
related:
  - welcome.md
  - open-project.md
  - ../ai/chat.md
  - ../ai/agent.md
  - ../troubleshooting/common-errors.md
commands:
  - Open Settings
  - Open Provider
---

# AIプロバイダー設定

AI を使う前に、接続先（プロバイダ）とモデルを設定します。

## 開き方

メニューの **設定** を開きます。

## 設定する項目

| 項目 | 説明 |
|------|------|
| プロバイダ | OpenAI / Gemini / DeepSeek / Groq / OpenRouter / Ollama / カスタム |
| API Key | プロバイダ別に保存（Ollama は不要） |
| モデル | 候補から選択、または自由入力 |
| Base URL | プロバイダ選択で自動（カスタム時のみ手動） |

## プロバイダ早見

| プロバイダ | API Key | Agent |
|------------|---------|-------|
| OpenAI | 必要 | 使える |
| Google Gemini | 必要 | 使える |
| DeepSeek | 必要 | 使える |
| Groq | 必要 | 使える |
| OpenRouter | 必要 | モデル次第（Claude もここ経由） |
| Ollama（ローカル） | 不要 | **使えない**（Ask / Edit のみ） |
| カスタム（OpenAI互換） | 通常必要 | エンドポイント次第 |

Claude を使う場合は、専用プロバイダではなく **OpenRouter** などで Anthropic モデルを選びます。

## Ollama（ローカル）

1. 本機で [Ollama](https://ollama.com/) を起動する
2. 設定でプロバイダを **Ollama** にする（既定 URL: `http://localhost:11434/v1`）
3. 使いたいモデルを pull 済みにする（例: `ollama pull llama3.2`）

見つからないときは [よくあるエラー](../troubleshooting/common-errors.md)。

## 使い方の流れ

1. プロバイダを選ぶ
2. API Key を入れる（必要な場合）
3. モデルを選ぶ
4. 保存する
5. [フォルダを開く](open-project.md) → [チャット](../ai/chat.md)

## よくある質問

**Q. 「APIキーが設定されていません」**  
A. いま選んでいるプロバイダ用の Key が入っていません。設定を開き直してください。

**Q. Agent のトグルが出ない**  
A. Ollama など tools 非対応のプロバイダでは Agent を隠し、Ask / Edit のみになります。詳細は [Agent](../ai/agent.md)。

## 関連

- [プロジェクトを開く](open-project.md)
- [AIチャット](../ai/chat.md)
- [Agent](../ai/agent.md)
- [よくあるエラー](../troubleshooting/common-errors.md)
