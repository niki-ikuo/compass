# Compass へのコントリビューション

興味を持っていただきありがとうございます。

**English** | [日本語](CONTRIBUTING.ja.md) — 英語版は [CONTRIBUTING.md](CONTRIBUTING.md) です。

**言語:** Issue・Pull Request・コードレビューのコメントは **英語** を推奨します。日本語も歓迎です。

## はじめに

1. [開発ガイド](docs/ja/DEVELOPMENT.md) を読む
2. IPC やメインプロセスを触る場合は [アーキテクチャ](docs/ja/ARCHITECTURE.md) にも目を通す
3. Fork / clone のあと:

```bash
npm install
npm run dev
```

`node-pty` のビルドに失敗した場合は `npm run rebuild-native` を実行してください（Windows では Visual Studio Build Tools が必要です）。

## 貢献の仕方

1. 大きめの変更（バグ、機能、設計の相談）は、できるだけ Issue を先に立てる
2. PR は焦点を絞る — 1 PR につき 1 つの関心ごとにするとレビューしやすい
3. 触っている箇所の既存のコードスタイルとパターンに合わせる
4. 挙動や公開 API が変わるときはドキュメントも更新する:
   - **英語** の `docs/` が正本
   - 可能なら `docs/ja/` も更新する（または PR に日本語未更新である旨を書く）

## プロジェクト構成

| 領域 | パス |
|------|------|
| UI | `src/` |
| メインプロセス / IPC | `electron/` |
| UI の i18n | `src/i18n/`（`en` がデフォルト、`ja`） |
| ドキュメント（英語） | `docs/` |
| ドキュメント（日本語） | `docs/ja/` |

## Pull Request チェックリスト

- [ ] ローカルでビルドできる（`npm run build`、または少なくとも `npm run dev`）
- [ ] 差分にシークレット（API キー、トークン）を含めていない
- [ ] 必要ならドキュメントを更新した
- [ ] 新しい UI 文字列は `src/i18n` 経由（`ja` と `en` の両方）

## 行動規範

敬意を持ち、建設的であること。善意を前提とし、明確で実行可能なフィードバックを好みます。

詳細は [CODE_OF_CONDUCT.ja.md](CODE_OF_CONDUCT.ja.md)（英語版: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)）を参照してください。
