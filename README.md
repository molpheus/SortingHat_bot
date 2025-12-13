# SortingHat Bot

Discord BOTとして動作するNodeJSのコード

## 機能

- CSVファイルをアップロードし、RowIdを指定することでKeyとValueの紐づけを行う
- 通常のユーザーは、特定のチャットでValueに対応する内容を投稿することでKeyにひもづくロールが付与される
- 特定のチャットで入力された内容は保存されない（自動削除）
- 複数のサーバでBOTが利用される

## セットアップ

### 1. Discord Bot の作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 「New Application」をクリックして新しいアプリケーションを作成
3. 左メニューの「Bot」をクリック
4. 「Add Bot」をクリック
5. BOTのトークンをコピー（後で使用します）
6. 「Privileged Gateway Intents」セクションで以下を有効化：
   - `PRESENCE INTENT`
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT`

### 2. BOT の招待

1. 左メニューの「OAuth2」→「URL Generator」をクリック
2. 「SCOPES」で `bot` を選択
3. 「BOT PERMISSIONS」で以下を選択：
   - `Manage Roles`
   - `Send Messages`
   - `Read Messages/View Channels`
   - `Read Message History`
   - `Manage Messages`
4. 生成されたURLをブラウザで開き、サーバーにBOTを招待

### 3. プロジェクトのセットアップ

```bash
# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env
# .env ファイルを編集して DISCORD_TOKEN にBOTのトークンを設定

# BOTの起動
npm start
```

## 使い方

### 管理者コマンド

以下のコマンドは管理者権限を持つユーザーのみ使用できます：

#### `!setchannel`
現在のチャンネルをロール付与チャンネルに設定します。

```
!setchannel
```

#### `!uploadcsv <KeyColumnId> <ValueColumnId>`
CSVファイルをアップロードしてKey-Valueマッピングを設定します。

- `KeyColumnId`: ロール名が記載されている列の番号（0から始まる）
- `ValueColumnId`: ユーザーが投稿する値が記載されている列の番号（0から始まる）

例：CSVファイルの0列目がロール名、1列目がマッチング値の場合
```
!uploadcsv 0 1
```

CSVファイルの例：
```csv
ロール1,password1
ロール2,password2
ロール3,password3
```

#### `!status`
現在の設定を表示します。

```
!status
```

#### `!help`
コマンド一覧を表示します。

```
!help
```

### ユーザーの使い方

1. 設定されたチャンネルで、CSVファイルに登録されたValue（例：パスワード）を投稿
2. 自動的に対応するロールが付与される
3. 投稿したメッセージは自動的に削除される

## 動作例

1. 管理者がCSVファイルをアップロード：
   ```
   ロール名,パスワード
   グループA,secretA
   グループB,secretB
   ```

2. 管理者が `!uploadcsv 0 1` を実行

3. ユーザーが設定されたチャンネルで「secretA」と投稿

4. ユーザーに「グループA」ロールが付与され、メッセージは削除される

## 注意事項

- BOTには「Manage Roles」権限が必要です
- BOTは自分より下位のロールのみ付与できます
- メッセージの削除には「Manage Messages」権限が必要です
- 各サーバーごとに独立した設定が保持されます
