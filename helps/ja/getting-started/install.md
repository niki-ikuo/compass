---
title: インストール
keywords:
  - インストール
  - ダウンロード
  - Setup
  - Windows
  - インストーラ
  - Node.js
  - 開発モード
category: getting-started
related:
  - welcome.md
  - ai-provider.md
  - ../troubleshooting/common-errors.md
commands:
  - Open Settings
---

# インストール

## 推奨：インストーラ

1. [最新リリース](https://github.com/niki-ikuo/compass/releases/latest) を開く
2. `Compass Setup x.y.z.exe` をダウンロード
3. 実行してインストール（Windows 10/11 x64）

起動後は [AIプロバイダー設定](ai-provider.md) へ。

## 開発者向け：ソースから動かす

必要なもの:

- Windows 10 / 11（x64）
- [Node.js](https://nodejs.org/) 18 以上
- npm

```bash
git clone https://github.com/niki-ikuo/compass.git
cd compass
npm install
npm run dev
```

`node-pty` のビルドに失敗したら:

```bash
npm run rebuild-native
```

### よく使うコマンド

| コマンド | 内容 |
|----------|------|
| `npm run dev` | 開発起動 |
| `npm run build` | 本番ビルド |
| `npm run dist` | インストーラ作成（`release/`） |

## よくある質問

**Q. どこにインストールされる？**  
A. 通常の Windows アプリと同様、インストーラの案内に従ってください。設定やワークスペースデータはアプリ側のローカル領域に保存されます。

**Q. 更新できない**  
A. 最新の `Setup` を入れ直すか、リリースページの新しい版を確認してください。詳細は [よくあるエラー](../troubleshooting/common-errors.md)。

## 関連

- [はじめに](welcome.md)
- [AIプロバイダー設定](ai-provider.md)
- [よくあるエラー](../troubleshooting/common-errors.md)
