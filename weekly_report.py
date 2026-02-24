#!/usr/bin/env python3
"""
週次レポート自動生成スクリプト

ダッシュボードチェックリスト（週末チェック #4〜#8）に対応した
Markdownレポートを生成する。

使い方:
  python weekly_report.py --week 2026-02-17
  python weekly_report.py --week 2026-02-17 --articles data/articles.csv --categories data/article_categories.csv
  python weekly_report.py --week 2026-02-17 --out reports/

対象週: 指定した月曜日から日曜日まで（月〜日）
出力: weekly-report-YYYY-MM-DD.md（月曜日の日付）
"""

import argparse
import csv
import io
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path


# === 定数 ===

CATEGORY_NAMES = {
    "A": "設計思想",
    "B": "試行錯誤",
    "C": "ハウツー",
    "D": "振り返り",
    "E": "キャラ系",
    "F": "初期日記",
    "G": "特別枠",
}

CATEGORY_ORDER = ["A", "B", "C", "D", "E", "F", "G"]

# 月間の理想バランス（チェックリスト #10より）
MONTHLY_IDEAL = {
    "A": (2, 3),
    "B": (5, 8),
    "C": (3, 4),
    "D": (4, 4),
    "E": (1, 2),
    "G": (0, 1),
}

WEEKDAY_JA = ["月", "火", "水", "木", "金", "土", "日"]


# === データ読み込み ===

def load_articles(path: str) -> list[dict]:
    """articles.csv を読み込む。日次スナップショット形式。"""
    rows = []
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            row["read_count"] = int(row["read_count"])
            row["like_count"] = int(row["like_count"])
            row["comment_count"] = int(row["comment_count"])
            rows.append(row)
    return rows


def load_categories(path: str) -> dict:
    """article_categories.csv を読み込み、key -> {number, category, title, date} のdictを返す。"""
    cat_map = {}
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = row["key"].strip()
            cat_map[key] = {
                "number": row["article_number"].strip(),
                "category": row["category"].strip(),
                "title": row["title"].strip(),
                "published_date": row.get("published_date", "").strip(),
            }
    return cat_map


def load_daily_summary(path: str) -> list[dict]:
    """daily_summary.csv を読み込む。"""
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


# === 最新スナップショットの取得 ===

def get_latest_snapshot(articles: list[dict], as_of_date: str = None) -> dict:
    """
    各記事の最新スナップショットを取得。
    as_of_date が指定されていれば、その日付以前の最新データを使う。
    戻り値: key -> {read_count, like_count, comment_count, title, ...}
    """
    latest = {}
    for row in articles:
        if as_of_date and row["date"] > as_of_date:
            continue
        key = row["key"]
        if key not in latest or row["date"] >= latest[key]["date"]:
            latest[key] = row
    return latest


# === 週の記事を特定 ===

def get_week_articles(cat_map: dict, week_start: str, week_end: str) -> list[dict]:
    """対象週に公開された記事を返す。"""
    week_arts = []
    for key, info in cat_map.items():
        pub = info["published_date"]
        if pub and week_start <= pub <= week_end:
            week_arts.append({**info, "key": key})
    # article_number でソート（preなど非数値は末尾）
    def sort_key(x):
        try:
            return (0, int(x["number"]))
        except ValueError:
            return (1, x["number"])
    week_arts.sort(key=sort_key)
    return week_arts


# === η計算 ===

def calc_eta(read_count: int, like_count: int) -> float | None:
    if read_count == 0:
        return None
    return like_count / read_count


# === レポート生成 ===

def generate_report(
    week_start_str: str,
    articles: list[dict],
    cat_map: dict,
    daily_summary: list[dict],
) -> str:
    week_start = datetime.strptime(week_start_str, "%Y-%m-%d")
    week_end = week_start + timedelta(days=6)
    week_end_str = week_end.strftime("%Y-%m-%d")

    # 最新データ日を特定
    all_dates = sorted(set(r["date"] for r in articles))
    # 対象週末以前の最新データ日
    valid_dates = [d for d in all_dates if d <= week_end_str]
    if not valid_dates:
        # 週末以後のデータしかない場合は全データの最新を使う
        data_date = all_dates[-1] if all_dates else week_end_str
    else:
        data_date = valid_dates[-1]

    snapshot = get_latest_snapshot(articles, data_date)
    week_arts = get_week_articles(cat_map, week_start_str, week_end_str)

    lines = []
    lines.append(f"# 週次レポート {week_start_str}〜{week_end_str}")
    lines.append(f"")
    lines.append(f"生成日時: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"データ基準日: {data_date}")
    lines.append("")

    # --- #4: カテゴリバランス ---
    lines.append("---")
    lines.append("")
    lines.append("## 4. 今週のカテゴリバランス")
    lines.append("")

    if not week_arts:
        lines.append("今週の公開記事: なし（article_categories.csvに対象週の記事がありません）")
        lines.append("")
    else:
        cat_count = Counter(a["category"] for a in week_arts)
        ab_count = cat_count.get("A", 0) + cat_count.get("B", 0)

        lines.append(f"公開記事数: **{len(week_arts)}本**")
        lines.append("")

        # テーブル
        lines.append("| # | カテゴリ | タイトル | 公開日 |")
        lines.append("|---|----------|---------|--------|")
        for a in week_arts:
            cat_label = f"{a['category']}({CATEGORY_NAMES.get(a['category'], '?')})"
            dow = WEEKDAY_JA[datetime.strptime(a["published_date"], "%Y-%m-%d").weekday()]
            lines.append(f"| {a['number']} | {cat_label} | {a['title']} | {a['published_date']}({dow}) |")
        lines.append("")

        # カテゴリ集計
        lines.append("カテゴリ内訳: " + "　".join(
            f"**{c}**: {cat_count.get(c, 0)}本" for c in CATEGORY_ORDER if cat_count.get(c, 0) > 0
        ))
        lines.append("")

        # 判定
        if ab_count >= 2:
            lines.append(f"✅ A+B = {ab_count}本（一次情報ゾーン維持）")
        else:
            lines.append(f"⚠️ A+B = {ab_count}本（2本未満。来週はA or Bを増やす）")

        cd_count = cat_count.get("C", 0) + cat_count.get("D", 0)
        if cd_count > ab_count and ab_count < 2:
            lines.append(f"⚠️ C+D = {cd_count}本 > A+B。ハウツー・振り返りに偏り気味")

        e_count = cat_count.get("E", 0)
        if e_count > 2:
            lines.append(f"📝 E = {e_count}本。キャラ系が多め（月1〜2本が目安）")

    lines.append("")

    # --- #5: カテゴリ別η序列 ---
    lines.append("---")
    lines.append("")
    lines.append("## 5. カテゴリ別η（全記事ベース）")
    lines.append("")

    # 全記事のηをカテゴリ別に集計
    cat_etas = defaultdict(list)
    for key, snap in snapshot.items():
        if key in cat_map:
            cat = cat_map[key]["category"]
            eta = calc_eta(snap["read_count"], snap["like_count"])
            if eta is not None:
                cat_etas[cat].append(eta)

    lines.append("| カテゴリ | 記事数 | 平均η | 中央値η | 仮説序列 |")
    lines.append("|----------|--------|-------|---------|----------|")

    cat_avg = {}
    for cat in CATEGORY_ORDER:
        etas = cat_etas.get(cat, [])
        if not etas:
            lines.append(f"| {cat}({CATEGORY_NAMES.get(cat, '')}) | 0 | - | - | |")
            continue
        avg = sum(etas) / len(etas)
        med = sorted(etas)[len(etas) // 2]
        cat_avg[cat] = avg
        lines.append(
            f"| {cat}({CATEGORY_NAMES.get(cat, '')}) | {len(etas)} | "
            f"{avg:.1%} | {med:.1%} | |"
        )
    lines.append("")

    # 序列チェック（A > B > C,D > E）
    def check_order(higher, lower):
        if higher in cat_avg and lower in cat_avg:
            return cat_avg[higher] >= cat_avg[lower]
        return None  # データ不足

    order_checks = [
        ("A", "B"),
        ("B", "C"),
        ("B", "D"),
        ("C", "E"),
        ("D", "E"),
    ]

    violations = []
    for h, l in order_checks:
        result = check_order(h, l)
        if result is False:
            violations.append(
                f"⚠️ {h}({cat_avg.get(h, 0):.1%}) < {l}({cat_avg.get(l, 0):.1%})"
            )

    if not violations:
        lines.append("✅ 仮説序列（A > B > C・D > E）は維持")
    else:
        lines.append("序列の崩れ:")
        for v in violations:
            lines.append(f"  {v}")
    lines.append("")

    # --- #6: スキ率ランキング TOP20 ---
    lines.append("---")
    lines.append("")
    lines.append("## 6. スキ率ランキング TOP20")
    lines.append("")

    # 全記事のηランキング
    eta_ranking = []
    for key, snap in snapshot.items():
        eta = calc_eta(snap["read_count"], snap["like_count"])
        if eta is not None and snap["read_count"] >= 10:  # 最低PVフィルタ
            cat_info = cat_map.get(key, {})
            eta_ranking.append({
                "key": key,
                "title": snap.get("title", cat_info.get("title", "?")),
                "number": cat_info.get("number", "?"),
                "category": cat_info.get("category", "?"),
                "eta": eta,
                "read_count": snap["read_count"],
                "like_count": snap["like_count"],
            })

    eta_ranking.sort(key=lambda x: x["eta"], reverse=True)
    top20 = eta_ranking[:20]

    lines.append("| 順位 | # | Cat | η | PV | スキ | タイトル |")
    lines.append("|------|---|-----|---|-----|------|---------|")
    for i, r in enumerate(top20, 1):
        lines.append(
            f"| {i} | {r['number']} | {r['category']} | "
            f"{r['eta']:.1%} | {r['read_count']} | {r['like_count']} | "
            f"{r['title'][:40]} |"
        )
    lines.append("")

    # TOP10のカテゴリ分布
    top10_cats = Counter(r["category"] for r in top20[:10])
    lines.append("TOP10カテゴリ分布: " + "　".join(
        f"**{c}**: {n}本" for c, n in sorted(top10_cats.items())
    ))

    ab_in_top10 = top10_cats.get("A", 0) + top10_cats.get("B", 0)
    cd_in_top10 = top10_cats.get("C", 0) + top10_cats.get("D", 0)
    e_in_top10 = top10_cats.get("E", 0)

    if ab_in_top10 >= 5:
        lines.append("✅ TOP10にA・Bが多い → 仮説通り")
    elif cd_in_top10 > ab_in_top10:
        lines.append("📝 TOP10にC・Dが多い → 実用系が刺さっている時期。「なぜ」を深掘りするチャンス")
    if e_in_top10 >= 2:
        lines.append("📝 Eがランクイン → ファン層が育っている兆候")
    lines.append("")

    # --- #7: PV×スキのカテゴリ別ゾーン ---
    lines.append("---")
    lines.append("")
    lines.append("## 7. PV×スキ カテゴリ別ゾーン")
    lines.append("")

    # PVとスキの中央値を基準に4象限に分ける
    all_pvs = [s["read_count"] for s in snapshot.values() if s["read_count"] > 0]
    all_likes = [s["like_count"] for s in snapshot.values()]

    if all_pvs:
        pv_median = sorted(all_pvs)[len(all_pvs) // 2]
        like_median = sorted(all_likes)[len(all_likes) // 2]

        zones = {"右上(高PV高スキ)": [], "右下(高PV低スキ)": [], "左上(低PV高スキ)": [], "左下(低PV低スキ)": []}
        for key, snap in snapshot.items():
            if key not in cat_map:
                continue
            cat = cat_map[key]["category"]
            pv = snap["read_count"]
            like = snap["like_count"]
            if pv >= pv_median and like >= like_median:
                zone = "右上(高PV高スキ)"
            elif pv >= pv_median and like < like_median:
                zone = "右下(高PV低スキ)"
            elif pv < pv_median and like >= like_median:
                zone = "左上(低PV高スキ)"
            else:
                zone = "左下(低PV低スキ)"
            zones[zone].append(cat)

        lines.append(f"基準: PV中央値={pv_median}　スキ中央値={like_median}")
        lines.append("")

        for zone_name, cats in zones.items():
            cat_dist = Counter(cats)
            dist_str = "　".join(f"{c}:{n}" for c, n in sorted(cat_dist.items()))
            lines.append(f"**{zone_name}**: {dist_str}")

        # A・Bが左下にある記事を警告
        lines.append("")
        ab_low = []
        for key, snap in snapshot.items():
            if key not in cat_map:
                continue
            cat = cat_map[key]["category"]
            if cat in ("A", "B") and snap["read_count"] < pv_median and snap["like_count"] < like_median:
                ab_low.append(f"  - #{cat_map[key]['number']} {cat_map[key]['title'][:35]}（PV:{snap['read_count']} スキ:{snap['like_count']}）")

        if ab_low:
            lines.append("⚠️ A・Bで左下ゾーンの記事（タイトル or テーマ選びの課題）:")
            for line in ab_low[:5]:
                lines.append(line)
        else:
            lines.append("✅ A・Bの記事は左下ゾーンに集中していない")
    lines.append("")

    # --- #8: A・B記事の伸び傾向 ---
    lines.append("---")
    lines.append("")
    lines.append("## 8. A・B記事の伸び傾向（初日 vs 最新）")
    lines.append("")

    # 各A・B記事について、最も古いスナップショットと最新を比較
    ab_keys = [key for key, info in cat_map.items() if info["category"] in ("A", "B")]

    ab_growth = []
    for key in ab_keys:
        key_rows = sorted(
            [r for r in articles if r["key"] == key],
            key=lambda x: x["date"]
        )
        if len(key_rows) < 2:
            continue
        first = key_rows[0]
        last = key_rows[-1]
        pv_growth = last["read_count"] - first["read_count"]
        like_growth = last["like_count"] - first["like_count"]
        days = (datetime.strptime(last["date"], "%Y-%m-%d") - datetime.strptime(first["date"], "%Y-%m-%d")).days
        if days == 0:
            continue
        ab_growth.append({
            "number": cat_map[key]["number"],
            "title": cat_map[key]["title"],
            "category": cat_map[key]["category"],
            "pv_growth": pv_growth,
            "like_growth": like_growth,
            "days": days,
            "pv_per_day": pv_growth / days,
            "first_pv": first["read_count"],
            "last_pv": last["read_count"],
        })

    ab_growth.sort(key=lambda x: x["pv_per_day"], reverse=True)

    if ab_growth:
        lines.append("| # | Cat | PV増分 | 日数 | PV/日 | 傾向 | タイトル |")
        lines.append("|---|-----|--------|------|-------|------|---------|")
        for g in ab_growth[:15]:
            trend = "📈" if g["pv_per_day"] >= 2.0 else "➡️" if g["pv_per_day"] >= 0.5 else "📉"
            lines.append(
                f"| {g['number']} | {g['category']} | +{g['pv_growth']} | "
                f"{g['days']}日 | {g['pv_per_day']:.1f} | {trend} | "
                f"{g['title'][:35]} |"
            )
        lines.append("")
        growing = [g for g in ab_growth if g["pv_per_day"] >= 2.0]
        flat = [g for g in ab_growth if g["pv_per_day"] < 0.5]
        if growing:
            lines.append(f"📈 ロングテール記事（PV/日≥2.0）: {len(growing)}本 → 一次情報の強さ")
        if flat:
            lines.append(f"📉 初日型記事（PV/日<0.5）: {len(flat)}本 → 構造化の見直し余地あり")
    else:
        lines.append("A・B記事のデータが2日分以上ありません。")
    lines.append("")

    # --- 月間カテゴリ比率（参考） ---
    lines.append("---")
    lines.append("")
    lines.append("## 参考: 直近30日のカテゴリ比率")
    lines.append("")

    month_start = (week_end - timedelta(days=29)).strftime("%Y-%m-%d")
    month_arts = [
        info for info in cat_map.values()
        if info["published_date"] and month_start <= info["published_date"] <= week_end_str
    ]
    month_cats = Counter(a["category"] for a in month_arts)

    lines.append(f"期間: {month_start}〜{week_end_str}（{len(month_arts)}本）")
    lines.append("")
    lines.append("| カテゴリ | 実績 | 理想（月間） | 判定 |")
    lines.append("|----------|------|-------------|------|")
    for cat in CATEGORY_ORDER:
        actual = month_cats.get(cat, 0)
        if cat in MONTHLY_IDEAL:
            lo, hi = MONTHLY_IDEAL[cat]
            if actual < lo:
                judge = "⚠️ 少ない"
            elif actual > hi:
                judge = "📝 多め"
            else:
                judge = "✅"
            lines.append(f"| {cat}({CATEGORY_NAMES[cat]}) | {actual} | {lo}〜{hi} | {judge} |")
        else:
            lines.append(f"| {cat}({CATEGORY_NAMES[cat]}) | {actual} | - | |")
    lines.append("")

    # --- フォロワー推移（daily_summaryから） ---
    if daily_summary:
        lines.append("---")
        lines.append("")
        lines.append("## 参考: フォロワー推移")
        lines.append("")

        week_summaries = [
            d for d in daily_summary
            if week_start_str <= d["date"] <= week_end_str
        ]
        if week_summaries:
            first_f = int(week_summaries[0]["follower_count"])
            last_f = int(week_summaries[-1]["follower_count"])
            diff = last_f - first_f
            sign = "+" if diff >= 0 else ""
            lines.append(f"週初: {first_f} → 週末: {last_f}（{sign}{diff}）")
        else:
            # 週内のデータがない場合、前後の最近データを表示
            all_summaries = sorted(daily_summary, key=lambda x: x["date"])
            if all_summaries:
                latest = all_summaries[-1]
                lines.append(f"最新データ（{latest['date']}）: フォロワー {latest['follower_count']}")
        lines.append("")

    # --- アクションサマリー ---
    lines.append("---")
    lines.append("")
    lines.append("## アクション（来週の記事に向けて）")
    lines.append("")

    actions = []

    # カテゴリバランスからのアクション
    if week_arts:
        cat_count = Counter(a["category"] for a in week_arts)
        ab_count = cat_count.get("A", 0) + cat_count.get("B", 0)
        if ab_count < 2:
            actions.append("来週7本の中にA or Bを2本以上入れる")

    # η序列からのアクション
    if violations:
        actions.append("η序列が崩れている箇所あり → 該当カテゴリの直近記事を確認")

    # 月間バランスからのアクション
    for cat in ["A", "B"]:
        if cat in MONTHLY_IDEAL:
            lo, _ = MONTHLY_IDEAL[cat]
            if month_cats.get(cat, 0) < lo:
                actions.append(f"{cat}({CATEGORY_NAMES[cat]})が月間で不足気味 → 意識的に配置")

    if not actions:
        actions.append("現状の書き方を継続")

    for a in actions:
        lines.append(f"- {a}")
    lines.append("")

    return "\n".join(lines)


# === メイン ===

def main():
    parser = argparse.ArgumentParser(description="週次レポート生成")
    parser.add_argument(
        "--week", required=True,
        help="対象週の月曜日 (YYYY-MM-DD)"
    )
    parser.add_argument(
        "--articles", default="data/articles.csv",
        help="articles.csvのパス"
    )
    parser.add_argument(
        "--categories", default="data/article_categories.csv",
        help="article_categories.csvのパス"
    )
    parser.add_argument(
        "--daily", default="data/daily_summary.csv",
        help="daily_summary.csvのパス"
    )
    parser.add_argument(
        "--out", default="reports/",
        help="出力ディレクトリ"
    )
    args = parser.parse_args()

    # 日付バリデーション
    try:
        week_start = datetime.strptime(args.week, "%Y-%m-%d")
    except ValueError:
        print(f"エラー: --week は YYYY-MM-DD 形式で指定してください: {args.week}", file=sys.stderr)
        sys.exit(1)

    if week_start.weekday() != 0:
        print(f"警告: {args.week} は月曜日ではありません（{WEEKDAY_JA[week_start.weekday()]}曜日）。月曜日に調整します。")
        week_start = week_start - timedelta(days=week_start.weekday())
        print(f"調整後: {week_start.strftime('%Y-%m-%d')}")

    week_start_str = week_start.strftime("%Y-%m-%d")

    # データ読み込み
    articles = load_articles(args.articles)
    cat_map = load_categories(args.categories)
    daily_summary = load_daily_summary(args.daily)

    print(f"データ読み込み完了:")
    print(f"  articles.csv: {len(articles)}行")
    print(f"  article_categories.csv: {len(cat_map)}記事")
    print(f"  daily_summary.csv: {len(daily_summary)}行")
    print()

    # レポート生成
    report = generate_report(week_start_str, articles, cat_map, daily_summary)

    # 出力
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"weekly-report-{week_start_str}.md"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"レポート生成完了: {out_path}")
    print()
    print(report)


if __name__ == "__main__":
    main()
