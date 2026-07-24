# AI 適用の取り消し（Apply Undo）— 改修案

[English](../AI_APPLY_UNDO.md) | **日本語**

状態: **Phase 2 実装済み**（メッセージ横 Undo、適用履歴一覧、Agent 向け Undo 通知強化、このチャットの適用取り消し）。Phase 3 はバックログ。関連: [AGENT.md](./AGENT.md)（プレビュー／適用ゲート）、[ARCHITECTURE.md](./ARCHITECTURE.md)、[SPEC.md](./SPEC.md)。

Apply 後 Undo の設計記録。Phase 1 で Change Set 基盤、Phase 2 で発見性・チャット単位操作を追加。

---

## 0. 結論（先に読む）

| 問い | 答え |
|------|------|
| Apply 後の Undo は必要か？ | **必要。「あると良い」ではない。安全上の穴。** |
| プレビュー拒否で足りるか？ | **足りない。** ディスク書き込み前の話にすぎない。 |
| まず出荷すべき範囲は？ | **Phase 1 のみ**（§8）: Apply 時 Change Set + Undo Last + 削除バックアップ + stale 判定 + 最小 UI。 |
| いま作るなもの | チャット横断の一括戻し UI、履歴パネル、git 自動 stash、Template / `exec` の Undo、無限タイムライン。 |
| 複数チャットタブは？ | **設計上対応可能。** Change Set をワークスペース共通にし `chatId` を持てばよい（§5）。 |

書き込み前の承認は被害の**予防**でしかない。差分を流し読みして Apply する事故は起きる。適用後の復旧（特に削除・git 無し）が無い状態は、AI ワークスペースとして未完成である。

---

## 1. 現状の問題

Edit / Agent 共通の流れ:

```
提案 → previewActions（write は oldContent 保持）→ ユーザー Apply / Reject
                                                 → applyActions がディスク反映
                                                 → previewOriginal 破棄
```

| 能力 | 状態 |
|------|------|
| Apply **前**の拒否・部分拒否 | ある |
| プレビュー残しでのファイル単位 Apply | ある |
| Apply **後**の Undo | **ない** |
| 削除ファイル／フォルダの復元 | **ない** |
| 復旧用バイトの永続化 | **ない**（成功時に捨てている） |
| 適用をチャットタブに紐づけて残す | **ない** |

主な参照箇所:

- Preview / apply: `electron/services/filesystem.ts`（`previewWorkspaceActions`, `applyWorkspaceActions`）
- ストア: `src/stores/app-store.ts`（`applyWorkspacePreview`, `applyPreviewFile`, `revertWorkspacePreview`）
- 型: `src/types/index.ts` の `ActionPreviewItem` / `WorkspaceAction`
- Agent 書き込みゲート: `proposeActions` → `ai:needApproval` → 同一プレビュー UI

注意: Agent の `checkpoint` は**計画再開用メタデータ**であり、ファイルスナップショットではない。UI 文言で混同させない。

---

## 2. 目的と非目的

### 目的

1. AI Apply 成功後、その適用分のワークスペース状態を戻せる
2. **git 無し**で動く
3. `writeFile` / `mkdir` / `deleteFile` / `deleteDir` をカバー（プレビューと同じ集合）
4. 複数チャットタブでも黙って壊さない
5. 第二の書き込み経路を増やさず、既存 `applyActions` の上に載せる

### 非目的（Phase 1 以降も当面やらない）

- 手動編集、Template Manager、Agent `exec` の副作用の Undo
- Apply ごとの自動 git commit / stash
- プロジェクト全体のタイムトラベル UI
- モデルが呼べる undo ツール化
- Monaco の `Ctrl+Z` を「AI 適用取り消し」にする（編集 Undo と衝突）

---

## 3. 中核: Change Set

**Change Set 1 つ** = 成功した Apply 1 単位（一括 Apply **または** ファイル単位 Apply）。

```ts
type WorkspaceChangeSet = {
  id: string
  chatId: string
  createdAt: number
  source: 'preview-all' | 'preview-file'
  workspaceRoot: string
  entries: WorkspaceChangeEntry[]
  status: 'applied' | 'undone' | 'stale'
}

type WorkspaceChangeEntry =
  | {
      type: 'writeFile'
      relativePath: string
      before: string | null // null = 新規作成
      after: string
      wasNew: boolean
    }
  | {
      type: 'mkdir'
      relativePath: string
      alreadyExisted: boolean // true なら Undo 時 no-op
    }
  | {
      type: 'deleteFile'
      relativePath: string
      before: string
      backupRef?: string
    }
  | {
      type: 'deleteDir'
      relativePath: string
      backupRef: string // 必須 — .compass 配下へ退避
    }
```

### スタック方針（Phase 1）

- Change Set は**ワークスペース単位の LIFO スタック**
- **Undo Last** は常に最新の `applied`
- 途中のセットを飛ばして戻さない。古いものを戻したいなら新しい方から Undo するか、衝突で失敗させる

理由: ディスクの時間軸は一本。チャット別に勝手に戻すと上書き事故が起きる。

---

## 4. ロールバック規則

Undo は**適用の逆順**でエントリを処理する。

| 適用時 | Undo 時 |
|--------|---------|
| `writeFile` 上書き | `before` を書き戻す |
| `writeFile` 新規（`wasNew`） | 現内容が `after` と一致するときだけ削除 |
| `mkdir` 新規 | **空のときだけ**削除。中身があれば失敗 / stale |
| `mkdir` 既存 | no-op |
| `deleteFile` | `before` または `backupRef` から復元 |
| `deleteDir` | `backupRef` からツリー復元 |

### stale 判定（必須）

Undo でディスクを触る前に:

1. 各 `writeFile` の現内容が `after` と一致すること（無い・違う → stale）
2. **より新しい** Change Set が触ったパス → 順序を飛ばしての Undo は不可
3. 1 Change Set はできるだけ**全部成功 or 何もしない**。部分成功しかできないなら、戻した／戻せなかったを明示。黙った半端 Undo は不可

---

## 5. 複数 AI チャットタブ

会話は複数、ファイルシステムは一つ。

| 論点 | 設計 |
|------|------|
| 帰属 | Change Set に `chatId` を必ず持つ（表示・将来のフィルタ用） |
| Undo Last | ワークスペース全体の直近 Apply（タブ不問） |
| 「このチャットの適用を戻す」 | Phase 2 以降。その chat のセットを新しい順に戻し、他タブのより新しいセットと衝突したら止める |
| 同時プレビュー | 現状、未適用プレビューは実質アクティブ側前提。Undo 設計は同時プレビュー問題を解決しない（別件） |
| 例 | タブA が `a.ts`、タブB が `b.ts` を Apply → Undo Last は B のみ。同一ファイルを A→B → Undo Last は B（A の内容に戻る）。B が残る状態で A を直接 Undo → 衝突で拒否 |

ディスク用 Undo スタックをチャット別に分けない。現実と乖離する。

---

## 6. 保存先

ワークスペースローカル（indexer は既に `.compass` を除外）:

```
.compass/ai-undo/
  index.json           # メタ + 順序付き id（上限 N）
  backups/<changeSetId>/...
```

| 方針 | Phase 1 推奨 |
|------|----------------|
| 保持件数 | 直近 **10〜20** |
| ディスク必須の理由 | 再起動後も削除を戻すため |
| `deleteDir` | 削除**前**に `backups/` へ退避。退避失敗なら **Apply 自体を失敗**（Undo 材料なしでの削除禁止） |
| サイズ上限 | `deleteDir` に上限を設ける。超過は Apply 拒否が Phase 1 では望ましい |

メモリだけの Undo では不十分。

---

## 7. API / 差し込み（概念）

Main:

- apply 経路を拡張: バックアップ → 適用 → `WorkspaceChangeSet` を返す／永続化
- `undoLastChangeSet(workspaceRoot)` / `undoChangeSet(workspaceRoot, id)`
- 任意: `listChangeSets(workspaceRoot)`

Renderer ストア:

- `applyWorkspacePreview` / `applyPreviewFile` 成功時に Change Set を積む
- `undoLastAiApply()` を公開
- `revertWorkspacePreview` は**適用前専用**のまま（適用後 Undo と名前を混同しない）

UI:

- Apply 成功バー:「N 件適用」+ **この適用を取り消す**
- コマンド／メニュー: **Undo Last AI Apply**（`Ctrl+Z` は使わない）
- 文言は「適用を取り消す」に統一。checkpoint と呼ばない

Agent:

- Undo は**ユーザー操作**。モデルツールにしない
- Undo 後、チャットに短い注記（「直前の適用を取り消した」）を残すと、Agent 継続時のズレが減る。Phase 1 ではあれば良い。Apply 直後に Agent が続きやすいなら早めに入れる

---

## 8. フェーズ

### Phase 1 — **いまこれを出荷する**（推奨範囲）

- 一括 Apply / ファイル単位 Apply で Change Set 永続化
- 削除（ファイル・ディレクトリ）のバックアップ
- Undo Last（LIFO）+ stale 判定
- 最小 UI（成功時の導線 + コマンド／メニュー）
- 複数タブはワークスペーススタック + `chatId` フィールドで安全側に（チャット別 UI は後回しでよい）

### Phase 2 — **実装済み**

- 適用を記録したチャットメッセージ横からの Undo
- 直近 Change Set の簡易一覧（AI適用の履歴）
- Undo 後の Agent 向け通知強化（パス要約 + Agent 実行中は再読込警告）
- 「このチャットの適用を戻す」（新しい順、他チャットのより新しい適用で停止）

### Phase 3 — 任意／やらなくてよいものも含む

- フルの履歴タイムライン UI
- git 自動 stash 連携
- Template Manager への同基盤適用
- 設定画面での保持件数・サイズ

---

## 9. 判断: 現時点でどこまでやるか

**Phase 1 で止める。** 同じ改修に Phase 2/3 を混ぜない。

理由:

1. **いま一番危ないのは不可逆な Apply**（特に削除）。Phase 1 がそれを塞ぐ
2. 適用前ミスは既存プレビューで足りる。履歴パネルを先に作るのは順番が逆
3. 複数タブは LIFO スタックで既に扱える。追加の製品面はまだ不要
4. git・Template・exec・チャット一括魔法まで広げると、必要な一本のボタン（**この適用を取り消す**）が遅れる

Phase 1 内の実装順:

1. 型 + Main の `.compass/ai-undo` バックアップ／index
2. `applyActions` とストアの Apply 成功経路に接続
3. `undoLastChangeSet` + stale 判定 + テスト（まず `filesystem`）
4. 薄い UI（バー + コマンド）+ ヘルプ一言
5. その後で Agent 向け注記を検討

最初の PR でもやらないこと:

- プレビュー UX の作り直し
- Agent `checkpoint` の改名
- タブ間の同時プレビュー対応

---

## 10. テスト計画（Phase 1）

- 上書き Apply → Undo で `before` 復元
- 新規ファイル Apply → Undo で削除
- deleteFile Apply → Undo で内容復元
- deleteDir Apply → Undo でツリー復元。バックアップ不能なら Apply 失敗
- mkdir（新規・空）→ Undo で削除。mkdir 後に中へファイル追加 → Undo は明確に失敗
- 別ファイルの Apply 2 回 → 逆順に 2 回 Undo
- 同一ファイルを別チャットで 2 回 Apply → Undo Last のみ。新しいセットがある古いセットの Undo は拒否
- Apply 後に手動編集 → stale、ディスク不变
- アプリ再起動後も `.compass/ai-undo` から削除 Undo 可能

---

## 11. 実装時のドキュメント追随

- ヘルプ: `helps/*/ai/chat.md`, `helps/*/ai/agent.md` — Apply 後に取り消せると明記
- 任意で [AGENT.md](./AGENT.md) の書き込みゲートから本ドキュメントへリンク
- 提案の更新時は英語正本と本日本語を同変更で揃える

---

## 12. まとめ

Compass は書き込み**前**は正しい。書き込み**後**は復旧に必要なバイトを捨てており、そこが誤りである。ワークスペース Change Set、削除バックアップ、LIFO の Undo Last、stale 判定で塞ぐ。**いま作るのは Phase 1 だけ。** 残りはバックログであり、初回デリバリに混ぜない。
