# SortingHat Bot

Discord BOTとして動作するNodeJSのコード

## 機能

- CSVファイルをアップロードし、RowIdを指定することでKeyとValueの紐づけを行う
- 通常のユーザーは、特定のチャットでValueに対応する内容を投稿することでKeyにひもづくロールが付与される
- 特定のチャットで入力された内容は保存されない（自動削除）
- 複数のサーバでBOTが利用される

## 必要要件

- Node.js 18.0.0 以上（通常インストール時）
- Docker と Docker Compose（コンテナ実行時）

## セットアップ

### デプロイ方法の選択

このBOTは以下の2つの方法でデプロイできます：
- **方法A**: Docker Compose を使用（推奨）
- **方法B**: Node.js を直接使用

## セットアップ（Docker Compose使用）

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

### 3. Docker Compose でのセットアップ

```bash
# 環境変数の設定
cp .env.example .env

# .env ファイルを編集
# - DISCORD_TOKEN: BOTのトークンを設定
# - BOT_PORT: HTTPサーバーのポート番号（デフォルト: 3000）
#   カスタムポートを使用する場合は変更してください
#   例: BOT_PORT=8080

# Dockerイメージのビルドとコンテナの起動
docker-compose up -d

# ログの確認
docker-compose logs -f

# コンテナの停止
docker-compose down
```

### ヘルスチェック・ステータス確認

BOTはHTTPサーバーを起動し、以下のエンドポイントを提供します：

- `http://localhost:{BOT_PORT}/health` - ヘルスチェック
- `http://localhost:{BOT_PORT}/status` - BOTの詳細なステータス
- `http://localhost:{BOT_PORT}/` - BOT情報

例（デフォルトポート3000の場合）：
```bash
curl http://localhost:3000/health
curl http://localhost:3000/status
```

カスタムポートを使用する場合の例（ポート8080）：
```bash
# .envファイルに設定
BOT_PORT=8080

# アクセス
curl http://localhost:8080/health
```

## セットアップ（Node.js直接実行）

### 1. プロジェクトのセットアップ

```bash
# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env
# .env ファイルを編集して DISCORD_TOKEN と BOT_PORT を設定

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
- **重要**: サーバーの設定（CSVデータ、チャンネル設定）はメモリ上に保存されるため、BOTを再起動すると失われます。再起動後は再度設定が必要です
