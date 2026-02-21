"""
noteスキデータ蓄積スクリプト
記事ごとのスキ詳細（誰がいつスキしたか）をCSVに蓄積する
v3 likes APIは公開エンドポイント（認証不要）
"""

import os
import csv
import json
import time
import sys
from datetime import timezone, timedelta
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Windows環境でのUnicode出力対応
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_URL = "https://note.com"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
ARTICLES_CSV = os.path.join(DATA_DIR, "articles.csv")
LIKES_CSV = os.path.join(DATA_DIR, "likes.csv")

JST = timezone(timedelta(hours=9))

LIKES_API_SIZE = 50
SLEEP_BETWEEN_ARTICLES = 1.5
SLEEP_BETWEEN_PAGES = 1.0

LIKES_HEADER = ["note_key", "like_user_id", "like_username",
                "like_user_urlname", "liked_at", "follower_count"]


def fetch_likes_api(note_key, start=0, size=LIKES_API_SIZE):
    """1ページ分のスキデータを取得。エラー時はNone"""
    url = f"{BASE_URL}/api/v3/notes/{note_key}/likes?start={start}&size={size}"
    req = Request(url)
    req.add_header("Accept", "application/json, text/plain, */*")
    req.add_header("User-Agent", "Mozilla/5.0")
    req.add_header("Referer", "https://note.com/")

    try:
        with urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except HTTPError as e:
        print(f"  ⚠ API HTTPエラー ({note_key}, start={start}): {e.code}")
        return None
    except URLError as e:
        print(f"  ⚠ API通信エラー ({note_key}): {e.reason}")
        return None


def fetch_all_likes_for_article(note_key):
    """1記事の全スキを取得（ページネーション対応）
    注意: APIのis_last_pageは信頼できない（常にFalseを返す場合がある）
    like_countベースの終了判定 + 重複検知で安全に停止する
    """
    all_likes = []
    seen_ids = set()
    start = 0
    total_count = None

    while True:
        resp = fetch_likes_api(note_key, start)
        if resp is None:
            break

        data = resp.get("data", {})
        likes = data.get("likes", [])

        if total_count is None:
            total_count = data.get("extra_fields", {}).get("like_count", 0)

        if not likes:
            break

        new_in_page = 0
        for like in likes:
            user = like.get("user", {})
            user_id = str(user.get("id", ""))
            if user_id in seen_ids:
                continue
            seen_ids.add(user_id)
            new_in_page += 1
            all_likes.append({
                "note_key": note_key,
                "like_user_id": user_id,
                "like_username": user.get("nickname", ""),
                "like_user_urlname": user.get("urlname", ""),
                "liked_at": like.get("created_at", ""),
                "follower_count": user.get("follower_count", 0),
            })

        # 終了条件: 全件取得済み or ページ内で新規なし（APIが同じデータを返している）
        if len(all_likes) >= total_count or new_in_page == 0:
            break

        start += LIKES_API_SIZE
        time.sleep(SLEEP_BETWEEN_PAGES)

    if total_count is not None and len(all_likes) < total_count:
        print(f"    ⚠ {note_key}: {total_count}件中{len(all_likes)}件のみ取得（APIページネーション制限）")

    return all_likes


def load_existing_likes():
    """likes.csvから既存の(note_key, like_user_id)セットを構築"""
    if not os.path.exists(LIKES_CSV):
        return set(), 0

    existing = set()
    count = 0
    try:
        with open(LIKES_CSV, newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if header is None:
                return set(), 0
            for row in reader:
                if len(row) >= 2:
                    existing.add((row[0], row[1]))
                    count += 1
    except OSError as e:
        print(f"  ⚠ likes.csv読み込みエラー: {e}")
        return set(), 0

    return existing, count


def load_articles_csv():
    """articles.csvを読み、日付ごとの{note_key: like_count}を返す"""
    if not os.path.exists(ARTICLES_CSV):
        print("🚨 articles.csv が見つかりません")
        return {}, []

    with open(ARTICLES_CSV, newline="", encoding="utf-8") as f:
        reader = list(csv.reader(f))

    if len(reader) < 2:
        print("🚨 articles.csv にデータがありません")
        return {}, []

    header = reader[0]
    try:
        date_idx = header.index("date")
        key_idx = header.index("key")
        like_count_idx = header.index("like_count")
    except ValueError as e:
        print(f"🚨 articles.csv のヘッダーに必要なカラムがありません: {e}")
        return {}, []

    articles_by_date = {}
    for row in reader[1:]:
        if len(row) <= max(date_idx, key_idx, like_count_idx):
            continue
        date_str = row[date_idx]
        note_key = row[key_idx]
        try:
            like_count = int(row[like_count_idx])
        except ValueError:
            like_count = 0
        if date_str not in articles_by_date:
            articles_by_date[date_str] = {}
        articles_by_date[date_str][note_key] = like_count

    sorted_dates = sorted(articles_by_date.keys())
    return articles_by_date, sorted_dates


def find_articles_with_new_likes(articles_by_date, sorted_dates):
    """最新2日分を比較し、スキ増加した記事のnote_keyリストを返す"""
    if len(sorted_dates) < 2:
        return None  # ベースラインモードにフォールバック

    latest = sorted_dates[-1]
    previous = sorted_dates[-2]

    latest_data = articles_by_date[latest]
    previous_data = articles_by_date[previous]

    changed = []
    for note_key, like_count in latest_data.items():
        prev_count = previous_data.get(note_key, 0)
        if like_count > prev_count:
            changed.append(note_key)

    return changed


def append_likes_csv(new_likes):
    """新規スキをlikes.csvに追記"""
    if not new_likes:
        return

    file_exists = os.path.exists(LIKES_CSV)

    # ヘッダーのみのファイルかチェック
    write_header = not file_exists
    if file_exists:
        with open(LIKES_CSV, newline="", encoding="utf-8") as f:
            content = f.read().strip()
            if not content:
                write_header = True

    with open(LIKES_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if write_header:
            writer.writerow(LIKES_HEADER)
        for like in new_likes:
            writer.writerow([
                like["note_key"],
                like["like_user_id"],
                like["like_username"],
                like["like_user_urlname"],
                like["liked_at"],
                like["follower_count"],
            ])


def main():
    try:
        print("=== note likes collector ===")

        articles_by_date, sorted_dates = load_articles_csv()
        if not articles_by_date:
            print("記事データがないため終了します")
            return

        print(f"articles.csv: {len(sorted_dates)}日分のデータ（{sorted_dates[0]} 〜 {sorted_dates[-1]}）")

        existing_set, existing_count = load_existing_likes()
        baseline = existing_count == 0

        if baseline:
            # ベースラインモード: 全記事のスキを一括取得
            latest = sorted_dates[-1]
            all_keys = list(articles_by_date[latest].keys())
            print(f"\n初回ベースライン取得: {len(all_keys)}記事")

            all_new_likes = []
            for i, note_key in enumerate(all_keys, 1):
                likes = fetch_all_likes_for_article(note_key)
                new = [l for l in likes if (l["note_key"], l["like_user_id"]) not in existing_set]
                all_new_likes.extend(new)
                for l in new:
                    existing_set.add((l["note_key"], l["like_user_id"]))
                print(f"  {i}/{len(all_keys)} {note_key}: {len(likes)}件取得, {len(new)}件新規")
                if i < len(all_keys):
                    time.sleep(SLEEP_BETWEEN_ARTICLES)

            os.makedirs(DATA_DIR, exist_ok=True)
            append_likes_csv(all_new_likes)
            print(f"\n完了: {len(all_new_likes)}件のスキを記録")

        else:
            # 日次差分モード
            changed = find_articles_with_new_likes(articles_by_date, sorted_dates)

            if changed is None:
                # 日付が1つしかない場合はベースライン扱いだが既にデータあり→スキップ
                print("差分比較に必要な日付データが不足しています")
                return

            if not changed:
                print("\nスキ数の変化なし")
                return

            print(f"\nスキ増加: {len(changed)}記事を取得")

            all_new_likes = []
            for i, note_key in enumerate(changed, 1):
                likes = fetch_all_likes_for_article(note_key)
                new = [l for l in likes if (l["note_key"], l["like_user_id"]) not in existing_set]
                all_new_likes.extend(new)
                for l in new:
                    existing_set.add((l["note_key"], l["like_user_id"]))

                total = len(likes)
                added = len(new)
                print(f"  {i}/{len(changed)} {note_key}: {total}件中{added}件新規")

                if i < len(changed):
                    time.sleep(SLEEP_BETWEEN_ARTICLES)

            os.makedirs(DATA_DIR, exist_ok=True)
            append_likes_csv(all_new_likes)
            print(f"\n完了: 新規{len(all_new_likes)}件のスキを記録")

    except Exception as e:
        print(f"\nスキ取得中に予期しないエラー: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(0)


if __name__ == "__main__":
    main()
