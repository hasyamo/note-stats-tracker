# fetch_my_likes.py 設計

## 概要

自分がスキした記事とそのタイミングをCSVに蓄積するスクリプト。

## シーケンス図

```mermaid
sequenceDiagram
    participant Script as fetch_my_likes.py
    participant CSV as my_likes.csv
    participant NoteAPI as note.com API<br>(Cookie必要)
    participant CFProxy as CFプロキシ<br>(認証不要)

    Note over Script: 1. CSV読み込み
    Script->>CSV: 最新のスキ済み記事IDを取得（1行目）
    CSV-->>Script: 最新記事ID or なし（初回）

    loop 2. ページごと（10件/ページ）
        Script->>NoteAPI: 自分がスキした記事一覧を取得（新しい順）
        NoteAPI-->>Script: スキした記事10件

        loop 3. スキした記事ごと
            alt 3a. 最新記事IDと一致
                Note over Script: 追いついた。終了
            else 3b. 一致しない（新規）
                Script->>CFProxy: その記事のスキ一覧を取得
                CFProxy-->>Script: スキしたユーザー一覧
                Note over Script: 4. 一覧から自分を探し、スキした日時を取得
                Script->>CSV: 5. 1件即時追記
                Note over Script: 6. ログ出力
                Note over Script: 7. sleep 0.5秒
            end
        end

        alt 8a. 追いついた or 最終ページ
            Note over Script: 9. 終了
        else 8b. まだ続きあり
            Note over Script: sleep 1秒 → 次ページ
        end
    end
```

## 初回実行

```mermaid
sequenceDiagram
    participant Script as fetch_my_likes.py
    participant CSV as my_likes.csv

    Script->>CSV: 最新記事ID → なし（ファイルなし）
    Note over Script: 全件取得モード
    Note over Script: 全ページのスキした記事を取得
    Note over Script: 各記事のスキ日時を取得 → CSV即時追記
    Note over Script: 最終ページまで処理して終了
```

## 2回目以降（差分取得）

```mermaid
sequenceDiagram
    participant Script as fetch_my_likes.py
    participant CSV as my_likes.csv

    Script->>CSV: 最新記事ID → n7f472192316e
    Note over Script: スキした記事一覧を取得（新しい順）
    Note over Script: 新しい記事3件を処理 → CSV追記
    Note over Script: n7f472192316eに到達 → 終了
```

## 異常終了 → 再開

```mermaid
sequenceDiagram
    participant Script as fetch_my_likes.py
    participant CSV as my_likes.csv

    Note over CSV: 前回: 80件目まで書き込み済み
    Script->>CSV: 最新記事ID → 80件目の記事ID
    Note over Script: スキした記事一覧を取得（新しい順）
    Note over Script: 80件目より新しい記事はないのでスキップ数0
    Note over Script: 80件目に到達 → 終了
    Note over Script: ※ 81件目以降の未取得分は残る
```

## 異常終了の課題

上記のように、最新記事IDベースだと**81件目以降が取得されない**。
対策: 初回実行が途中で失敗した場合は、CSVを削除して再実行する。
2回目以降の差分取得では数件なので、途中失敗のリスクは低い。

## CSV仕様

保存順: スキした日時の**新しい順**（先頭が最新）

| カラム | 内容 | 例 |
|---|---|---|
| liked_at | 自分がスキした日時 | 2026-03-20T17:14:06.000+09:00 |
| note_key | スキした記事のID | n7f472192316e |
| author_urlname | 記事の著者のurlname | ktcrs1107 |
| author_name | 記事の著者の表示名 | KITAcore｜キタコレ |
| article_title | 記事タイトル | noteダッシュボードを... |

## API仕様

| API | 認証 | レート制限対策 |
|---|---|---|
| /api/v1/notes/liked | Cookie必要 | 1秒/ページ |
| /api/v3/notes/{key}/likes | 不要（CFプロキシ経由） | 0.5秒/記事 |
