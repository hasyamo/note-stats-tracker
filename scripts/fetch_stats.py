"""
note記事データ日次取得スクリプト
GitHub Actionsで毎日実行し、記事ごとのビュー・スキ・コメントをCSVに蓄積する
"""

import os
import csv
import json
import time
import sys
from datetime import datetime, timezone, timedelta
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from pathlib import Path

# Windows環境でのUnicode出力対応
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def load_dotenv():
    """簡易.envファイル読み込み（python-dotenv不要）"""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        print(f"[dotenv] .envファイルが見つかりません: {env_path}")
        return
    print(f"[dotenv] .envファイル読み込み: {env_path}")
    loaded = []
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key not in os.environ:
                    os.environ[key] = value
                    loaded.append(key)
                else:
                    print(f"[dotenv] {key}: 環境変数が既に設定済み（.envの値をスキップ）")
    for key in loaded:
        val = os.environ[key]
        if key == "NOTE_COOKIE":
            # Cookieは先頭20文字だけ表示
            print(f"[dotenv] {key} = {val[:20]}...（{len(val)}文字）")
        else:
            print(f"[dotenv] {key} = {val}")


load_dotenv()

# 設定
NOTE_COOKIE = os.environ.get("NOTE_COOKIE", "")
NOTE_USERNAME = os.environ.get("NOTE_USERNAME", "")
COOKIE_SET_DATE = os.environ.get("COOKIE_SET_DATE", "")  # YYYY-MM-DD形式
BASE_URL = "https://note.com"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

JST = timezone(timedelta(hours=9))


def get_today_jst():
    """JSTの「今日」を返す。0:00〜4:59に実行された場合は前日扱い"""
    now = datetime.now(JST)
    if now.hour < 5:
        now = now - timedelta(days=1)
    return now.strftime("%Y-%m-%d")


def check_cookie_expiry():
    """Cookieの期限が近づいていたら警告"""
    if not COOKIE_SET_DATE:
        print("⚠ COOKIE_SET_DATE が未設定です。期限チェックをスキップします。")
        return
    try:
        set_date = datetime.strptime(COOKIE_SET_DATE, "%Y-%m-%d").replace(tzinfo=JST)
        days_elapsed = (datetime.now(JST) - set_date).days
        days_remaining = 90 - days_elapsed
        if days_remaining <= 0:
            print(f"🚨 Cookieが期限切れの可能性があります（設定から{days_elapsed}日経過）")
        elif days_remaining <= 10:
            print(f"⚠ Cookie期限まであと約{days_remaining}日です！早めに更新してください。")
        else:
            print(f"✓ Cookie期限: あと約{days_remaining}日")
    except ValueError:
        print(f"⚠ COOKIE_SET_DATE の形式が不正です: {COOKIE_SET_DATE}")


def validate_cookie():
    """Cookie値の基本的な妥当性チェック"""
    if not NOTE_COOKIE:
        print("🚨 NOTE_COOKIE が空です。")
        print("   → .envまたはリポジトリのSecretsにCookieを設定してください。")
        sys.exit(1)

    # 最低限のフォーマットチェック
    if "=" not in NOTE_COOKIE:
        print("🚨 NOTE_COOKIE の形式が不正です（key=value形式ではありません）。")
        print(f"   → 現在の値: {NOTE_COOKIE[:30]}...")
        sys.exit(1)

    # よくある間違い: .envのキー名ごと入れてしまう
    if NOTE_COOKIE.startswith("NOTE_COOKIE="):
        print("🚨 NOTE_COOKIE の値に 'NOTE_COOKIE=' が含まれています。")
        print("   → .envには NOTE_COOKIE=値 の形式で記載してください（値だけを設定）。")
        sys.exit(1)

    # セッションCookieの長さチェック（noteのセッションは通常数百文字以上）
    if len(NOTE_COOKIE) < 50:
        print(f"⚠ NOTE_COOKIE が短すぎます（{len(NOTE_COOKIE)}文字）。")
        print("   → ブラウザのDevToolsから完全なCookieヘッダをコピーしてください。")
        print("   → 複数のCookieがセミコロン区切りで含まれている必要があるかもしれません。")

    print(f"[debug] Cookie先頭: {NOTE_COOKIE[:40]}...")
    print(f"[debug] Cookie長: {len(NOTE_COOKIE)}文字")


def verify_auth():
    """API呼び出し前に認証が通るか確認"""
    print("\n🔑 認証チェック中...")
    url = f"{BASE_URL}/api/v1/stats/pv?filter=all&page=1&sort=pv"
    req = Request(url)
    req.add_header("Cookie", NOTE_COOKIE)
    req.add_header("User-Agent", "note-stats-tracker")

    try:
        with urlopen(req) as res:
            body = json.loads(res.read().decode("utf-8"))
            if "data" in body and "note_stats" in body["data"]:
                print("✓ 認証OK（stats APIにアクセスできました）")
                return True
            else:
                print("⚠ APIは応答しましたが、stats データがありません。")
                print(f"   → レスポンスキー: {list(body.keys())}")
                print("   → Cookieが無効か、ログインセッションが切れている可能性があります。")
                print("\n💡 対処法:")
                print("   1. ブラウザでnote.comにログイン")
                print("   2. DevTools(F12) → Network → 任意のリクエスト")
                print("   3. Request Headersの 'Cookie' をすべてコピー")
                print("   4. .env の NOTE_COOKIE にペースト")
                sys.exit(1)
    except HTTPError as e:
        print(f"🚨 認証チェック失敗: HTTP {e.code}")
        if e.code in (401, 403):
            print("   → Cookieが無効です。以下を確認してください:")
            print("   1. ブラウザでnote.comにログイン済みか")
            print("   2. DevToolsからCookieヘッダ全体をコピーしたか")
            print("   3. _note_session_v5 だけでなく、全Cookieが必要な場合があります")
        try:
            error_body = e.read().decode("utf-8")
            print(f"   → レスポンス: {error_body[:200]}")
        except Exception:
            pass
        sys.exit(1)
    except URLError as e:
        print(f"✗ 通信エラー: {e.reason}")
        sys.exit(1)


def fetch_api(path):
    """noteのAPIを叩く"""
    url = f"{BASE_URL}{path}"
    req = Request(url)
    req.add_header("Cookie", NOTE_COOKIE)
    req.add_header("User-Agent", "note-stats-tracker")

    try:
        with urlopen(req) as res:
            if res.status != 200:
                print(f"✗ HTTPエラー: {res.status}")
                sys.exit(1)
            return json.loads(res.read().decode("utf-8"))
    except HTTPError as e:
        if e.code in (401, 403):
            print(f"🚨 認証エラー({e.code}): Cookieが期限切れの可能性があります。")
            print("   → リポジトリのSecretsでNOTE_COOKIEを更新してください。")
        else:
            print(f"✗ HTTPエラー: {e.code}")
        sys.exit(1)
    except URLError as e:
        print(f"✗ 通信エラー: {e.reason}")
        sys.exit(1)


def fetch_all_articles():
    """全記事のデータを取得"""
    all_notes = []
    page = 1

    while True:
        print(f"  ページ {page} 取得中...")
        data = fetch_api(f"/api/v1/stats/pv?filter=all&page={page}&sort=pv")

        if "data" not in data or "note_stats" not in data["data"]:
            print("🚨 レスポンスにデータがありません。Cookieが無効な可能性があります。")
            sys.exit(1)

        stats = data["data"]
        all_notes.extend(stats["note_stats"])

        if stats.get("last_page", True):
            break

        page += 1
        time.sleep(1)  # API負荷軽減

    total_pv = stats.get("total_pv", 0)
    total_like = stats.get("total_like", 0)
    total_comment = stats.get("total_comment", 0)

    print(f"  → {len(all_notes)}記事取得完了（総PV: {total_pv}, 総スキ: {total_like}）")

    return all_notes, total_pv, total_like, total_comment


def fetch_follower_count():
    """フォロワー数を取得"""
    if not NOTE_USERNAME:
        print("⚠ NOTE_USERNAME が未設定です。フォロワー数取得をスキップします。")
        return None

    data = fetch_api(f"/api/v2/creators/{NOTE_USERNAME}")
    follower_count = data.get("data", {}).get("followerCount")
    if follower_count is not None:
        print(f"  → フォロワー数: {follower_count}")
    return follower_count


def load_dates_cache():
    """v3 APIの日時キャッシュを読み込む"""
    cache_path = os.path.join(DATA_DIR, "v3_dates_cache.json")
    if not os.path.exists(cache_path):
        return {}
    try:
        with open(cache_path, encoding="utf-8") as f:
            cache = json.load(f)
        # 旧形式（値が文字列）のキャッシュを新形式に変換
        migrated = {}
        for k, v in cache.items():
            if isinstance(v, str):
                migrated[k] = {"published_at": v, "created_at": "", "updated_at": "", "fetched_at": ""}
            else:
                migrated[k] = v
        return migrated
    except (json.JSONDecodeError, OSError):
        print("⚠ v3_dates_cache.json の読み込みに失敗。キャッシュを再構築します。")
        return {}


def save_dates_cache(cache):
    """v3 APIの日時キャッシュを保存する"""
    cache_path = os.path.join(DATA_DIR, "v3_dates_cache.json")
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def _is_cache_stale(entry, today_str):
    """キャッシュが7日以上古いか判定"""
    fetched_at = entry.get("fetched_at", "")
    if not fetched_at:
        return True
    try:
        fetched = datetime.strptime(fetched_at, "%Y-%m-%d")
        today = datetime.strptime(today_str, "%Y-%m-%d")
        return (today - fetched).days >= 7
    except ValueError:
        return True


def fetch_note_detail(note_key):
    """v3 APIから記事の日時情報を取得する（エラー時は空辞書を返す）"""
    url = f"{BASE_URL}/api/v3/notes/{note_key}"
    req = Request(url)
    req.add_header("Cookie", NOTE_COOKIE)
    req.add_header("User-Agent", "note-stats-tracker")

    try:
        with urlopen(req) as res:
            body = json.loads(res.read().decode("utf-8"))
            data = body.get("data", {})
            published_at = ""
            for key in ("published_at", "publish_at", "first_published_at"):
                if data.get(key):
                    published_at = data[key]
                    break
            return {
                "published_at": published_at,
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
            }
    except (HTTPError, URLError) as e:
        print(f"    ⚠ v3 API エラー ({note_key}): {e}")
        return {"published_at": "", "created_at": "", "updated_at": ""}


def _calc_age_days(today_str, published_at):
    """取得日とpublished_atの差分日数を計算"""
    if not published_at:
        return ""
    try:
        pub_date = datetime.fromisoformat(published_at).astimezone(JST).date()
        today_date = datetime.strptime(today_str, "%Y-%m-%d").date()
        return (today_date - pub_date).days
    except (ValueError, TypeError):
        return ""


def fetch_note_dates(articles, today_str):
    """全記事の日時情報を取得する（キャッシュ活用、7日経過で再取得）"""
    cache = load_dates_cache()
    fetched = 0

    for note in articles:
        note_key = note["key"]
        entry = cache.get(note_key)
        if entry and not _is_cache_stale(entry, today_str):
            note["published_at"] = entry["published_at"]
            note["created_at"] = entry["created_at"]
            note["updated_at"] = entry["updated_at"]
        else:
            dates = fetch_note_detail(note_key)
            note["published_at"] = dates["published_at"]
            note["created_at"] = dates["created_at"]
            note["updated_at"] = dates["updated_at"]
            cache[note_key] = {**dates, "fetched_at": today_str}
            fetched += 1
            if fetched % 10 == 0:
                print(f"    {fetched}件取得済み...")
            time.sleep(0.2)
        note["age_days"] = _calc_age_days(today_str, note["published_at"])

    cached = len(articles) - fetched
    print(f"  → {len(articles)}記事中 {fetched}件をv3 APIから取得（{cached}件はキャッシュ）")

    os.makedirs(DATA_DIR, exist_ok=True)
    save_dates_cache(cache)
    return articles


def _remove_rows_by_date(filepath, date_str):
    """CSVファイルから指定日付の行を除去し、残りの行を返す"""
    if not os.path.exists(filepath):
        return [], None
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = list(csv.reader(f))
    if not reader:
        return [], None
    header = reader[0]
    kept = [row for row in reader[1:] if row[0] != date_str]
    removed = len(reader) - 1 - len(kept)
    if removed > 0:
        print(f"  → {date_str} の既存データ{removed}行を上書きします")
    return kept, header


def save_articles_csv(today, articles):
    """記事データをCSVに保存（同日データは上書き）"""
    filepath = os.path.join(DATA_DIR, "articles.csv")
    new_header = ["date", "note_id", "key", "title", "published_at", "created_at", "updated_at",
                  "age_days", "read_count", "like_count", "comment_count"]
    existing, old_header = _remove_rows_by_date(filepath, today)

    # 既存データの列順が異なる場合は新ヘッダで書き直す（既存行は列数が合わない可能性があるので破棄しない）
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(new_header)
        for row in existing:
            writer.writerow(row)
        for note in articles:
            writer.writerow([
                today,
                note["id"],
                note["key"],
                note["name"],
                note.get("published_at", ""),
                note.get("created_at", ""),
                note.get("updated_at", ""),
                note.get("age_days", ""),
                note["read_count"],
                note["like_count"],
                note.get("comment_count", 0),
            ])

    print(f"  → {filepath} に{len(articles)}行書き込み")


def save_daily_summary_csv(today, total_pv, total_like, total_comment, article_count, follower_count):
    """日次サマリーをCSVに保存（同日データは上書き）"""
    filepath = os.path.join(DATA_DIR, "daily_summary.csv")
    existing, header = _remove_rows_by_date(filepath, today)
    if header is None:
        header = ["date", "article_count", "total_pv", "total_like", "total_comment", "follower_count"]

    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for row in existing:
            writer.writerow(row)
        writer.writerow([
            today,
            article_count,
            total_pv,
            total_like,
            total_comment,
            follower_count if follower_count is not None else "",
        ])

    print(f"  → {filepath} に書き込み")


def main():
    print(f"=== note-stats-tracker ===")
    today = get_today_jst()
    print(f"日付: {today}")

    # Cookie検証
    validate_cookie()

    # Cookie期限チェック
    check_cookie_expiry()

    # 認証チェック（stats APIにアクセスできるか事前確認）
    verify_auth()

    # 記事データ取得
    print("\n📊 記事データ取得中...")
    articles, total_pv, total_like, total_comment = fetch_all_articles()

    # 日時情報取得（v3 API）
    print("\n📅 日時情報（published_at等）取得中...")
    articles = fetch_note_dates(articles, today)

    # フォロワー数取得
    print("\n👥 フォロワー数取得中...")
    follower_count = fetch_follower_count()

    # データ保存
    os.makedirs(DATA_DIR, exist_ok=True)

    print("\n💾 データ保存中...")
    save_articles_csv(today, articles)
    save_daily_summary_csv(today, total_pv, total_like, total_comment, len(articles), follower_count)

    # サマリー表示
    print(f"\n=== 完了 ===")
    print(f"記事数: {len(articles)}")
    print(f"総PV: {total_pv}")
    print(f"総スキ: {total_like}")
    if follower_count is not None:
        print(f"フォロワー: {follower_count}")


if __name__ == "__main__":
    main()
