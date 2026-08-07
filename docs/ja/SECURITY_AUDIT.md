# セキュリティ診断（静的）

[English](../SECURITY_AUDIT.md) | **日本語**

Compass（Electron）のソースコード静的レビュー結果です。  
日付: 2026-08-07 · 更新: 2026-08-07（対策適用 + 再見直し強化）

## 脅威モデル

ローカルデスクトップアプリのため、ユーザー自身のファイル操作は想定内です。本診断の主脅威は **レンダラー侵害後の特権昇格**（例: XSS → 特権 IPC）です。

## サマリー（対策後）

| 重大度 | 当初 | 状態 |
|--------|------|------|
| Critical | 1 | 対策済み |
| High | 4 | 対策済み |
| Medium | 10 | 対策済み |
| Low | 2 | 対策済み |
| Info | 1 | 設計として記録 |

## 適用した対策

| ID | 所見 | 対策 |
|----|------|------|
| C1 | FS IPC に境界なし | アクティブ WS のパスガード（`path-guard.ts`）。`workspace:setLast` で同期 |
| H1 | Desk IPC 任意読取 | outbox + workspace 検証を read 前に実施 |
| H2 | Agent exec のネットワーク | `curl` / `wget` / `nc` / `ssh` / `python -c` / `node -e` 等を承認必須に |
| H3 | 承認 IPC 無認可 | pending を `webContents.id` に紐づけ、resolve 時に照合 |
| H4 | Markdown XSS | `SafeMarkdown`（React トークン、HTML 破棄）を Preview / Help / HelpAsk に適用 |
| M1 | `sandbox: false` | `sandbox: true` |
| M2 | webview 攻撃面 | popups 無効、アドレスバーで `file:`/`data:` 拒否、`will-navigate` 制限 |
| M3 | shell 任意パス | アクティブ WS 内のみ |
| M4 | symlink 脱出 | `realpath` 再検証 |
| M5 | API キーが renderer に渡る | `getPublicSettings()` で秘匿。空保存は既存キー維持 |
| M6 | safeStorage 不可時 Base64 | Settings で `apiKeyStorageInsecure` 警告 |
| M7 | apiBaseUrl SSRF | プライベート／メタデータホスト拒否（localhost は許可） |
| M8 | 外部チャット文脈 | `registerExternalContextPaths` の allowlist（ドロップ / pickFiles） |
| M9 | autoApply bypass | 機密パスは自動適用しない |
| M10 | Agent 機密読取 | `executeReadFile` で機密パスを拒否 |
| L1 | ターミナル所有者チェック | XSS + FS ガード後は優先度低下のため後回し |
| L2 | 開発 CSP なし | dev（緩和）/ prod（`connect-src` 厳格）の双方で CSP |

## 再見直しで追加した強化

| 問題 | 対策 |
|------|------|
| 外部 allowlist の TOCTOU | 登録・照合とも `realpath` のみ。存在するファイル + サイズ上限 |
| client 指定の `workspaceRoot` | apply/preview/search/desk/git/index/chat 等で `bindActiveWorkspaceRoot` |
| Agent / Help Ask の SSRF 漏れ | 共通 `resolveSafeChatCompletionsUrl` |
| チャット文脈の機密ファイル | `resolveChatContext` で `.env` / 鍵をスキップ |
| Help 相対リンク退行 | `SafeMarkdown allowRelativeDocLinks` |
| open 失敗後の active WS 残留 | catch / restore 失敗で `setLast(null)` |
| LAN Ollama の UX | `allowLanApiBaseUrl` オプトイン（メタデータは常に拒否） |
| outbox symlink 脱出 | `realpath` 付き `isPathUnderDir` |
| exec cwd / powershell 抜け | cwd を realpath 化、powershell/pwsh を一律承認 |

## 残メモ

- 統合ターミナルは設計上フルシェル（Info）
- L1（PTY の webContents 紐づけ）は追加強化候補
- 依存パッケージの CVE 一覧（`npm audit`）は本ドキュメントの対象外
