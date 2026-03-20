"""
note記事の本文を取得してMarkdownで表示するスクリプト

使い方:
  python scripts/fetch_article.py https://note.com/ktcrs1107/n/n7f472192316e
  python scripts/fetch_article.py n7f472192316e
"""

import json
import re
import sys
from html.parser import HTMLParser
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class NoteHTMLToMarkdown(HTMLParser):
    """noteの記事HTMLをMarkdownに変換するパーサー"""

    def __init__(self):
        super().__init__()
        self.result = []
        self.current_tag = None
        self.in_heading = False
        self.heading_level = 0
        self.in_bold = False
        self.in_link = False
        self.link_href = ""
        self.link_text = ""
        self.in_list = False
        self.list_type = None  # "ul" or "ol"
        self.in_list_item = False
        self.list_counter = 0
        self.in_blockquote = False
        self.skip = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        if tag in ("script", "style", "table-of-contents"):
            self.skip = True
            return

        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.in_heading = True
            self.heading_level = int(tag[1])
            self.result.append("\n" + "#" * self.heading_level + " ")
        elif tag == "strong" or tag == "b":
            self.in_bold = True
            self.result.append("**")
        elif tag == "em" or tag == "i":
            self.result.append("*")
        elif tag == "a":
            self.in_link = True
            self.link_href = attrs_dict.get("href", "")
            self.link_text = ""
        elif tag == "br":
            self.result.append("\n")
        elif tag == "hr":
            self.result.append("\n---\n")
        elif tag == "p":
            self.result.append("\n")
        elif tag == "ul":
            self.in_list = True
            self.list_type = "ul"
            self.result.append("\n")
        elif tag == "ol":
            self.in_list = True
            self.list_type = "ol"
            self.list_counter = 0
            self.result.append("\n")
        elif tag == "li":
            self.in_list_item = True
            if self.list_type == "ol":
                self.list_counter += 1
                self.result.append(f"{self.list_counter}. ")
            else:
                self.result.append("- ")
        elif tag == "blockquote":
            self.in_blockquote = True
            self.result.append("\n> ")
        elif tag == "img":
            src = attrs_dict.get("src", "")
            alt = attrs_dict.get("alt", "")
            if src:
                self.result.append(f"\n![{alt}]({src})\n")
        elif tag == "code":
            self.result.append("`")
        elif tag == "pre":
            self.result.append("\n```\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "table-of-contents"):
            self.skip = False
            return

        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.in_heading = False
            self.result.append("\n")
        elif tag == "strong" or tag == "b":
            self.in_bold = False
            self.result.append("**")
        elif tag == "em" or tag == "i":
            self.result.append("*")
        elif tag == "a":
            self.in_link = False
            if self.link_href:
                self.result.append(f"[{self.link_text}]({self.link_href})")
            self.link_href = ""
            self.link_text = ""
        elif tag == "p":
            self.result.append("\n")
        elif tag == "ul" or tag == "ol":
            self.in_list = False
            self.list_type = None
            self.result.append("\n")
        elif tag == "li":
            self.in_list_item = False
            self.result.append("\n")
        elif tag == "blockquote":
            self.in_blockquote = False
            self.result.append("\n")
        elif tag == "code":
            self.result.append("`")
        elif tag == "pre":
            self.result.append("\n```\n")

    def handle_data(self, data):
        if self.skip:
            return
        if self.in_link:
            self.link_text += data
        else:
            if self.in_blockquote:
                data = data.replace("\n", "\n> ")
            self.result.append(data)

    def get_markdown(self):
        text = "".join(self.result)
        # 3つ以上の連続改行を2つに
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def extract_note_key(url_or_key):
    """URLまたはキーからnote_keyを抽出"""
    # フルURL
    match = re.search(r"/n/([a-zA-Z0-9]+)", url_or_key)
    if match:
        return match.group(1)
    # キーのみ
    if re.match(r"^[a-zA-Z0-9]+$", url_or_key):
        return url_or_key
    return None


def fetch_note_article(note_key):
    """note APIから記事データを取得"""
    url = f"https://note.com/api/v3/notes/{note_key}"
    req = Request(url)
    req.add_header("User-Agent", "note-stats-tracker")

    try:
        with urlopen(req) as res:
            return json.loads(res.read().decode("utf-8"))
    except HTTPError as e:
        print(f"エラー: HTTP {e.code}", file=sys.stderr)
        sys.exit(1)
    except URLError as e:
        print(f"エラー: {e.reason}", file=sys.stderr)
        sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print("使い方: python scripts/fetch_article.py <URL or note_key>", file=sys.stderr)
        sys.exit(1)

    note_key = extract_note_key(sys.argv[1])
    if not note_key:
        print(f"エラー: 無効なURL/キーです: {sys.argv[1]}", file=sys.stderr)
        sys.exit(1)

    data = fetch_note_article(note_key)
    note = data.get("data", {})

    title = note.get("name", "")
    body_html = note.get("body", "")
    user = note.get("user", {})
    author = user.get("nickname", "")
    urlname = user.get("urlname", "")
    published_at = note.get("published_at", "")
    like_count = note.get("like_count", 0)

    # HTML → Markdown変換
    parser = NoteHTMLToMarkdown()
    parser.feed(body_html)
    body_md = parser.get_markdown()

    # 出力
    print(f"# {title}")
    print(f"\n**著者**: {author} (@{urlname})")
    print(f"**公開日**: {published_at}")
    print(f"**スキ**: {like_count}")
    print(f"\n---\n")
    print(body_md)


if __name__ == "__main__":
    main()
