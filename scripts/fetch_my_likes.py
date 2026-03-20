"""
自分のスキ活動ログ蓄積スクリプト
自分がスキした記事とそのタイミングをCSVに蓄積する

仕組み:
  1. /api/v1/notes/liked で自分がスキした記事一覧を取得（Cookie必要）
  2. 各記事の /api/v3/notes/{key}/likes から自分のcreated_atを取得（CFプロキシ、認証不要）
  3. data/my_likes.csv に逐次追記

使い方:
  python scripts/fetch_my_likes.py
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

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def load_dotenv():
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
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


load_dotenv()

NOTE_COOKIE = os.environ.get("NOTE_COOKIE", "")
NOTE_USERNAME = os.environ.get("NOTE_USERNAME", "hasyamo")
PROXY_URL = "https://falling-mouse-736b.hasyamo.workers.dev/"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
MY_LIKES_CSV = os.path.join(DATA_DIR, "my_likes.csv")

HEADER = ["liked_at", "note_key", "author_urlname", "author_name", "article_title"]

SLEEP_BETWEEN_PAGES = 1.0
SLEEP_BETWEEN_ARTICLES = 0.5
CONSECUTIVE_EXISTING_LIMIT = 20


def log(msg, logfile=None):
    print(msg)
    if logfile:
        logfile.write(msg + "\n")
        logfile.flush()


def fetch_liked_notes(page=1):
    url = f"https://note.com/api/v1/notes/liked?note_intro_only=true&page={page}"
    req = Request(url)
    req.add_header("Cookie", NOTE_COOKIE)
    req.add_header("User-Agent", "Mozilla/5.0")
    try:
        with urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except (HTTPError, URLError) as e:
        return None


def fetch_my_like_timestamp(note_key):
    page = 1
    while True:
        path = f"/api/v3/notes/{note_key}/likes?page={page}"
        url = f"{PROXY_URL}?path={path}"
        req = Request(url)
        req.add_header("User-Agent", "Mozilla/5.0")
        try:
            with urlopen(req, timeout=30) as res:
                resp = json.loads(res.read().decode("utf-8"))
        except (HTTPError, URLError) as e:
            return None

        likes = resp.get("data", {}).get("likes", [])
        for like in likes:
            user = like.get("user", {})
            if user.get("urlname") == NOTE_USERNAME:
                return like.get("created_at", "")

        is_last = resp.get("is_last_page", True)
        if is_last or not likes:
            break

        page += 1
        time.sleep(SLEEP_BETWEEN_PAGES)

    return None


def load_existing_keys():
    if not os.path.exists(MY_LIKES_CSV):
        return set()
    existing = set()
    try:
        with open(MY_LIKES_CSV, newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                if len(row) >= 2:
                    existing.add(row[1])
    except OSError:
        return set()
    return existing


def ensure_csv_header():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(MY_LIKES_CSV):
        with open(MY_LIKES_CSV, "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(HEADER)
    else:
        with open(MY_LIKES_CSV, newline="", encoding="utf-8") as f:
            content = f.read().strip()
            if not content:
                with open(MY_LIKES_CSV, "w", newline="", encoding="utf-8") as f2:
                    csv.writer(f2).writerow(HEADER)


def append_one_like(like):
    with open(MY_LIKES_CSV, "a", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow([
            like["liked_at"],
            like["note_key"],
            like["author_urlname"],
            like["author_name"],
            like["article_title"],
        ])


def main():
    os.makedirs(LOG_DIR, exist_ok=True)
    log_path = os.path.join(LOG_DIR, f"fetch_my_likes_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")
    logfile = open(log_path, "w", encoding="utf-8")

    log("=== my-likes collector ===", logfile)

    if not NOTE_COOKIE:
        log("🚨 NOTE_COOKIE が未設定です", logfile)
        logfile.close()
        sys.exit(1)

    existing_keys = load_existing_keys()
    log(f"既存データ: {len(existing_keys)}件", logfile)

    ensure_csv_header()

    page = 1
    new_count = 0
    skip_count = 0
    consecutive_existing = 0
    done = False

    while not done:
        log(f"\n  ページ {page} 取得中...", logfile)
        resp = fetch_liked_notes(page)
        if resp is None:
            log("  ⚠ liked API エラー。停止。", logfile)
            break

        notes = resp.get("data", {}).get("notes", [])
        is_last = resp.get("data", {}).get("last_page", True)

        if not notes:
            log("  → 記事なし。停止。", logfile)
            break

        for note in notes:
            key = note.get("key", "")
            if key in existing_keys:
                consecutive_existing += 1
                skip_count += 1
                if consecutive_existing >= CONSECUTIVE_EXISTING_LIMIT:
                    log(f"  → 既存データに到達（{consecutive_existing}件連続）。停止。", logfile)
                    done = True
                    break
                continue

            consecutive_existing = 0
            user = note.get("user", {})
            title = note.get("name", "")
            author_urlname = user.get("urlname", "")
            author_name = user.get("nickname", "")

            liked_at = fetch_my_like_timestamp(key)
            if liked_at:
                like_data = {
                    "liked_at": liked_at,
                    "note_key": key,
                    "author_urlname": author_urlname,
                    "author_name": author_name,
                    "article_title": title,
                }
                append_one_like(like_data)
                existing_keys.add(key)
                new_count += 1
                log(f"  {new_count} {key}: {liked_at[:16]} | {author_name}", logfile)
            else:
                log(f"  {new_count + 1} {key}: スキ日時取得失敗 | {author_name}", logfile)

            time.sleep(SLEEP_BETWEEN_ARTICLES)

        if is_last:
            log("  → 最終ページ。停止。", logfile)
            break

        page += 1
        time.sleep(SLEEP_BETWEEN_PAGES)

    log(f"\n=== 完了 ===", logfile)
    log(f"新規: {new_count}件", logfile)
    log(f"スキップ: {skip_count}件", logfile)
    log(f"CSV: {MY_LIKES_CSV}", logfile)
    log(f"ログ: {log_path}", logfile)

    logfile.close()


if __name__ == "__main__":
    main()
