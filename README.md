# note-stats-tracker

noteの記事データを毎日自動で蓄積するツール。

## 仕組み

- GitHub Actionsが毎日23:50 JST に実行
- noteのAPIから全記事のビュー・スキ・コメント + フォロワー数を取得
- CSVファイルに追記してコミット

## データ

| ファイル | 内容 |
|----------|------|
| `data/articles.csv` | 記事別の日次スナップショット |
| `data/daily_summary.csv` | 日次サマリー（総PV, 総スキ, フォロワー数） |

## ディレクトリ構造

```
note-stats-tracker/
├── .github/workflows/
│   └── daily-stats.yml       # GitHub Actions（毎日23:00 JST実行）
├── scripts/
│   └── fetch_stats.py        # データ取得・保存スクリプト
├── data/
│   ├── articles.csv           # 記事別日次データ（自動生成）
│   └── daily_summary.csv      # 日次サマリー（自動生成）
├── .env.example               # 環境変数テンプレート（→ .envにコピーして使用）
├── .gitignore
└── README.md
```

## セットアップ

### 1. リポジトリのSecrets に設定

| Secret | 値 |
|--------|-----|
| `NOTE_COOKIE` | noteにログインした状態のCookie |
| `NOTE_USERNAME` | noteのユーザー名（例: `hasyamo`） |

### 2. リポジトリのVariables に設定

| Variable | 値 |
|----------|-----|
| `COOKIE_SET_DATE` | Cookieを設定した日（例: `2026-02-07`） |

### 3. Cookie の取得方法

1. ブラウザでnoteにログイン
2. DevTools（F12）→ Network タブ
3. note.com内の任意のリクエストを選択
4. Request Headers の `Cookie` をコピー
5. リポジトリの Secrets に `NOTE_COOKIE` として登録

### Cookie更新

- Cookieの有効期限は約3ヶ月
- 期限10日前からログに警告が出る
- 期限が切れるとジョブが失敗する → GitHub Appで確認可能

## 分析（今後）

データが2週間程度溜まったら、減衰曲線やストック型記事の発掘分析を追加予定。
