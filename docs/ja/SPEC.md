# AIエディタ「Compass」最小構成 仕様書（Windows）

[English](../SPEC.md) | **日本語**

## 1. プロダクト定義

| 項目 | 内容 |
|------|------|
| 名称（仮） | **Compass** |
| プラットフォーム | Windows 10/11（x64） |
| 目的 | ローカルコードを編集しながら、AIと対話してコードを書く・直す |
| MVPのゴール | 「フォルダを開く → ファイル編集 → AIに質問 → 提案を適用」が一通りできる |

---

## 2. Cursorとの比較：実装済み / 後回し

### 実装済み

- テキストエディタ
- ファイルツリー
- AIチャット（サイドパネル）— **Ask**（説明のみ）/ **Edit**（ファイル変更の提案）/ **Agent**（読取専用ツールループ。書き込み・コマンドは後続 — [AGENT_PLAN.md](./AGENT_PLAN.md)）
- 現在ファイルをコンテキスト送信
- AI提案の差分プレビュー＆適用（Edit は `compass-actions` → プレビュー → ユーザー承認）
- OpenAI互換API接続（マルチ LLM 切替: プロバイダプリセット・プロバイダ別 API Key・モデル選択）
- 設定（APIキー等）
- ターミナル統合（xterm.js + node-pty）
- コードベース構造索引（ワークスペースの `.compass/` — ファイル一覧・import グラフ等を AI コンテキストに付与）
- インライン補完（ゴーストテキスト / Tab で確定。設定で ON/OFF）

### 後回し（v2以降）

- **Agent の続き** — Phase 4 の UX / ガードレールは実装済み（適用失敗時の Agent 修正依頼、`verify` による test/lint/typecheck ループを含む）。後回し: tools 非対応時の自動 Edit フォールバック — [AGENT_PLAN.md](./AGENT_PLAN.md)
- ベクトル検索 / RAG による意味検索（現状の `.compass` は構造索引であり埋め込み検索ではない）
- MCP連携
- Git統合

---

## 3. 画面構成（最小UI）

```
┌──────────────────────────────────────────────────────────┐
│  メニューバー  [ファイル] [編集] [表示] [設定]            │
├──────────┬───────────────────────────────┬───────────────┤
│          │  タブ: main.ts  utils.ts      │               │
│ ファイル │───────────────────────────────│   AI チャット  │
│ ツリー   │                               │               │
│          │   Monaco Editor               │  ┌──────────┐ │
│  📁 src  │   (シンタックスハイライト)     │  │会話履歴  │ │
│   📄 a.ts│                               │  └──────────┘ │
│   📄 b.ts│                               │  [入力欄]     │
│          │                               │  [送信]       │
├──────────┴───────────────────────────────┴───────────────┤
│  ステータスバー: 行/列 | 言語 | 接続状態                    │
└──────────────────────────────────────────────────────────┘
```

| 項目 | 仕様 |
|------|------|
| ウィンドウサイズ | デフォルト 1280×800、リサイズ可能 |
| レイアウト | 3ペイン（ツリー 20% / エディタ 50% / チャット 30%）、パネル折りたたみ可 |

---

## 4. 機能仕様（MVP）

### 4.1 エディタ

| 機能 | 仕様 |
|------|------|
| エンジン | Monaco Editor（VS Codeと同系） |
| 対応操作 | 開く・保存・新規・閉じる、Undo/Redo、検索 |
| シンタックス | TypeScript, JavaScript, Python, JSON, Markdown, HTML, CSS |
| タブ | 複数ファイル同時編集、未保存マーク（●） |
| 自動保存 | オフ（明示的保存のみ） |

### 4.2 ファイル管理

| 機能 | 仕様 |
|------|------|
| フォルダを開く | ダイアログでワークスペースルート選択 |
| ツリー表示 | 再帰的ディレクトリ一覧、`node_modules` / `.git` は非表示 |
| ファイル操作 | 開く、保存、新規作成（v1.1で追加可） |

### 4.3 AIチャット

| 機能 | 仕様 |
|------|------|
| 入力 | マルチライン、Enter送信 / Shift+Enter改行 |
| コンテキスト | ①現在開いているファイル全文 ②ユーザーが選択したテキスト（あれば） |
| ストリーミング | トークン単位で逐次表示 |
| 会話履歴 | セッション内保持（アプリ再起動でクリア） |
| システムプロンプト | 「あなたはコーディングアシスタントです。コードは```で囲んで出力してください」 |

**コンテキスト送信フォーマット例:**

```
[現在のファイル: src/main.ts]
```typescript
// ファイル内容
```

[ユーザーの質問]
この関数のバグを直して
```

### 4.4 コード適用（Apply）

AIが返したコードブロックに対して:

1. **プレビュー** — 差分表示（追加=緑、削除=赤）
2. **適用** — 現在ファイルへ上書き、または選択範囲へ挿入
3. **拒否** — 何もしない

MVPでは「ファイル全体の置き換え」または「カーソル位置への挿入」の2パターンのみ。

### 4.5 設定

| 項目 | デフォルト |
|------|-----------|
| LLM プロバイダ | `openai`（OpenAI / Gemini / DeepSeek / Groq / OpenRouter / Ollama / カスタム） |
| API Base URL | プロバイダに応じて自動設定（カスタム時のみ手動） |
| API Key | プロバイダ別にローカル暗号化保存 |
| モデル | `gpt-4o-mini`（プロバイダごとの候補から選択、自由入力可） |
| 温度 | 0.2 |
| Max Tokens | 4096 |
| インライン補完 | ON |
| 初期シェル | `powershell`（PowerShell / cmd / Git Bash / WSL） |
| デフォルト用途プリセット | `code`（`document` / `data` / `general` も選択可 — [USE_CASE_PRESET.md](./USE_CASE_PRESET.md)） |

---

## 5. 技術スタック（推奨）

| 層 | 技術 |
|----|------|
| UI層 | React + TypeScript |
| シェル | Electron 33+ |
| エディタ | Monaco Editor |
| ビルド | electron-vite |
| パッケージ | electron-builder (NSIS) |
| 状態管理 | Zustand |
| AI通信 | fetch + SSE ストリーミング |

### Electronを選ぶ理由

- Cursor / VS Code と同系で、Monacoとの親和性が高い
- Windows向けパッケージングが成熟している
- MVP開発速度が最も速い

### 代替案

Tauri 2.0 + React + Monaco（バイナリサイズは小さいが、Windows周りの実装コストはやや高い）

---

## 6. アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│                  Renderer Process               │
│  ┌─────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │ FileTree│ │  Editor  │ │   ChatPanel     │  │
│  └────┬────┘ └────┬─────┘ └────────┬────────┘  │
│       │           │                │            │
│       └───────────┴────────────────┘            │
│                     │                           │
│              Zustand Store                      │
│         (files, editor, chat, settings)         │
└─────────────────────┬───────────────────────────┘
                      │ IPC (contextBridge)
┌─────────────────────┴───────────────────────────┐
│                  Main Process                   │
│  ┌──────────────┐  ┌────────────┐  ┌─────────┐ │
│  │ FileSystem   │  │ AI Client  │  │ Settings│ │
│  │ (fs/promises)│  │ (SSE/HTTP) │  │ (secure)│ │
│  └──────────────┘  └────────────┘  └─────────┘ │
└─────────────────────────────────────────────────┘
```

### IPC API（最小）

| チャンネル | 方向 | 用途 |
|-----------|------|------|
| `fs:readDir` | Renderer → Main | ディレクトリ一覧 |
| `fs:readFile` | Renderer → Main | ファイル読み込み |
| `fs:writeFile` | Renderer → Main | ファイル保存 |
| `fs:openFolder` | Renderer → Main | フォルダ選択ダイアログ |
| `ai:chat` | Renderer → Main | ストリーミングチャット |
| `settings:get/set` | Renderer → Main | 設定読み書き |

---

## 7. データモデル（最小）

```typescript
// ファイル
interface OpenFile {
  path: string;
  content: string;
  language: string;
  isDirty: boolean;
}

// チャット
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// 設定
interface AppSettings {
  providerId: LlmProviderId;
  apiBaseUrl: string;
  apiKey: string;
  providerKeys: Partial<Record<LlmProviderId, string>>;
  model: string;
  temperature: number;
}
```

---

## 8. 非機能要件

| 項目 | 目標 |
|------|------|
| 起動時間 | 3秒以内（コールドスタート） |
| メモリ | 300MB以下（小規模プロジェクト） |
| インストーラ | NSIS、スタートメニュー登録 |
| セキュリティ | APIキーは平文保存しない、Rendererから直接APIを叩かない |
| オフライン | エディタ単体は動作、AIはオンライン必須 |

---

## 9. MVP開発フェーズ（目安）

| フェーズ | 内容 | 期間目安 |
|---------|------|---------|
| **P0** | Electron起動、Monaco表示、単一ファイル開閉保存 | 1週間 |
| **P1** | ファイルツリー、タブ、フォルダを開く | 1週間 |
| **P2** | チャットUI、API接続、ストリーミング | 1週間 |
| **P3** | コンテキスト送信、コード適用（差分プレビュー） | 1週間 |
| **P4** | 設定画面、インストーラ、基本テスト | 3日 |

**合計: 約4〜5週間**（1人開発想定）

---

## 10. v2以降の拡張ロードマップ

```
現状（ターミナル / .compass 構造索引 / Ask・Edit・Agent / マルチ LLM / インライン補完 まで実装）
 ├─ 用途プリセット（code / document / data / general）— 仕様: [USE_CASE_PRESET.md](./USE_CASE_PRESET.md)
 └─ v2.0: Agent 自律実行（ツールループ・コマンド実行・複数ステップ）— 段階計画: [AGENT_PLAN.md](./AGENT_PLAN.md)
     └─ v2.1: コードベース意味検索（RAG / 埋め込み）
         └─ v3.0: MCP、プラグイン、非 OpenAI 互換ネイティブ API
```

v2.0 Agent の段階的実装チェックリスト: [AGENT_PLAN.md](./AGENT_PLAN.md)。  
用途プリセット（フォルダ作業向け・コード以外）の詳細仕様: [USE_CASE_PRESET.md](./USE_CASE_PRESET.md)。

**用語の区別**

| 名称 | 意味 |
|------|------|
| Ask モード | 説明・レビューのみ。ワークスペース変更は提案しない |
| Edit モード | ファイル作成・変更・削除を JSON で提案し、ユーザーがプレビュー承認して適用 |
| Agent | ツール呼び出しループ。Phase 1–3: 読取、`proposeActions`（プレビュー承認）、制限付き `exec` — [AGENT_PLAN.md](./AGENT_PLAN.md) |
| 用途プリセット | 「何の専門家か」（`code` / `document` / `data` / `general`）。Ask / Edit / Agent とは別軸 — [USE_CASE_PRESET.md](./USE_CASE_PRESET.md) |

---

## 11. プロジェクト構成（初期）

```
compass/
├── package.json
├── electron.vite.config.ts
├── electron/
│   ├── main.ts          # メインプロセス
│   ├── preload.ts       # IPCブリッジ
│   └── services/
│       ├── filesystem.ts
│       ├── ai-client.ts
│       └── settings.ts
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── FileTree.tsx
│   │   ├── Editor.tsx
│   │   ├── ChatPanel.tsx
│   │   └── SettingsDialog.tsx
│   ├── stores/
│   │   └── app-store.ts
│   └── types/
│       └── index.ts
└── resources/
    └── icon.ico
```

---

## 12. まとめ

MVPの核心は次の **4つの柱**:

1. **Monacoベースのコードエディタ** — 編集体験の土台
2. **ファイルツリー + ワークスペース** — プロジェクト単位の作業
3. **コンテキスト付きAIチャット** — 現在のファイルを理解した対話
4. **提案の適用** — AIの出力をエディタに反映する

Cursorの本質は「エディタ + 文脈を持ったAI + 変更の適用」。現状は構造索引・Edit（提案適用）・インライン補完まで実装済み。自律実行ループ・RAG は後続とする。
