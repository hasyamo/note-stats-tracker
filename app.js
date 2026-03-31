// ===== State =====
let articlesData = [];
let dailySummary = [];
let latestSnapshot = [];
let summaryData = []; // from daily_summary.csv
let categoryMap = {}; // key → category
let categoryTitleMap = {}; // key → {category, title, published_date}
let likesData = []; // from likes.csv
let myLikesData = []; // from my_likes.csv
let selectedDateIndex = -1; // -1 = uninitialized, set to last index after load

// ===== Date Utilities =====
// All date strings are YYYY-MM-DD. Avoid timezone issues by parsing as local date.

function parseDate(dateStr) {
  // Parse "YYYY-MM-DD" as local date (no timezone shift)
  const p = dateStr.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function formatDate(d) {
  // Date object → "YYYY-MM-DD"
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getCharIdx(dateStr) {
  // "YYYY-MM-DD" → character index (0=月, 1=火, ..., 6=日)
  const dow = parseDate(dateStr).getDay(); // 0=Sun
  return dow === 0 ? 6 : dow - 1;
}

function getDayLabel(dateStr) {
  // "YYYY-MM-DD" → "YYYY-MM-DD（月）"
  return dateStr + '（' + DAYS_JA[getCharIdx(dateStr)] + '）';
}

function getMondayOf(dateStr) {
  // "YYYY-MM-DD" → Monday of that week as "YYYY-MM-DD"
  const d = parseDate(dateStr);
  const dow = d.getDay();
  const offset = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - offset);
  return formatDate(d);
}

function getTodayJST() {
  // Create date string in JST regardless of local timezone
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const jst = new Date(utc + 9 * 3600000);
  return formatDate(jst);
}

// ===== Excluded Articles (not part of ohayo-kanojo) =====
const EXCLUDED_KEYS = ['nba6e79f62183'];

// ===== Character Constants =====
const DAYS_JA = ['月','火','水','木','金','土','日'];
const CHIBI_FILES = ['mon','tue','wed','thu','fri','sat','sun'];
const CHIBI_NAMES = ['月子','陽','しずく','凛華','るな','まひる','日和'];
const CHIBI_COLORS = ['#1e3a5f','#f97316','#60a5fa','#9b2335','#10b981','#a78bfa','#f9a8d4'];
const TODAY_IDX = getCharIdx(getTodayJST());
const TODAY_FILE = CHIBI_FILES[TODAY_IDX];
const TODAY_NAME = CHIBI_NAMES[TODAY_IDX];

// Set favicon to today's character
document.getElementById('favicon').href = `images/favicon/eyes-${TODAY_FILE}.png`;

function noteURL(key) { return 'https://note.com/hasyamo/n/' + key; }

function getCategoryAvgs() {
  const stats = {};
  latestSnapshot.forEach(a => {
    const c = a.category;
    if (!c || c === '?') return;
    if (!stats[c]) stats[c] = { totalPV: 0, totalLike: 0, count: 0 };
    stats[c].totalPV += a.read_count;
    stats[c].totalLike += a.like_count;
    stats[c].count++;
  });
  const avgs = {};
  Object.entries(stats).forEach(([c, s]) => {
    avgs[c] = {
      avgPV: s.count > 0 ? Math.round(s.totalPV / s.count) : 0,
      avgLike: s.count > 0 ? Math.round(s.totalLike / s.count) : 0,
    };
  });
  return avgs;
}

function getDataDateLabel(dataDate) {
  const today = getTodayJST();
  const todayD = parseDate(today);
  const dataD = parseDate(dataDate);
  const diffDays = Math.round((todayD - dataD) / 86400000);
  if (diffDays === 0) return '今日';
  if (diffDays === 1) return '前日';
  if (diffDays === 2) return '前々日';
  return `${diffDays}日前`;
}

function getGirlLine(section) {
  return getGirlLineForIdx(section, TODAY_IDX);
}

function getGirlLineForIdx(section, idx) {
  if (typeof GIRL_DYNAMIC !== 'undefined' && GIRL_DYNAMIC[section] && typeof _dailyRenderData !== 'undefined') {
    try {
      for (const rule of GIRL_DYNAMIC[section]) {
        if (rule.cond(_dailyRenderData)) {
          const line = rule.lines[idx];
          return typeof line === 'function' ? line(_dailyRenderData) : line;
        }
      }
    } catch(e) { /* fallback to static lines */ }
  }
  const fallback = (typeof GIRL_LINES !== 'undefined' && GIRL_LINES[section]) ? GIRL_LINES[section][idx] : '';
  return fallback || '';
}

let _dailyRenderData = {};

// ===== Category Meta =====
const CATEGORY_META = {
  A: { name: '設計思想', color: '#00d4ff', primary: true },
  B: { name: '試行錯誤', color: '#ff3d8e', primary: true },
  C: { name: 'ハウツー', color: '#ffb020', primary: false },
  D: { name: '振り返り', color: '#00e676', primary: false },
  E: { name: 'キャラ系', color: '#a855f7', primary: false },
  F: { name: '初期日記', color: '#555570', primary: false },
  G: { name: '特別枠',  color: '#888888', primary: false },
};

const MONTHLY_IDEAL = { A: [1,2], B: [5,7], C: [2,3], D: [5,6], E: [2,3], G: [0,1] };

function getCategoryColor(cat) {
  return (CATEGORY_META[cat] || {}).color || '#555570';
}

function getCategoryName(cat) {
  return (CATEGORY_META[cat] || {}).name || '不明';
}

// ===== CSV Parser =====
function parseCSV(text) {
  const lines = text.trim().replace(/\r/g, '').split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { vals.push(current); current = ''; }
      else { current += ch; }
    }
    vals.push(current);
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (vals[i] || '').trim());
    return obj;
  });
}

// ===== Data Processing =====
function processData(rows) {
  articlesData = rows
    .filter(r => !EXCLUDED_KEYS.includes(r.key))
    .map(r => ({
      date: r.date,
      note_id: r.note_id,
      key: r.key,
      title: r.title || '',
      published_at: r.published_at || '',
      age_days: parseInt(r.age_days) || 0,
      read_count: parseInt(r.read_count) || 0,
      like_count: parseInt(r.like_count) || 0,
      comment_count: parseInt(r.comment_count) || 0,
      category: categoryMap[r.key] || '?',
    }));

  // Get unique dates sorted
  const dates = [...new Set(articlesData.map(a => a.date))].sort();

  // Latest snapshot (most recent date)
  const latestDate = dates[dates.length - 1];
  latestSnapshot = articlesData.filter(a => a.date === latestDate && !EXCLUDED_KEYS.includes(a.key));

  // Daily summary from each date
  dailySummary = dates.map(d => {
    const dayArticles = articlesData.filter(a => a.date === d);
    const totalPV = dayArticles.reduce((s, a) => s + a.read_count, 0);
    const totalLikes = dayArticles.reduce((s, a) => s + a.like_count, 0);
    const totalComments = dayArticles.reduce((s, a) => s + a.comment_count, 0);
    return { date: d, totalPV, totalLikes, totalComments, articleCount: dayArticles.length };
  });

  const src = summaryData.length > 0 ? summaryData : dailySummary;
  selectedDateIndex = src.length - 1;
  updateKPI();
  renderDailyTab();
  renderWeeklyTab();
  // Deep Dive: only render if tab is visible
  const ddTab = document.getElementById('tabDeepdive');
  if (ddTab && ddTab.classList.contains('active')) {
    renderDeepDive();
  }
  updateHeader(dates);
}

// ===== KPI =====
function updateKPI() {
  // Use summaryData if available, otherwise fall back to articles-derived summary
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  const idx = selectedDateIndex >= 0 ? selectedDateIndex : src.length - 1;
  const latest = src[idx];
  const prev = idx > 0 ? src[idx - 1] : null;

  if (!latest) return;

  const articleCount = latest.articleCount || latestSnapshot.length;
  const totalPV = latest.totalPV;
  const totalLikes = latest.totalLikes;
  const totalComments = latest.totalComments;
  const followers = latest.followerCount || 0;

  // 3KPI (KITAcore style)
  const reach = articleCount > 0 ? (totalPV / articleCount) : 0;
  const action = articleCount > 0 ? (totalLikes / articleCount) : 0;
  const eta = totalPV > 0 ? (totalLikes / totalPV * 100) : 0;

  document.getElementById('kpiReach').textContent = reach.toFixed(1);
  document.getElementById('kpiAction').textContent = action.toFixed(1);
  document.getElementById('kpiEta').textContent = eta.toFixed(1) + '%';
  document.getElementById('kpiFollowers').textContent = followers.toLocaleString();
  document.getElementById('kpiArticles').textContent = articleCount;

  // Detail row
  document.getElementById('kpiPV').textContent = totalPV.toLocaleString();
  document.getElementById('kpiLikes').textContent = totalLikes.toLocaleString();
  document.getElementById('kpiComments').textContent = totalComments.toLocaleString();

  if (prev) {
    const prevArticleCount = prev.articleCount || articleCount;
    const prevPV = prev.totalPV;
    const prevLikes = prev.totalLikes;
    const prevComments = prev.totalComments;
    const prevFollowers = prev.followerCount || 0;

    const prevReach = prevArticleCount > 0 ? (prevPV / prevArticleCount) : 0;
    const prevAction = prevArticleCount > 0 ? (prevLikes / prevArticleCount) : 0;
    const prevEta = prevPV > 0 ? (prevLikes / prevPV * 100) : 0;

    document.getElementById('kpiReachSub').innerHTML = arrowLabel(reach - prevReach, '/article');
    document.getElementById('kpiActionSub').innerHTML = arrowLabel(action - prevAction, '/article');
    document.getElementById('kpiEtaSub').innerHTML = arrowLabel(eta - prevEta, 'pts', true);
    document.getElementById('kpiFollowersSub').innerHTML = arrowLabel(followers - prevFollowers, '');
    document.getElementById('kpiArticlesSub').innerHTML = arrowLabel(articleCount - prevArticleCount, ' new');

    // Detail row diffs
    document.getElementById('kpiPVsub').innerHTML = diffBadge(totalPV - prevPV);
    document.getElementById('kpiLikesSub').innerHTML = diffBadge(totalLikes - prevLikes);
    document.getElementById('kpiCommentsSub').innerHTML = diffBadge(totalComments - prevComments);
  }
}

function arrowLabel(diff, unit, isFloat) {
  let arrow, cls;
  if (diff > 0.001) { arrow = '↑'; cls = 'up'; }
  else if (diff < -0.001) { arrow = '↓'; cls = 'down'; }
  else { arrow = '→'; cls = 'flat'; }
  const val = isFloat ? Math.abs(diff).toFixed(2) : Math.abs(Math.round(diff));
  return `<span class="${cls}"><span class="arrow">${arrow}</span>${val}${unit}</span>`;
}

function diffBadge(diff) {
  const sign = diff >= 0 ? '+' : '';
  const cls = diff >= 0 ? 'up' : 'down';
  return `<span class="${cls}">${sign}${diff}</span>`;
}

// ===== Commentary Auto-generation =====
function updateCommentary() {
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  if (src.length < 2) {
    document.getElementById('commentaryStrip').style.display = 'none';
    return;
  }

  const idx = selectedDateIndex >= 0 ? selectedDateIndex : src.length - 1;
  const latest = src[idx];
  const prev = idx > 0 ? src[idx - 1] : null;
  if (!latest || !prev) {
    document.getElementById('commentaryStrip').style.display = 'none';
    return;
  }

  const articleCount = latest.articleCount || latestSnapshot.length;
  const prevArticleCount = prev.articleCount || articleCount;

  const reach = articleCount > 0 ? (latest.totalPV / articleCount) : 0;
  const action = articleCount > 0 ? (latest.totalLikes / articleCount) : 0;
  const eta = latest.totalPV > 0 ? (latest.totalLikes / latest.totalPV * 100) : 0;

  const prevReach = prevArticleCount > 0 ? (prev.totalPV / prevArticleCount) : 0;
  const prevAction = prevArticleCount > 0 ? (prev.totalLikes / prevArticleCount) : 0;
  const prevEta = prev.totalPV > 0 ? (prev.totalLikes / prev.totalPV * 100) : 0;

  const dir = (diff) => diff > 0.001 ? '↑' : (diff < -0.001 ? '↓' : '→');

  const rDir = dir(reach - prevReach);
  const aDir = dir(action - prevAction);
  const eDir = dir(eta - prevEta);
  const key = rDir + aDir + eDir;

  const templates = {
    '↑↑↑': '全指標上昇。好調日。',
    '↑↑→': 'リーチ・アクション共に上昇。スキ率は安定。',
    '↑↑↓': '露出もアクションも増加。ただしスキ率は低下、新規流入が多い可能性。',
    '↑→↑': 'リーチ拡大＋スキ率上昇。読者の質が良い流入。',
    '↑→→': 'リーチ微増。全体的には安定推移。',
    '↑→↓': 'リーチは伸びたがスキ率低下。タイトル勝ちの可能性。',
    '↑↓↑': '露出は増えたがアクション減。スキ率は改善、固定層が反応か。',
    '↑↓→': '露出増、アクション減。新規の反応が薄い可能性。',
    '↑↓↓': '露出は増えたが刺さってない。タイトル勝ちの可能性。',
    '→↑↑': 'リーチ横ばいでアクション・スキ率上昇。内容の質が高い。',
    '→↑→': 'アクション微増。安定した運営日。',
    '→↑↓': 'アクション増だがスキ率低下。PV増がアクション増を上回っている。',
    '→→↑': 'スキ率だけ微増。読者の質がじわり向上。',
    '→→→': '安定推移。現状維持。',
    '→→↓': 'スキ率だけ微減。大きな変化はなし。',
    '→↓↑': 'アクション減だがスキ率は上昇。PV減でスキ率が相対的に上昇か。',
    '→↓→': 'アクション微減。経過観察。',
    '→↓↓': 'アクション・スキ率共に低下。テーマか投稿タイミングを確認。',
    '↓↑↑': 'リーチ減でもアクション・スキ率は上昇。固定読者の反応が濃い日。',
    '↓↑→': 'リーチ減だがアクション増。少数だが刺さっている。',
    '↓↑↓': 'リーチ減、アクション増、スキ率低下。変動大きめ、翌日も観察。',
    '↓→↑': '閑散日だが質は高い。固定読者が反応。',
    '↓→→': 'リーチ微減。大きな変化なし。',
    '↓→↓': 'リーチ・スキ率共に微減。緩やかな下降傾向。',
    '↓↓↑': 'リーチ・アクション共に減少だがスキ率は上昇。PV減による相対効果の可能性。',
    '↓↓→': 'リーチ・アクション減。投稿のない日 or テーマが合わなかった可能性。',
    '↓↓↓': '全指標下降。一時的な落ち込みか、テーマ・タイミングの見直しを。',
  };

  const comment = templates[key] || '判定不能。データを確認。';
  const dateStr = latest.date || '';
  const displayComment = `${dateStr} | リーチ${rDir} アクション${aDir} スキ率${eDir} | ${comment}`;
  const copyComment = `リーチ${rDir} アクション${aDir} スキ率${eDir} | ${comment}`;

  document.getElementById('commentaryText').textContent = displayComment;
  document.getElementById('commentaryText').dataset.copyText = copyComment;
  document.getElementById('commentaryStrip').style.display = 'flex';

  // Update nav button states
  const src2 = summaryData.length > 0 ? summaryData : dailySummary;
  document.getElementById('commentaryPrev').disabled = idx <= 0;
  document.getElementById('commentaryNext').disabled = idx >= src2.length - 1;
}

function navigateDate(delta) {
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  const next = selectedDateIndex + delta;
  if (next < 0 || next >= src.length) return;
  selectedDateIndex = next;
  updateKPI();
  updateCommentary();
}

function copyCommentary() {
  const text = document.getElementById('commentaryText').dataset.copyText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('commentaryCopy');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
}

function updateHeader(dates) {
  document.getElementById('lastUpdate').textContent = dates[dates.length - 1];
  document.getElementById('articleCount').textContent = latestSnapshot.length;
  // Days since first article published
  const firstPub = latestSnapshot
    .map(a => a.published_at ? a.published_at.slice(0, 10) : '')
    .filter(d => d)
    .sort()[0];
  if (firstPub) {
    const days = Math.floor((parseDate(dates[dates.length - 1]) - parseDate(firstPub)) / 86400000) + 1;
    document.getElementById('daysSinceStart').textContent = days;
  }
  // Navigator: character of latest data date
  const charIdx = getCharIdx(dates[dates.length - 1]);
  document.getElementById('navigatorName').textContent = CHIBI_NAMES[charIdx];
}

// ===== Tab Switching =====
function switchTab(tabName) {
  document.querySelectorAll('.tab-bar-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  const tabId = 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
  const tabEl = document.getElementById(tabId);
  if (tabEl) tabEl.classList.add('active');
  history.replaceState(null, '', '#' + tabName);
  // Re-render when tab becomes visible
  if (tabName === 'activity' && latestSnapshot.length > 0) {
    setTimeout(() => { renderActivityTab(); }, 50);
  }
  if (tabName === 'weekly' && latestSnapshot.length > 0) {
    setTimeout(() => { renderWeeklyTab(); }, 50);
  }
  if (tabName === 'deepdive' && latestSnapshot.length > 0) {
    setTimeout(() => { renderDeepDive(); }, 50);
  }
  if (tabName === 'ranking' && latestSnapshot.length > 0) {
    setTimeout(() => { renderRankingTab(); }, 50);
  }
}

document.querySelectorAll('.tab-bar-btn').forEach(btn => {
  btn.addEventListener('click', () => { switchTab(btn.dataset.tab); });
});

// ===== Daily Tab Rendering (Chat Style) =====

function renderDailyTab() {
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  if (src.length < 2) return;

  const idx = selectedDateIndex >= 0 ? selectedDateIndex : src.length - 1;
  const latest = src[idx];
  const prev = src[idx - 1];

  // Build render data for girl-lines dynamic evaluation
  const pvGrowth = prev.totalPV > 0 ? ((latest.totalPV - prev.totalPV) / prev.totalPV * 100) : 0;
  const likeGrowth = prev.totalLikes > 0 ? ((latest.totalLikes - prev.totalLikes) / prev.totalLikes * 100) : 0;
  // Follower
  const followers = latest.followerCount || 0;
  const prevFollowers = prev.followerCount || 0;
  const fDiffVal = followers - prevFollowers;

  // Like ranking top diff
  const likeRankDiffs = getLikeDiffs(latest.date);
  const topLikeDiff = likeRankDiffs.length > 0 ? likeRankDiffs[0].likeDiff : 0;

  // Today's article stats for girl-lines (category average comparison)
  const todayArts = latestSnapshot.filter(a => a.published_at && a.published_at.startsWith(latest.date));
  const dailyCatAvgs = getCategoryAvgs();
  const hasTodayArticle = todayArts.length > 0;
  const todayCat = hasTodayArticle ? todayArts[0].category : '';
  const todayCatAvg = dailyCatAvgs[todayCat] || { avgPV: 0, avgLike: 0 };
  const todayPVAboveAvg = hasTodayArticle && todayArts[0].read_count >= todayCatAvg.avgPV;
  const todayLikeAboveAvg = hasTodayArticle && todayArts[0].like_count >= todayCatAvg.avgLike;
  const todayPV = hasTodayArticle ? todayArts[0].read_count : 0;
  const todayLike = hasTodayArticle ? todayArts[0].like_count : 0;

  _dailyRenderData = {
    pvGrowth: Math.round(pvGrowth), likeGrowth: Math.round(likeGrowth),
    memoKey: '', // set below after memo calculation
    followers, followerDiff: fDiffVal,
    topLikeDiff,
    hasTodayArticle, todayPVAboveAvg, todayLikeAboveAvg,
    todayPV, todayLike, dailyAvgPV: todayCatAvg.avgPV, dailyAvgLike: todayCatAvg.avgLike,
  };

  // Character from data date
  const charIdx = getCharIdx(latest.date);
  const charFile = CHIBI_FILES[charIdx];
  const charName = CHIBI_NAMES[charIdx];

  // State memo
  const articleCount = latest.articleCount || latestSnapshot.length;
  const prevArticleCount = prev.articleCount || articleCount;
  const reach = articleCount > 0 ? (latest.totalPV / articleCount) : 0;
  const action_ = articleCount > 0 ? (latest.totalLikes / articleCount) : 0;
  const eta = latest.totalPV > 0 ? (latest.totalLikes / latest.totalPV * 100) : 0;
  const prevReach = prevArticleCount > 0 ? (prev.totalPV / prevArticleCount) : 0;
  const prevAction = prevArticleCount > 0 ? (prev.totalLikes / prevArticleCount) : 0;
  const prevEta = prev.totalPV > 0 ? (prev.totalLikes / prev.totalPV * 100) : 0;
  const dir = (d) => d > 0.001 ? '↑' : (d < -0.001 ? '↓' : '→');
  const rDir = dir(reach - prevReach), aDir = dir(action_ - prevAction), eDir = dir(eta - prevEta);
  const memoKey = rDir + aDir + eDir;
  const templates = {
    '↑↑↑':'全指標上昇。好調日。','↑↑→':'リーチ・アクション共に上昇。スキ率は安定。',
    '↑↑↓':'露出もアクションも増加。スキ率は低下、新規流入が多い可能性。',
    '↑→↑':'リーチ拡大＋スキ率上昇。読者の質が良い流入。','↑→→':'リーチ微増。安定推移。',
    '↑→↓':'リーチは伸びたがスキ率低下。タイトル勝ちの可能性。',
    '↑↓↑':'露出増、アクション減。スキ率改善、固定層が反応か。',
    '↑↓→':'露出増、アクション減。新規の反応が薄い可能性。',
    '↑↓↓':'露出は増えたが刺さってない。タイトル勝ちの可能性。',
    '→↑↑':'リーチ横ばいでアクション・スキ率上昇。内容の質が高い。',
    '→↑→':'アクション微増。安定した運営日。',
    '→↑↓':'アクション増だがスキ率低下。PV増がアクション増を上回っている。',
    '→→↑':'スキ率だけ微増。読者の質がじわり向上。','→→→':'安定推移。現状維持。',
    '→→↓':'スキ率だけ微減。大きな変化はなし。',
    '→↓↑':'アクション減だがスキ率上昇。PV減で相対的に上昇か。',
    '→↓→':'アクション微減。経過観察。',
    '→↓↓':'アクション・スキ率共に低下。テーマか投稿タイミングを確認。',
    '↓↑↑':'リーチ減でもアクション・スキ率上昇。固定読者の反応が濃い日。',
    '↓↑→':'リーチ減だがアクション増。少数だが刺さっている。',
    '↓↑↓':'リーチ減、アクション増、スキ率低下。変動大きめ、翌日も観察。',
    '↓→↑':'閑散日だが質は高い。固定読者が反応。','↓→→':'リーチ微減。大きな変化なし。',
    '↓→↓':'リーチ・スキ率共に微減。緩やかな下降傾向。',
    '↓↓↑':'リーチ・アクション減だがスキ率上昇。PV減による相対効果の可能性。',
    '↓↓→':'リーチ・アクション減。投稿のない日 or テーマが合わなかった可能性。',
    '↓↓↓':'全指標下降。一時的な落ち込みか、テーマ・タイミングの見直しを。',
  };
  const memoComment = templates[memoKey] || '判定不能。';
  const copyText = `リーチ${rDir} アクション${aDir} スキ率${eDir} | ${memoComment}`;

  // Set memoKey for girl-lines dynamic evaluation
  _dailyRenderData.memoKey = memoKey;

  function dailyNavi(section) {
    return weeklyNavi(charIdx, section);
  }

  // Memo card
  const memoCard = `
    <div class="daily-memo-arrows">リーチ${rDir}　アクション${aDir}　スキ率${eDir}</div>
    <div class="daily-memo-comment">${memoComment}</div>
    <div class="daily-memo-text" id="dailyMemoText" data-copy-text="${copyText.replace(/"/g,'&quot;')}" style="display:none"></div>`;

  // Today's article
  const todayArticleCards = buildTodayArticleHTML(latest.date);

  // Like ranking
  const likeRankCards = buildLikeRankHTML(latest.date);

  let html = '';

  // 1. State memo
  html += dailyNavi('daily');
  html += `<div class="weekly-section">${memoCard}</div>`;

  // Data date label
  const dateLabel = getDataDateLabel(latest.date);
  const articleSectionTitle = dateLabel === '今日' ? '今日の記事' : `${getDayLabel(latest.date)} の記事`;

  // 2. Follower
  html += dailyNavi('dailyFollower');
  html += `<div class="weekly-section"><div class="weekly-section-title">フォロワー前日比</div>
    <div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--accent-green)">${followers.toLocaleString()} <span style="font-size:14px;color:${fDiffVal >= 5 ? 'var(--accent-green)' : fDiffVal <= -3 ? 'var(--accent-pink)' : 'var(--text-muted)'}">${fDiffVal >= 0 ? '+' : ''}${fDiffVal}</span></div></div>`;

  // 3. Today's article (if exists)
  if (todayArticleCards) {
    html += dailyNavi('dailyArticle');
    html += `<div class="weekly-section"><div class="weekly-section-title">${articleSectionTitle}</div>${todayArticleCards}</div>`;
  }

  // 4. Like ranking
  html += dailyNavi('dailyLike');
  html += `<div class="weekly-section"><div class="weekly-section-title">スキ増ベスト3 <span style="font-size:11px;font-weight:400;color:var(--text-muted)">前日比</span></div>${likeRankCards || '<div style="color:var(--text-muted);font-size:13px">スキの動きなし</div>'}</div>`;

  document.getElementById('dailyContent').innerHTML = html;
  document.getElementById('dailyDate').textContent = getDayLabel(latest.date);
  document.getElementById('dailyPrev').disabled = (idx <= 1);
  document.getElementById('dailyNext').disabled = (idx >= src.length - 1);

  // Closing
  document.getElementById('dailyClosing').innerHTML = `
    <img class="daily-closing-img" src="images/eyes/eyes-${charFile}.webp" alt="">
    <div class="daily-closing-text">観測は、<span>続く。</span></div>
    <div class="daily-closing-sub">成果ではなく、判断を残す。<br>明日の朝も、彼女はおはようと言う。</div>`;
}

function copyDailyMemo() {
  const text = document.getElementById('dailyMemoText').dataset.copyText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('#dailyChat .commentary-copy');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
  });
}

function navigateDailyDate(delta) {
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  const next = selectedDateIndex + delta;
  if (next < 1 || next >= src.length) return;
  selectedDateIndex = next;
  updateKPI();
  renderDailyTab();
}

function buildTodayArticleHTML(dataDate) {
  const todayArticles = latestSnapshot.filter(a => a.published_at && a.published_at.startsWith(dataDate));
  if (todayArticles.length === 0) return '';
  const mondayStr = getMondayOf(dataDate);
  let abCount = 0;
  latestSnapshot.forEach(a => {
    if (a.published_at && a.published_at.slice(0,10) >= mondayStr && a.published_at.slice(0,10) <= dataDate) {
      if (a.category === 'A' || a.category === 'B') abCount++;
    }
  });
  const catAvgs = getCategoryAvgs();

  return todayArticles.map(a => {
    const catColor = getCategoryColor(a.category);
    const catName = getCategoryName(a.category);
    const ca = catAvgs[a.category] || { avgPV: 0, avgLike: 0 };
    const pvColor = a.read_count >= ca.avgPV ? 'var(--accent-green)' : 'var(--accent-pink)';
    const likeColor = a.like_count >= ca.avgLike ? 'var(--accent-green)' : 'var(--accent-pink)';
    return `<div class="daily-article-title"><a href="${noteURL(a.key)}" target="_blank" rel="noopener" style="color:var(--text-primary);text-decoration:none">${a.title}</a></div>
      <div class="daily-article-meta">
        <span class="daily-article-cat" style="background:${catColor}22;color:${catColor}">${a.category} ${catName}</span>
        <span>PV <span style="color:${pvColor};font-weight:600">${a.read_count}</span> <span style="font-size:10px">(${catName}平均${ca.avgPV})</span></span>
        <span>スキ <span style="color:${likeColor};font-weight:600">${a.like_count}</span> <span style="font-size:10px">(${catName}平均${ca.avgLike})</span></span>
      </div>`;
  }).join('');
}

function getLikeDiffs(dataDate) {
  if (articlesData.length === 0) return [];
  const dates = [...new Set(articlesData.map(a => a.date))].sort();
  const dateIdx = dates.indexOf(dataDate);
  if (dateIdx < 1) return [];
  const prevDate = dates[dateIdx - 1];
  const cur = articlesData.filter(a => a.date === dataDate);
  const prv = articlesData.filter(a => a.date === prevDate);
  const prevMap = {}; prv.forEach(a => { prevMap[a.key] = a.like_count; });
  return cur
    .map(a => ({ key:a.key, title:a.title, category:a.category, published_at:a.published_at||'', likeCount:a.like_count, likeDiff:a.like_count-(prevMap[a.key]||0) }))
    .filter(a => a.likeDiff > 0).sort((a,b) => b.likeDiff - a.likeDiff).slice(0, 3);
}

function buildLikeRankHTML(dataDate) {
  const diffs = getLikeDiffs(dataDate);
  if (diffs.length === 0) return '';
  return `<div class="daily-like-list">${diffs.map((d,i) => {
    const catColor = getCategoryColor(d.category);
    const ps = d.published_at ? d.published_at.slice(0,10) : '';
    let pub = ps;
    if (ps) { pub = getDayLabel(ps); }
    return `<div class="daily-like-item"><div class="daily-like-rank">${i+1}</div><div class="daily-like-info"><div class="daily-like-title"><a href="${noteURL(d.key)}" target="_blank" rel="noopener" style="color:var(--text-primary);text-decoration:none"><span class="cat-badge" style="color:${catColor}">${d.category}</span> ${d.title}</a></div>${pub?`<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:3px">公開 ${pub}</div>`:''}</div><div style="text-align:right"><div class="daily-like-diff">+${d.likeDiff}</div><div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">計${d.likeCount}</div></div></div>`;
  }).join('')}</div>`;
}

// ===== Weekly Tab Rendering =====

// ===== Activity Tab Rendering =====

function renderActivityTab() {
  const week = getWeekRange();
  if (!week.start) return;

  const src = summaryData.length > 0 ? summaryData : dailySummary;
  const last28 = src.slice(-28);
  const followerGrowth4w = last28.length >= 2 ? (last28[last28.length-1].followerCount||0) - (last28[0].followerCount||0) : 0;

  const peopleStats = computeWeeklyPeople(week);

  const savedData = _dailyRenderData;
  _dailyRenderData = {
    followerGrowth4w,
    newLikerCount: peopleStats.newList.length,
    returnCount: peopleStats.returnList.length,
    regularCount: peopleStats.regList.length,
    atRiskCount: peopleStats.atRiskUsers.length,
  };

  const latest = last28[last28.length - 1];
  const first = last28[0];
  const fDiff = (latest.followerCount || 0) - (first.followerCount || 0);
  const fSign = fDiff >= 0 ? '+' : '';

  let html = '';

  // 1. Follower chart (陽=1)
  html += weeklyNavi(1, 'weeklyFollower');
  html += `<div class="weekly-section">
    <div class="weekly-section-title">フォロワー推移（4週間）<span style="margin-left:12px;color:${fDiff >= 0 ? 'var(--accent-green)' : 'var(--accent-pink)'};font-size:13px">${latest.followerCount}人（${fSign}${fDiff}）</span></div>
    <div style="display:flex;gap:16px;font-size:10px;color:var(--text-muted);margin-bottom:4px">
      <span><span style="color:var(--accent-pink)">━</span> フォロワー</span>
      <span><span style="color:var(--accent-cyan);opacity:0.5">█</span> 自分のスキ数</span>
    </div>
    <div class="weekly-follower-chart"><canvas id="activityFollowerCanvas"></canvas></div>
  </div>`;

  // 2. People (るな=4, しずく=2)
  html += weeklyNavi(4, 'weeklyNewLikers');
  html += weeklyNavi(2, 'weeklyRegulars');
  html += `<div class="weekly-section">
    <div class="weekly-section-title">今週のスキしてくれた人 <span style="font-size:12px;color:var(--text-muted);font-weight:400">${week.start}〜${week.end}</span></div>
    ${myLikesData.length > 0 ? '<div style="margin-bottom:8px"><label style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);cursor:pointer;display:flex;align-items:center;gap:4px"><input type="checkbox" id="filterUnreturned" onchange="toggleUnreturnedFilter()" style="margin:0">未スキ返しのみ</label></div>' : ''}
    <div class="weekly-people-tabs">
      ${buildPeopleTabButtons(peopleStats, week)}
    </div>
    <div class="weekly-people-content" data-tab="new">${buildWeeklyPeopleHTML(peopleStats, 'new', week)}</div>
    <div class="weekly-people-content" data-tab="return" style="display:none">${buildWeeklyPeopleHTML(peopleStats, 'return', week)}</div>
    <div class="weekly-people-content" data-tab="regular" style="display:none">${buildWeeklyPeopleHTML(peopleStats, 'regular', week)}</div>
    <div class="weekly-people-content" data-tab="occasional" style="display:none">${buildWeeklyPeopleHTML(peopleStats, 'occasional', week)}</div>
  </div>`;

  // 3. At risk (日和=6)
  html += weeklyNavi(6, 'weeklyAtRisk');
  html += `<div class="weekly-section">
    <div class="weekly-section-title" style="color:var(--accent-amber)">離脱危機</div>
    ${buildWeeklyAtRiskHTML(peopleStats)}
  </div>`;

  _dailyRenderData = savedData;

  document.getElementById('activityContent').innerHTML = html;

  // Draw follower chart
  setTimeout(() => { drawActivityFollowerChart(); }, 50);
  loadWeeklyAvatars();
}

function drawActivityFollowerChart() {
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  if (src.length < 2) return;
  const last28 = src.slice(-28);
  const labels = last28.map(d => d.date.slice(5));
  const values = last28.map(d => d.followerCount || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const PINK = '#fd79a8';
  const CYAN = '#00d4ff';

  // Build my suki counts per date
  const mySukiByDate = {};
  myLikesData.forEach(l => {
    const d = (l.liked_at || '').slice(0, 10);
    if (d) mySukiByDate[d] = (mySukiByDate[d] || 0) + 1;
  });
  const sukiValues = last28.map(d => mySukiByDate[d.date] || 0);
  const sukiMax = Math.max(...sukiValues, 1);

  const canvas = document.getElementById('activityFollowerCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.parentElement.clientWidth;
  const H = 180;
  canvas.width = W * 2; canvas.height = H * 2;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.scale(2, 2);
  const pad = { t: 10, b: 30, l: 40, r: 36 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;
  const range = max - min || 1;

  // Left axis grid (followers)
  ctx.strokeStyle = '#2a2a3a'; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#666'; ctx.font = '10px JetBrains Mono'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(max - range * i / 4), pad.l - 4, y + 4);
  }

  // Right axis labels (suki count)
  ctx.fillStyle = CYAN; ctx.font = '10px JetBrains Mono'; ctx.textAlign = 'left';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.fillText(Math.round(sukiMax * (1 - i / 4)), W - pad.r + 4, y + 4);
  }

  // X labels
  ctx.fillStyle = '#666'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(labels.length / 6));
  labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) ctx.fillText(l, pad.l + cw * i / (labels.length - 1), H - 8); });

  // Monday dashed lines
  ctx.strokeStyle = '#3a3a4a'; ctx.lineWidth = 0.5; ctx.setLineDash([4, 4]);
  last28.forEach((d, i) => { if (parseDate(d.date).getDay() === 1) { const x = pad.l + cw * i / (values.length - 1); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ch); ctx.stroke(); } });
  ctx.setLineDash([]);

  // Suki bars
  const barW = Math.max(2, cw / labels.length * 0.5);
  sukiValues.forEach((v, i) => {
    if (v === 0) return;
    const x = pad.l + cw * i / (labels.length - 1);
    const barH = (v / sukiMax) * ch;
    ctx.fillStyle = 'rgba(0,212,255,0.25)';
    ctx.fillRect(x - barW / 2, pad.t + ch - barH, barW, barH);
  });

  // Follower line fill
  ctx.beginPath();
  values.forEach((v, i) => { const x = pad.l + cw * i / (values.length - 1); const y = pad.t + ch * (1 - (v - min) / range); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.lineTo(pad.l + cw, pad.t + ch); ctx.lineTo(pad.l, pad.t + ch); ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
  grad.addColorStop(0, 'rgba(253,121,168,0.25)'); grad.addColorStop(1, 'rgba(253,121,168,0.02)');
  ctx.fillStyle = grad; ctx.fill();

  // Follower line
  ctx.beginPath();
  values.forEach((v, i) => { const x = pad.l + cw * i / (values.length - 1); const y = pad.t + ch * (1 - (v - min) / range); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.strokeStyle = PINK; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();

  // End dot
  const lx = pad.l + cw; const ly = pad.t + ch * (1 - (values[values.length - 1] - min) / range);
  ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fillStyle = PINK; ctx.fill();
}

let _weeklyRenderData = {};

function weeklyNavi(charIdx, section) {
  const charFile = CHIBI_FILES[charIdx];
  const charName = CHIBI_NAMES[charIdx];
  const line = getGirlLineForIdx(section, charIdx);
  return `<div class="weekly-navi" id="navi-${section}">
    <img class="weekly-navi-img" src="images/eyes-thumb/eyes-${charFile}.webp" alt="${charName}">
    <div class="weekly-navi-body">
      <div class="weekly-navi-name">${charName}</div>
      <div class="weekly-navi-line">${line}</div>
    </div>
  </div>`;
}

function renderWeeklyTab() {
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  if (src.length < 2) return;

  const week = getWeekRange();
  if (!week.start) return;

  const last28 = src.slice(-28);
  const followerGrowth4w = last28.length >= 2 ? (last28[last28.length-1].followerCount||0) - (last28[0].followerCount||0) : 0;
  const peopleStats = computeWeeklyPeople(week);

  const weekArticles = latestSnapshot.filter(a => {
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    return pub >= week.start && pub <= week.end;
  });
  const catCounts = {};
  weekArticles.forEach(a => { catCounts[a.category] = (catCounts[a.category] || 0) + 1; });
  const abCount = (catCounts['A'] || 0) + (catCounts['B'] || 0);

  const monthAgo = formatDate(new Date(parseDate(week.dataDate).getTime() - 29 * 86400000));
  const monthArticles = latestSnapshot.filter(a => {
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    return pub >= monthAgo && pub <= week.dataDate;
  });
  const monthCats = {};
  monthArticles.forEach(a => { monthCats[a.category] = (monthCats[a.category] || 0) + 1; });
  // MONTHLY_IDEAL is defined as global constant
  const hasCatShortage = Object.entries(MONTHLY_IDEAL).some(([c, [lo]]) => (monthCats[c] || 0) < lo);
  const hasCatExcess = Object.entries(MONTHLY_IDEAL).some(([c, [, hi]]) => (monthCats[c] || 0) > hi);
  const hasCatWarning = hasCatShortage || hasCatExcess;

  // Build next week's category proposal (7 articles)
  // Strategy: monthly ideal - (current month including this week) = remaining need
  // Then distribute 7 articles to fill gaps, with η-priority (B>D>C>A>E)
  const proposal = {};
  let remaining = 7;

  // Monthly counts already include this week. Simulate adding next week's 7 articles.
  // Calculate how many more each category needs to reach ideal midpoint
  const need = {};
  Object.entries(MONTHLY_IDEAL).forEach(([c, [lo, hi]]) => {
    const actual = monthCats[c] || 0;
    const mid = Math.round((lo + hi) / 2);
    need[c] = Math.max(0, mid - actual);
  });

  // 1. D minimum 1 (minilog fixed)
  proposal['D'] = 1; remaining--;

  // 2. Fill categories that need the most (η priority for ties)
  const fillOrder = ['B', 'D', 'C', 'A', 'E'];
  const WEEKLY_MAX = 3;

  // First pass: fill needs
  for (const c of fillOrder) {
    if (remaining <= 0) break;
    const n = need[c] - (proposal[c] || 0);
    if (n > 0) {
      const fill = Math.min(n, remaining, WEEKLY_MAX - (proposal[c] || 0));
      if (fill > 0) {
        proposal[c] = (proposal[c] || 0) + fill;
        remaining -= fill;
      }
    }
  }

  // Second pass: fill remaining with η priority (avoid categories that were heavy this week)
  while (remaining > 0) {
    let filled = false;
    for (const c of fillOrder) {
      if (remaining <= 0) break;
      if ((proposal[c] || 0) >= WEEKLY_MAX) continue;
      // Skip if this category was heavy this week (3+ articles)
      if ((catCounts[c] || 0) >= 3 && remaining > 1) continue;
      proposal[c] = (proposal[c] || 0) + 1;
      remaining--;
      filled = true;
    }
    if (!filled) break;
  }

  const proposalText = ['A','B','C','D','E','G']
    .filter(c => proposal[c])
    .map(c => `${getCategoryName(c)} ${proposal[c]}本`)
    .join('、');

  const actions = [];
  actions.push(`来週の提案: ${proposalText}`);

  // Monthly shortage/excess notes
  Object.entries(MONTHLY_IDEAL).forEach(([c, [lo, hi]]) => {
    const actual = monthCats[c] || 0;
    if (actual < lo) actions.push(`${c}(${getCategoryName(c)})が月間で不足 → 優先的に配置`);
  });

  // Title advice
  actions.push('タイトルに「結果示唆」を入れる → 「わかった」「変わった」「結果」でη +4pt');

  // Compute weekly article analysis for girl-lines
  const allPVs = latestSnapshot.map(a => a.read_count).filter(v => v > 0);
  const allLikesArr = latestSnapshot.map(a => a.like_count);
  const avgPV = allPVs.length > 0 ? Math.round(allPVs.reduce((s,v) => s+v, 0) / allPVs.length) : 0;
  const avgLike = allLikesArr.length > 0 ? Math.round(allLikesArr.reduce((s,v) => s+v, 0) / allLikesArr.length) : 0;

  const aboveAvgPV = weekArticles.filter(a => a.read_count >= avgPV).length;
  const aboveAvgLike = weekArticles.filter(a => a.like_count >= avgLike).length;

  // Category distribution
  const uniqueCats = [...new Set(weekArticles.map(a => a.category))];
  const isSingleCategory = uniqueCats.length === 1;
  const singleCatName = isSingleCategory ? getCategoryName(uniqueCats[0]) : '';

  // Weekly η by category (for sequence check)
  const weekCatEta = {};
  ['A','B','C','D','E'].forEach(c => {
    const arts = weekArticles.filter(a => a.category === c);
    if (arts.length === 0) return;
    const pv = arts.reduce((s,a) => s + a.read_count, 0);
    const lk = arts.reduce((s,a) => s + a.like_count, 0);
    weekCatEta[c] = pv > 0 ? lk / pv * 100 : 0;
  });
  // Check if E > B (unusual)
  const etaEoverB = (weekCatEta['E'] || 0) > (weekCatEta['B'] || 0) && weekCatEta['E'] && weekCatEta['B'];
  // Check if A > B (unusual in data, but could happen)
  const etaAoverB = (weekCatEta['A'] || 0) > (weekCatEta['B'] || 0) && weekCatEta['A'] && weekCatEta['B'];

  // New vs regular ratio from likes
  let totalNew = 0, totalReg = 0;
  if (likesData.length > 0) {
    const beforeWeek = new Set();
    likesData.forEach(l => { const ld = (l.liked_at || '').slice(0, 10); if (ld < week.start) beforeWeek.add(l.like_user_id); });
    likesData.forEach(l => {
      const ld = (l.liked_at || '').slice(0, 10);
      if (ld >= week.start && ld <= week.end) {
        if (beforeWeek.has(l.like_user_id)) totalReg++; else totalNew++;
      }
    });
  }
  const isNewDominant = totalNew > totalReg;

  _weeklyRenderData = {
    followerGrowth4w,
    newLikerCount: peopleStats.newList.length,
    returnCount: peopleStats.returnList.length,
    regularCount: peopleStats.regList.length,
    atRiskCount: peopleStats.atRiskUsers.length,
    weekArticleCount: weekArticles.length,
    abCount, hasCatWarning,
    bCount: catCounts['B'] || 0,
    dCount: catCounts['D'] || 0,
    eCount: catCounts['E'] || 0,
    etaEoverB, etaAoverB,
    actionCount: actions.length,
    aboveAvgPV, aboveAvgLike, avgPV, avgLike,
    isSingleCategory, singleCatName,
    isNewDominant, totalNew, totalReg,
  };

  const savedData = _dailyRenderData;
  _dailyRenderData = _weeklyRenderData;

  // 5. Articles (月子=0) + 6. Category balance (まひる=5) + 7. Action (凛華=3)
  document.getElementById('weeklyContent').innerHTML = `
    ${weeklyNavi(0, 'weeklyArticles')}
    <div class="weekly-section">
      <div class="weekly-section-title">今週の記事（${weekArticles.length}本）</div>
      ${buildWeeklyArticlesHTML(weekArticles, week)}
    </div>

    ${weeklyNavi(5, 'weeklyCategoryBalance')}
    <div class="weekly-section">
      <div class="weekly-section-title">カテゴリバランス</div>
      ${buildWeeklyCatBalanceHTML(weekArticles, catCounts, abCount, monthArticles, monthCats, MONTHLY_IDEAL)}
    </div>

    ${weeklyNavi(3, 'weeklyAction')}
    <div class="weekly-section">
      <div class="weekly-action-label">祈るな、設計しろ。</div>
      ${buildWeeklyActionHTML(actions)}
    </div>`;

  _dailyRenderData = savedData;

  // Draw monthly pie chart
  setTimeout(() => {
    const canvas = document.getElementById('monthlyCatPie');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 160, H = 160;
    canvas.width = W * 2; canvas.height = H * 2;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.scale(2, 2);
    const cx = W / 2, cy = H / 2, r = 60;
    const PIE_ORDER = ['A','B','C','D','E','F','G'];
    const pieTotal = monthArticles.length || 1;
    let startAngle = -Math.PI / 2;
    PIE_ORDER.forEach(c => {
      const count = monthCats[c] || 0;
      if (count === 0) return;
      const sliceAngle = (count / pieTotal) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = getCategoryColor(c);
      ctx.fill();
      const midAngle = startAngle + sliceAngle / 2;
      const lx = cx + Math.cos(midAngle) * (r * 0.65);
      const ly = cy + Math.sin(midAngle) * (r * 0.65);
      if (sliceAngle > 0.3) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c, lx, ly);
      }
      startAngle += sliceAngle;
    });
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#242433';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pieTotal, cx, cy - 6);
    ctx.font = '9px JetBrains Mono';
    ctx.fillStyle = '#888';
    ctx.fillText('本', cx, cy + 8);
  }, 100);
}

// --- Follower chart draw (called after DOM render) ---
function drawWeeklyFollowerChart() {
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  if (src.length < 2) return;
  const last28 = src.slice(-28);
  const labels = last28.map(d => d.date.slice(5));
  const values = last28.map(d => d.followerCount || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const PINK = '#fd79a8';
  const canvas = document.getElementById('weeklyFollowerCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.parentElement.clientWidth;
  const H = 180;
  canvas.width = W * 2; canvas.height = H * 2;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.scale(2, 2);
  const pad = { t: 10, b: 30, l: 40, r: 10 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;
  const range = max - min || 1;

  ctx.strokeStyle = '#2a2a3a'; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#666'; ctx.font = '10px JetBrains Mono'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(max - range * i / 4), pad.l - 4, y + 4);
  }
  ctx.fillStyle = '#666'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(labels.length / 6));
  labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) ctx.fillText(l, pad.l + cw * i / (labels.length - 1), H - 8); });

  ctx.strokeStyle = '#3a3a4a'; ctx.lineWidth = 0.5; ctx.setLineDash([4, 4]);
  last28.forEach((d, i) => {
    if (parseDate(d.date).getDay() === 1) {
      const x = pad.l + cw * i / (values.length - 1);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ch); ctx.stroke();
    }
  });
  ctx.setLineDash([]);

  ctx.beginPath();
  values.forEach((v, i) => { const x = pad.l + cw * i / (values.length - 1); const y = pad.t + ch * (1 - (v - min) / range); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.lineTo(pad.l + cw, pad.t + ch); ctx.lineTo(pad.l, pad.t + ch); ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
  grad.addColorStop(0, 'rgba(253,121,168,0.25)'); grad.addColorStop(1, 'rgba(253,121,168,0.02)');
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  values.forEach((v, i) => { const x = pad.l + cw * i / (values.length - 1); const y = pad.t + ch * (1 - (v - min) / range); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.strokeStyle = PINK; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();

  const lx = pad.l + cw; const ly = pad.t + ch * (1 - (values[values.length - 1] - min) / range);
  ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fillStyle = PINK; ctx.fill();
}

// --- User weekly history & classification ---
function buildUserWeeks() {
  const userWeeks = {};
  likesData.forEach(l => {
    const uid = l.like_user_id;
    const d = (l.liked_at || '').slice(0, 10);
    if (!d) return;
    const likeWeek = getMondayOf(d);
    if (!userWeeks[uid]) userWeeks[uid] = new Set();
    userWeeks[uid].add(likeWeek);
  });
  return userWeeks;
}

function classifyUser(uid, periodStart, userWeeks) {
  const weeks = userWeeks[uid] || new Set();
  const prevWeeks = [];
  let w = parseDate(getMondayOf(periodStart));
  for (let i = 0; i < 4; i++) { w.setDate(w.getDate() - 7); prevWeeks.push(formatDate(w)); }
  const periodWeekStart = getMondayOf(periodStart);
  const hasBeforePeriod = [...weeks].some(w => w < periodWeekStart);
  const recentActiveWeeks = prevWeeks.filter(pw => weeks.has(pw)).length;
  if (!hasBeforePeriod) return 'new';
  if (recentActiveWeeks >= 3) return 'regular';
  if (recentActiveWeeks === 0) return 'return';
  return 'occasional';
}

// --- People classification ---
function computeWeeklyPeople(week) {
  if (likesData.length === 0) return { newList: [], returnList: [], regList: [], occasionalList: [], atRiskUsers: [] };

  const userWeeks = buildUserWeeks();
  const thisWeekLikes = likesData.filter(l => {
    const d = (l.liked_at || '').slice(0, 10);
    return d >= week.start && d <= week.end;
  });

  const classified = {};
  thisWeekLikes.forEach(l => {
    const uid = l.like_user_id;
    if (!classified[uid]) {
      const category = classifyUser(uid, week.start, userWeeks);
      classified[uid] = { id: uid, name: l.like_username || l.like_user_urlname || uid, urlname: l.like_user_urlname || '', followerCount: parseInt(l.follower_count) || 0, articles: [], latestLike: '', category };
    }
    const noteKey = l.note_key;
    const artInfo = categoryTitleMap[noteKey];
    const title = artInfo ? artInfo.title : noteKey;
    if (!classified[uid].articles.includes(title)) classified[uid].articles.push(title);
    const likedDate = (l.liked_at || '').slice(0, 10);
    if (!classified[uid].latestLike || likedDate > classified[uid].latestLike) classified[uid].latestLike = likedDate;
  });

  const prevWeeks = [];
  let w1 = parseDate(week.start);
  for (let i = 0; i < 4; i++) { w1.setDate(w1.getDate() - 7); prevWeeks.push(formatDate(w1)); }

  const olderWeeks = [];
  let w2 = parseDate(week.start);
  for (let i = 0; i < 8; i++) { w2.setDate(w2.getDate() - 7); if (i >= 4) olderWeeks.push(formatDate(w2)); }

  const atRiskUsers = [];
  Object.entries(userWeeks).forEach(([uid, weeks]) => {
    if (classified[uid]) return;
    const recentActive = prevWeeks.filter(pw => weeks.has(pw)).length;
    const olderActive = olderWeeks.filter(ow => weeks.has(ow)).length;
    if (recentActive === 0 && olderActive >= 2) {
      const lastLike = likesData.filter(l => l.like_user_id === uid).pop();
      if (lastLike) atRiskUsers.push({ id: uid, name: lastLike.like_username || lastLike.like_user_urlname || uid, urlname: lastLike.like_user_urlname || '', followerCount: parseInt(lastLike.follower_count) || 0, lastSeen: [...weeks].sort().pop() });
    }
  });
  atRiskUsers.sort((a, b) => b.followerCount - a.followerCount);

  const sortPeople = (a, b) => b.articles.length - a.articles.length || (b.latestLike || '').localeCompare(a.latestLike || '') || b.followerCount - a.followerCount;
  const allClassified = Object.values(classified).sort(sortPeople);
  return {
    newList: allClassified.filter(p => p.category === 'new'),
    returnList: allClassified.filter(p => p.category === 'return'),
    regList: allClassified.filter(p => p.category === 'regular'),
    occasionalList: allClassified.filter(p => p.category === 'occasional'),
    atRiskUsers,
  };
}

// Build set of urlnames I've liked (for suki-return check)
function getMyLikedUrlnames() {
  const set = new Set();
  myLikesData.forEach(l => {
    if (l.author_urlname) set.add(l.author_urlname);
  });
  return set;
}

function personCardHTML(person, week) {
  const profileUrl = person.urlname ? `https://note.com/${person.urlname}` : '#';
  const avatarClass = 'weekly-person-avatar' + (person.category === 'regular' ? ' avatar-regular' : '');
  let statusHTML = '';
  if (myLikesData.length > 0 && person.urlname && week) {
    const returned = getMyReturnCount(person, week) > 0;
    statusHTML = `<div style="font-size:11px;margin-top:2px">${returned ? '<span style="color:var(--accent-green)">✅ スキ返し済</span>' : '<span style="color:var(--accent-amber)">❌ 未スキ返し</span>'}</div>`;
  }
  return `
    <div class="weekly-person">
      <img class="${avatarClass}" data-urlname="${person.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
      <div class="weekly-person-name">
        <a href="${profileUrl}" target="_blank" rel="noopener">${person.name}</a>
        <div class="weekly-person-articles">${person.articles.map(a => `<div class="weekly-person-article-item">${a}</div>`).join('')}</div>
      </div>
      <div class="weekly-person-stats">
        <div>${person.articles.length}記事</div>
        <div>${person.followerCount.toLocaleString()} followers</div>
        ${statusHTML}
      </div>
    </div>`;
}

function toggleUnreturnedFilter() {
  const checked = document.getElementById('filterUnreturned').checked;
  document.querySelectorAll('.weekly-person').forEach(el => {
    if (!checked) {
      el.style.display = '';
      return;
    }
    const hasComplete = el.querySelector('.weekly-person-stats')?.innerHTML.includes('✅');
    el.style.display = hasComplete ? 'none' : '';
  });
}

function getMyReturnCount(person, week) {
  if (!person.urlname || !week || myLikesData.length === 0) return 0;
  return myLikesData.filter(l =>
    l.author_urlname === person.urlname &&
    (l.liked_at || '').slice(0, 10) >= week.start &&
    (l.liked_at || '').slice(0, 10) <= week.end
  ).length;
}

function buildPeopleTabButtons(stats, week) {
  const tabs = [
    { id: 'new', label: '新規', list: stats.newList, active: true },
    { id: 'return', label: '復帰', list: stats.returnList, active: false },
    { id: 'regular', label: '常連', list: stats.regList, active: false },
    { id: 'occasional', label: 'たまに', list: stats.occasionalList, active: false },
  ];
  return tabs.map(t => {
    let count;
    if (myLikesData.length > 0 && week) {
      const returned = t.list.filter(p => getMyReturnCount(p, week) > 0).length;
      count = `${returned}/${t.list.length}`;
    } else {
      count = `${t.list.length}`;
    }
    return `<button class="weekly-people-tab${t.active ? ' active' : ''}" onclick="switchWeeklyPeopleTab(this,'${t.id}')">${t.label}<br><span class="weekly-people-tab-count">（${count}）</span></button>`;
  }).join('');
}

function buildWeeklyPeopleHTML(stats, mode, week) {
  const listMap = { new: stats.newList, return: stats.returnList, regular: stats.regList, occasional: stats.occasionalList };
  const emptyMap = { new: '今週の新規スキなし', return: '復帰なし', regular: '常連なし', occasional: '該当なし' };
  const list = (listMap[mode] || []).slice(0, 15);
  return list.length > 0 ? list.map(p => personCardHTML(p, week)).join('') : `<div style="color:var(--text-muted);font-size:13px;padding:8px 0">${emptyMap[mode] || '該当なし'}</div>`;
}

function buildWeeklyAtRiskHTML(stats) {
  if (stats.atRiskUsers.length === 0) return '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">離脱危機ユーザーなし</div>';
  return stats.atRiskUsers.slice(0, 10).map(p => {
    const profileUrl = p.urlname ? `https://note.com/${p.urlname}` : '#';
    return `
      <div class="weekly-person">
        <img class="weekly-person-avatar" data-urlname="${p.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
        <div class="weekly-person-name">
          <a href="${profileUrl}" target="_blank" rel="noopener">${p.name}</a>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">最終スキ: ${p.lastSeen}</div>
        </div>
        <div class="weekly-person-stats"><div>${p.followerCount.toLocaleString()} followers</div></div>
      </div>`;
  }).join('');
}

function buildWeeklyArticlesHTML(weekArticles, week) {
  if (weekArticles.length === 0) return '<div style="color:var(--text-muted);font-size:13px">今週の公開記事なし</div>';
  const articlePeopleCounts = {};
  if (likesData.length > 0) {
    const beforeWeek = new Set();
    likesData.forEach(l => { const ld = (l.liked_at || '').slice(0, 10); if (ld < week.start) beforeWeek.add(l.like_user_id); });
    likesData.forEach(l => {
      const ld = (l.liked_at || '').slice(0, 10);
      if (ld >= week.start && ld <= week.end) {
        const key = l.note_key;
        if (!articlePeopleCounts[key]) articlePeopleCounts[key] = { newCount: 0, regCount: 0 };
        if (beforeWeek.has(l.like_user_id)) articlePeopleCounts[key].regCount++; else articlePeopleCounts[key].newCount++;
      }
    });
  }
  const catAvgs = getCategoryAvgs();

  // My likes count per date
  const myLikesByDate = {};
  myLikesData.forEach(l => {
    const d = (l.liked_at || '').slice(0, 10);
    if (d) myLikesByDate[d] = (myLikesByDate[d] || 0) + 1;
  });

  return weekArticles.sort((a, b) => (a.published_at || '').localeCompare(b.published_at || '')).map(a => {
    const catColor = getCategoryColor(a.category);
    const pub = a.published_at ? getDayLabel(a.published_at.slice(0, 10)) : '';
    const pc = articlePeopleCounts[a.key] || { newCount: 0, regCount: 0 };
    const ca = catAvgs[a.category] || { avgPV: 0, avgLike: 0 };
    const catName = getCategoryName(a.category);
    const pvColor = a.read_count >= ca.avgPV ? 'var(--accent-green)' : 'var(--accent-pink)';
    const likeColor = a.like_count >= ca.avgLike ? 'var(--accent-green)' : 'var(--accent-pink)';
    const pubDate = a.published_at ? a.published_at.slice(0, 10) : '';
    const myLikeCount = pubDate ? (myLikesByDate[pubDate] || 0) : 0;
    const myLikeHTML = myLikesData.length > 0 ? `<span style="font-size:10px;color:var(--text-muted);margin-left:6px">自分のスキ活: ${myLikeCount}件</span>` : '';
    return `<div class="weekly-article-row">
      <div class="weekly-article-title"><a href="${noteURL(a.key)}" target="_blank" rel="noopener" style="color:var(--text-primary);text-decoration:none"><span class="cat-badge" style="color:${catColor}">${a.category}</span> ${a.title}</a><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${pub}${myLikeHTML}</div></div>
      <div class="weekly-article-stats-row">
        <span class="weekly-article-stat">PV <span style="color:${pvColor};font-weight:600">${a.read_count}</span> <span class="weekly-article-avg">(${catName}平均${ca.avgPV})</span></span>
        <span class="weekly-article-stat">スキ <span style="color:${likeColor};font-weight:600">${a.like_count}</span> <span class="weekly-article-avg">(${catName}平均${ca.avgLike})</span></span>
        <span class="weekly-article-people"><span style="color:var(--accent-green)">新${pc.newCount}</span> / <span style="color:var(--accent-cyan)">固${pc.regCount}</span></span>
      </div>
    </div>`;
  }).join('');
}

function buildWeeklyCatBalanceHTML(weekArticles, catCounts, abCount, monthArticles, monthCats, MONTHLY_IDEAL) {
  const CAT_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const total = weekArticles.length || 1;
  const barHTML = CAT_ORDER.filter(c => catCounts[c]).map(c =>
    `<div class="weekly-cat-bar-seg" style="width:${(catCounts[c]/total*100).toFixed(1)}%;background:${getCategoryColor(c)}">${c}</div>`
  ).join('');

  // Ideal bar (using midpoint of range)
  const idealCounts = {};
  let idealTotal = 0;
  Object.entries(MONTHLY_IDEAL).forEach(([c, [lo, hi]]) => {
    const mid = Math.round((lo + hi) / 2);
    idealCounts[c] = mid;
    idealTotal += mid;
  });
  const idealBarHTML = CAT_ORDER.filter(c => idealCounts[c]).map(c =>
    `<div class="weekly-cat-bar-seg" style="width:${(idealCounts[c]/idealTotal*100).toFixed(1)}%;background:${getCategoryColor(c)};opacity:0.5">${c}</div>`
  ).join('');

  const listHTML = CAT_ORDER.filter(c => catCounts[c]).map(c =>
    `<div class="weekly-cat-item"><div class="weekly-cat-dot" style="background:${getCategoryColor(c)}"></div>${c} ${getCategoryName(c)}: ${catCounts[c]}本</div>`
  ).join('');
  const monthHTML = Object.entries(MONTHLY_IDEAL).map(([c, [lo, hi]]) => {
    const actual = monthCats[c] || 0;
    let judge = '<span style="color:var(--accent-green)">OK</span>';
    if (actual < lo) judge = '<span style="color:var(--accent-amber)">▼少ない</span>';
    else if (actual > hi) judge = '<span style="color:var(--text-muted)">▲多め</span>';
    return `<div class="weekly-cat-item"><div class="weekly-cat-dot" style="background:${getCategoryColor(c)}"></div>${c} ${getCategoryName(c)}: ${actual}本 <span class="weekly-cat-ideal">(理想${lo}〜${hi}) ${judge}</span></div>`;
  }).join('');
  return `
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">今週</div>
    <div class="weekly-cat-bar">${barHTML}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;margin-top:8px">理想</div>
    <div class="weekly-cat-bar" style="opacity:0.6">${idealBarHTML}</div>
    <div class="weekly-cat-list" style="margin-top:12px">${listHTML}</div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">月間カテゴリ比率（直近30日: ${monthArticles.length}本）</div>
      <div class="weekly-cat-pie-layout">
        <canvas id="monthlyCatPie" width="160" height="160" style="flex-shrink:0"></canvas>
        <div class="weekly-cat-list" style="flex:1">${monthHTML}</div>
      </div>
    </div>`;
}

function copyWeeklyReport() {
  const week = getWeekRange();
  const weekArticles = latestSnapshot.filter(a => {
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    return pub >= week.start && pub <= week.end;
  }).sort((a, b) => (a.published_at || '').localeCompare(b.published_at || ''));

  const catAvgs = getCategoryAvgs();
  const catCounts = {};
  weekArticles.forEach(a => { catCounts[a.category] = (catCounts[a.category] || 0) + 1; });

  // Article list
  const articleLines = weekArticles.map(a => {
    const ca = catAvgs[a.category] || { avgPV: 0, avgLike: 0 };
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    return `- ${a.category} #${a.title} PV${a.read_count}(${getCategoryName(a.category)}平均${ca.avgPV}) スキ${a.like_count}(${getCategoryName(a.category)}平均${ca.avgLike})`;
  }).join('\n');

  // Category balance
  const CAT_ORDER = ['A','B','C','D','E','F','G'];
  const weekCatLine = CAT_ORDER.filter(c => catCounts[c]).map(c => `${c}(${getCategoryName(c)})${catCounts[c]}本`).join(', ');

  // Monthly
  const monthAgo = formatDate(new Date(parseDate(week.dataDate).getTime() - 29 * 86400000));
  const monthArticles = latestSnapshot.filter(a => {
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    return pub >= monthAgo && pub <= week.dataDate;
  });
  const monthCats = {};
  monthArticles.forEach(a => { monthCats[a.category] = (monthCats[a.category] || 0) + 1; });
  const monthLine = Object.entries(MONTHLY_IDEAL).map(([c, [lo, hi]]) => {
    const actual = monthCats[c] || 0;
    let judge = 'OK';
    if (actual < lo) judge = '不足';
    else if (actual > hi) judge = '多め';
    return `${c}(${getCategoryName(c)})${actual}本(理想${lo}〜${hi}) ${judge}`;
  }).join(', ');

  // Proposal (read from DOM)
  const proposalEl = document.querySelector('#weeklyContent .weekly-action-list');
  const proposalLines = proposalEl ? Array.from(proposalEl.querySelectorAll('.weekly-action-item')).map(el => '- ' + el.textContent).join('\n') : '';

  const report = `## 今週の振り返り（${week.start}〜${week.end}）

### 記事（${weekArticles.length}本）
${articleLines || '- なし'}

### カテゴリバランス
- 今週: ${weekCatLine || 'なし'}
- 月間（直近30日/${monthArticles.length}本）: ${monthLine}

### 来週の提案
${proposalLines || '- なし'}

### 参考: カテゴリ別スキ率ランキング（タイトルパターン分析用）
${buildEtaRankingForReport()}

---

### 相談
上記の振り返りを踏まえて、以下を提案してください。
1. 来週7本の記事テーマ（カテゴリ配分は提案を参考に）
2. 今週「ひとつだけ壊す」施策（タイトル、タグ、投稿時間、構成など）
3. 前回壊したことの評価（ミニログに記録があれば）
4. 上記スキ率ランキングのタイトルから見える「刺さるパターン」の分析
`;

  navigator.clipboard.writeText(report).then(() => {
    const btn = document.querySelector('.weekly-toolbar .commentary-copy');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'レポートをコピー'; }, 2000); }
  });
}

function buildEtaRankingForReport() {
  const catAvgs = getCategoryAvgs();
  const CAT_ORDER = ['B', 'D', 'C', 'A', 'E']; // η sequence order
  // Last 30 days
  const allDates = [...new Set(articlesData.map(a => a.date))].sort();
  const rptLatest = allDates[allDates.length - 1] || '';
  const rpt30ago = rptLatest ? formatDate(new Date(parseDate(rptLatest).getTime() - 29 * 86400000)) : '';
  return CAT_ORDER.map(c => {
    const arts = latestSnapshot
      .filter(a => {
        if (a.category !== c || a.read_count <= 0) return false;
        const pub = a.published_at ? a.published_at.slice(0, 10) : '';
        return pub >= rpt30ago && pub <= rptLatest;
      })
      .map(a => ({ ...a, eta: a.like_count / a.read_count * 100 }))
      .sort((a, b) => b.eta - a.eta)
      .slice(0, 5);
    if (arts.length === 0) return '';
    const ca = catAvgs[c] || { avgPV: 0, avgLike: 0 };
    const catEta = arts.reduce((s, a) => s + a.read_count, 0) > 0
      ? arts.reduce((s, a) => s + a.like_count, 0) / arts.reduce((s, a) => s + a.read_count, 0) * 100 : 0;
    return `\n**${c} ${getCategoryName(c)}** (平均η${catEta.toFixed(1)}%)\n${arts.map((a, i) => `${i + 1}. η${a.eta.toFixed(1)}% 「${a.title}」`).join('\n')}`;
  }).filter(s => s).join('\n');
}

function buildWeeklyActionHTML(actions) {
  return `<div class="weekly-action-list">${actions.map(a => `<div class="weekly-action-item">${a}</div>`).join('')}</div>`;
}

function getWeekRange() {
  // Latest data date's week (Mon-Sun)
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  if (src.length === 0) return { start: '', end: '', dataDate: '' };
  const dataDate = src[src.length - 1].date;
  const monday = getMondayOf(dataDate);
  const mondayDate = parseDate(monday);
  const sunday = new Date(mondayDate);
  sunday.setDate(sunday.getDate() + 6);
  return { start: monday, end: formatDate(sunday), dataDate };
}

// --- Old weekly functions (replaced by chat-style rendering above) ---
// Kept only switchWeeklyPeopleTab and getProfileImageUrl

function _unused_renderWeeklyFollowerChart() {
  const el = document.getElementById('weeklyFollowerChart');
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  if (src.length < 2) { el.innerHTML = ''; return; }

  // Last 28 days
  const last28 = src.slice(-28);
  const latest = last28[last28.length - 1];
  const first = last28[0];
  const diff = (latest.followerCount || 0) - (first.followerCount || 0);
  const sign = diff >= 0 ? '+' : '';

  // Build chart with canvas
  const labels = last28.map(d => d.date.slice(5)); // MM-DD
  const values = last28.map(d => d.followerCount || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);

  el.innerHTML = `
    <div class="weekly-section">
      <div class="weekly-section-title">フォロワー推移（4週間）<span style="margin-left:12px;color:${diff >= 0 ? 'var(--accent-green)' : 'var(--accent-pink)'};font-size:13px">${latest.followerCount}人（${sign}${diff}）</span></div>
      <div class="weekly-follower-chart">
        <canvas id="weeklyFollowerCanvas"></canvas>
      </div>
    </div>`;

  // Draw chart (wrapped style)
  const PINK = '#fd79a8';
  const canvas = document.getElementById('weeklyFollowerCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.parentElement.clientWidth;
  const H = 180;
  canvas.width = W * 2; canvas.height = H * 2;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.scale(2, 2);

  const pad = { t: 10, b: 30, l: 40, r: 10 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;
  const range = max - min || 1;

  // Grid lines
  ctx.strokeStyle = '#2a2a3a';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#666'; ctx.font = '10px JetBrains Mono'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(max - range * i / 4), pad.l - 4, y + 4);
  }

  // X labels
  ctx.fillStyle = '#666'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(labels.length / 6));
  labels.forEach((l, i) => {
    if (i % step === 0 || i === labels.length - 1) {
      const x = pad.l + cw * i / (labels.length - 1);
      ctx.fillText(l, x, H - 8);
    }
  });

  // Monday markers (week separators)
  ctx.strokeStyle = '#3a3a4a';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4, 4]);
  last28.forEach((d, i) => {
    if (parseDate(d.date).getDay() === 1) {
      const x = pad.l + cw * i / (values.length - 1);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ch); ctx.stroke();
    }
  });
  ctx.setLineDash([]);

  // Fill gradient
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad.l + cw * i / (values.length - 1);
    const y = pad.t + ch * (1 - (v - min) / range);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.l + cw, pad.t + ch);
  ctx.lineTo(pad.l, pad.t + ch);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
  grad.addColorStop(0, 'rgba(253,121,168,0.25)');
  grad.addColorStop(1, 'rgba(253,121,168,0.02)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad.l + cw * i / (values.length - 1);
    const y = pad.t + ch * (1 - (v - min) / range);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = PINK;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // End dot
  const lx = pad.l + cw;
  const ly = pad.t + ch * (1 - (values[values.length - 1] - min) / range);
  ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fillStyle = PINK; ctx.fill();
}

// --- 2. People (new/regular) ---
function renderWeeklyPeople() {
  const el = document.getElementById('weeklyHighlight');
  if (likesData.length === 0) { el.innerHTML = '<div class="weekly-section"><div class="weekly-section-title">今週のスキしてくれた人</div><div style="color:var(--text-muted);font-size:13px">likes.csv データなし</div></div>'; return; }

  const week = getWeekRange();
  if (!week.start) { el.innerHTML = ''; return; }

  const userWeeks = buildUserWeeks();
  const thisWeekLikes = likesData.filter(l => {
    const d = (l.liked_at || '').slice(0, 10);
    return d >= week.start && d <= week.end;
  });

  // Classify this week's likes
  const classified = {};

  thisWeekLikes.forEach(l => {
    const uid = l.like_user_id;
    if (!classified[uid]) {
      const category = classifyUser(uid, week.start, userWeeks);
      classified[uid] = {
        id: uid,
        name: l.like_username || l.like_user_urlname || uid,
        urlname: l.like_user_urlname || '',
        followerCount: parseInt(l.follower_count) || 0,
        articles: [],
        latestLike: '',
        category,
      };
    }
    const noteKey = l.note_key;
    const artInfo = categoryTitleMap[noteKey];
    const title = artInfo ? artInfo.title : noteKey;
    if (!classified[uid].articles.includes(title)) {
      classified[uid].articles.push(title);
    }
    const likedDate = (l.liked_at || '').slice(0, 10);
    if (!classified[uid].latestLike || likedDate > classified[uid].latestLike) {
      classified[uid].latestLike = likedDate;
    }
  });

  // Detect 離脱危機: prev weeks 1-4 inactive, prev weeks 5-8 active 2+
  const prevWeeks = [];
  let w = parseDate(week.start);
  for (let i = 0; i < 4; i++) { w.setDate(w.getDate() - 7); prevWeeks.push(formatDate(w)); }

  const olderWeeks = [];
  let w2 = parseDate(week.start);
  for (let i = 0; i < 8; i++) {
    w2.setDate(w2.getDate() - 7);
    if (i >= 4) olderWeeks.push(formatDate(w2));
  }

  const atRiskUsers = [];
  Object.entries(userWeeks).forEach(([uid, weeks]) => {
    if (classified[uid]) return;
    const recentActive = prevWeeks.filter(pw => weeks.has(pw)).length;
    const olderActive = olderWeeks.filter(ow => weeks.has(ow)).length;
    if (recentActive === 0 && olderActive >= 2) {
      const lastLike = likesData.filter(l => l.like_user_id === uid).pop();
      if (lastLike) {
        atRiskUsers.push({
          id: uid,
          name: lastLike.like_username || lastLike.like_user_urlname || uid,
          urlname: lastLike.like_user_urlname || '',
          followerCount: parseInt(lastLike.follower_count) || 0,
          lastSeen: [...weeks].sort().pop(),
        });
      }
    }
  });
  atRiskUsers.sort((a, b) => b.followerCount - a.followerCount);

  const sortPeople = (a, b) =>
    b.articles.length - a.articles.length ||
    (b.latestLike || '').localeCompare(a.latestLike || '') ||
    b.followerCount - a.followerCount;

  const allClassified = Object.values(classified).sort(sortPeople);
  const newList = allClassified.filter(p => p.category === 'new');
  const returnList = allClassified.filter(p => p.category === 'return');
  const regList = allClassified.filter(p => p.category === 'regular');
  const occasionalList = allClassified.filter(p => p.category === 'occasional');

  function personHTML(person) {
    const profileUrl = person.urlname ? `https://note.com/${person.urlname}` : '#';
    const avatarClass = 'weekly-person-avatar' + (person.category === 'regular' ? ' avatar-regular' : '');
    return `
      <div class="weekly-person">
        <img class="${avatarClass}" data-urlname="${person.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
        <div class="weekly-person-name">
          <a href="${profileUrl}" target="_blank" rel="noopener">${person.name}</a>
          <div class="weekly-person-articles">${person.articles.map(a => `<div class="weekly-person-article-item">${a}</div>`).join('')}</div>
        </div>
        <div class="weekly-person-stats">
          <div>${person.articles.length}記事</div>
          <div>${person.followerCount.toLocaleString()} followers</div>
        </div>
      </div>`;
  }

  const emptyMsg = label => `<div style="color:var(--text-muted);font-size:13px;padding:8px 0">${label}</div>`;
  const showNew = newList.slice(0, 15).map(p => personHTML(p)).join('') || emptyMsg('今週の新規スキなし');
  const showReturn = returnList.slice(0, 15).map(p => personHTML(p)).join('') || emptyMsg('復帰ユーザーなし');
  const showReg = regList.slice(0, 15).map(p => personHTML(p)).join('') || emptyMsg('常連スキなし');
  const showOccasional = occasionalList.slice(0, 15).map(p => personHTML(p)).join('') || emptyMsg('該当なし');

  const showAtRisk = atRiskUsers.slice(0, 10).map(p => {
    const profileUrl = p.urlname ? `https://note.com/${p.urlname}` : '#';
    return `
      <div class="weekly-person">
        <img class="weekly-person-avatar" data-urlname="${p.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
        <div class="weekly-person-name">
          <a href="${profileUrl}" target="_blank" rel="noopener">${p.name}</a>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">最終スキ: ${p.lastSeen}</div>
        </div>
        <div class="weekly-person-stats">
          <div>${p.followerCount.toLocaleString()} followers</div>
        </div>
      </div>`;
  }).join('') || emptyMsg('離脱危機ユーザーなし');

  const tabs = [
    { id: 'new', label: `新規（${newList.length}）`, active: true },
    { id: 'return', label: `復帰（${returnList.length}）`, active: false },
    { id: 'regular', label: `常連（${regList.length}）`, active: false },
    { id: 'occasional', label: `たまに（${occasionalList.length}）`, active: false },
  ];
  const tabsHTML = tabs.map(t => `<button class="weekly-people-tab${t.active ? ' active' : ''}" onclick="switchWeeklyPeopleTab(this,'${t.id}')">${t.label}</button>`).join('');

  el.innerHTML = `
    <div class="weekly-section">
      <div class="weekly-section-title">今週のスキしてくれた人 <span style="font-size:12px;color:var(--text-muted);font-weight:400">${week.start}〜${week.end}</span></div>
      <div class="weekly-people-tabs">${tabsHTML}</div>
      <div class="weekly-people-content" data-tab="new">${showNew}</div>
      <div class="weekly-people-content" data-tab="return" style="display:none">${showReturn}</div>
      <div class="weekly-people-content" data-tab="regular" style="display:none">${showReg}</div>
      <div class="weekly-people-content" data-tab="occasional" style="display:none">${showOccasional}</div>
    </div>

    <div class="weekly-section" style="margin-top:24px">
      <div class="weekly-section-title" style="color:var(--accent-amber)">⚠ 離脱危機 <span style="font-size:12px;font-weight:400;color:var(--text-muted)">以前は頻繁だったが直近4週来ていない</span></div>
      ${showAtRisk}
    </div>`;

  // Async load profile images
  loadWeeklyAvatars();
}

// Profile image resolution — switch implementation here when CSV-based cache is ready
const PROXY_URL = 'https://falling-mouse-736b.hasyamo.workers.dev/';
const _profileImageCache = {};

async function getProfileImageUrl(urlname) {
  if (!urlname) return '';
  if (_profileImageCache[urlname]) return _profileImageCache[urlname];

  // TODO: switch to CSV lookup when fetch_likes.py saves profile image URLs
  // const cached = likesProfileImages[urlname];
  // if (cached) { _profileImageCache[urlname] = cached; return cached; }

  try {
    const res = await fetch(`${PROXY_URL}?id=${encodeURIComponent(urlname)}`);
    if (res.ok) {
      const data = await res.json();
      const url = data.data?.profileImageUrl || '';
      if (url) _profileImageCache[urlname] = url;
      return url;
    }
  } catch (e) {}
  return '';
}

async function loadWeeklyAvatars() {
  const imgs = document.querySelectorAll('.weekly-person-avatar[data-urlname]');
  for (const img of imgs) {
    const urlname = img.dataset.urlname;
    const url = await getProfileImageUrl(urlname);
    if (url) img.src = url;
  }
}

function switchWeeklyPeopleTab(btn, tab) {
  btn.parentElement.querySelectorAll('.weekly-people-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const section = btn.closest('.weekly-section');
  section.querySelectorAll('.weekly-people-content').forEach(el => {
    el.style.display = el.dataset.tab === tab ? '' : 'none';
  });
}

// --- 3. This week's articles ---
function renderWeeklyArticles() {
  const el = document.getElementById('weeklyCategoryBalance');
  const week = getWeekRange();
  if (!week.start) { el.innerHTML = ''; return; }

  // Articles published this week
  const weekArticles = latestSnapshot.filter(a => {
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    return pub >= week.start && pub <= week.end;
  }).sort((a, b) => (a.published_at || '').localeCompare(b.published_at || ''));

  if (weekArticles.length === 0) {
    el.innerHTML = '<div class="weekly-section"><div class="weekly-section-title">今週の記事</div><div style="color:var(--text-muted);font-size:13px">今週の公開記事なし</div></div>';
    return;
  }

  // New/regular counts per article from likes
  const articlePeopleCounts = {};
  if (likesData.length > 0) {
    const beforeWeek = new Set();
    likesData.forEach(l => {
      const ld = (l.liked_at || '').slice(0, 10);
      if (ld < week.start) beforeWeek.add(l.like_user_id);
    });
    likesData.forEach(l => {
      const ld = (l.liked_at || '').slice(0, 10);
      if (ld >= week.start && ld <= week.end) {
        const key = l.note_key;
        if (!articlePeopleCounts[key]) articlePeopleCounts[key] = { newCount: 0, regCount: 0 };
        if (beforeWeek.has(l.like_user_id)) articlePeopleCounts[key].regCount++;
        else articlePeopleCounts[key].newCount++;
      }
    });
  }

  const rows = weekArticles.map(a => {
    const catColor = getCategoryColor(a.category);
    const catName = getCategoryName(a.category);
    const pub = a.published_at ? getDayLabel(a.published_at.slice(0, 10)) : '';
    const pc = articlePeopleCounts[a.key] || { newCount: 0, regCount: 0 };
    return `
      <div class="weekly-article-row">
        <div class="weekly-article-title">
          <span class="cat-badge" style="color:${catColor}">${a.category}</span> ${a.title}
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${pub}</div>
        </div>
        <div class="weekly-article-stat">PV ${a.read_count}</div>
        <div class="weekly-article-stat">スキ ${a.like_count}</div>
        <div class="weekly-article-people">
          <span style="color:var(--accent-green)">新${pc.newCount}</span> / <span style="color:var(--accent-cyan)">固${pc.regCount}</span>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="weekly-section">
      <div class="weekly-section-title">今週の記事（${weekArticles.length}本）</div>
      ${rows}
    </div>`;
}

// --- 4. Category Balance ---
function renderWeeklyCategoryBalance() {
  const el = document.getElementById('weeklyAction');
  const week = getWeekRange();
  if (!week.start) { el.innerHTML = ''; return; }

  // This week's articles by category
  const weekArticles = latestSnapshot.filter(a => {
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    return pub >= week.start && pub <= week.end;
  });

  const catCounts = {};
  const CAT_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  weekArticles.forEach(a => { catCounts[a.category] = (catCounts[a.category] || 0) + 1; });
  const abCount = (catCounts['A'] || 0) + (catCounts['B'] || 0);

  // Category bar
  const total = weekArticles.length || 1;
  const barHTML = CAT_ORDER.filter(c => catCounts[c]).map(c =>
    `<div class="weekly-cat-bar-seg" style="width:${(catCounts[c]/total*100).toFixed(1)}%;background:${getCategoryColor(c)}" title="${c}(${getCategoryName(c)}): ${catCounts[c]}本">${c}</div>`
  ).join('');

  // Category list
  const listHTML = CAT_ORDER.filter(c => catCounts[c]).map(c =>
    `<div class="weekly-cat-item"><div class="weekly-cat-dot" style="background:${getCategoryColor(c)}"></div>${c} ${getCategoryName(c)}: ${catCounts[c]}本</div>`
  ).join('');

  // Monthly ideal comparison (last 30 days)
  const dataDate = week.dataDate;
  const monthAgo = formatDate(new Date(parseDate(dataDate).getTime() - 29 * 86400000));
  const monthArticles = latestSnapshot.filter(a => {
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    return pub >= monthAgo && pub <= dataDate;
  });
  const monthCats = {};
  monthArticles.forEach(a => { monthCats[a.category] = (monthCats[a.category] || 0) + 1; });

  // MONTHLY_IDEAL is defined as global constant
  const monthHTML = Object.entries(MONTHLY_IDEAL).map(([c, [lo, hi]]) => {
    const actual = monthCats[c] || 0;
    let judge = '<span style="color:var(--accent-green)">OK</span>';
    if (actual < lo) judge = '<span style="color:var(--accent-amber)">▼少ない</span>';
    else if (actual > hi) judge = '<span style="color:var(--text-muted)">▲多め</span>';
    return `<div class="weekly-cat-item"><div class="weekly-cat-dot" style="background:${getCategoryColor(c)}"></div>${c} ${getCategoryName(c)}: ${actual}本 <span class="weekly-cat-ideal">(理想${lo}〜${hi}) ${judge}</span></div>`;
  }).join('');

  // A+B status
  const abCls = abCount >= 2 ? 'ok' : 'warn';
  const abMsg = abCount >= 2
    ? `A+B = ${abCount}本（一次情報ゾーン維持）`
    : `A+B = ${abCount}本（2本未満。来週はA or Bを増やす）`;

  // Actions
  // Build next week's category proposal (7 articles)
  // Strategy: monthly ideal - (current month including this week) = remaining need
  // Then distribute 7 articles to fill gaps, with η-priority (B>D>C>A>E)
  const proposal = {};
  let remaining = 7;

  // Monthly counts already include this week. Simulate adding next week's 7 articles.
  // Calculate how many more each category needs to reach ideal midpoint
  const need = {};
  Object.entries(MONTHLY_IDEAL).forEach(([c, [lo, hi]]) => {
    const actual = monthCats[c] || 0;
    const mid = Math.round((lo + hi) / 2);
    need[c] = Math.max(0, mid - actual);
  });

  // 1. D minimum 1 (minilog fixed)
  proposal['D'] = 1; remaining--;

  // 2. Fill categories that need the most (η priority for ties)
  const fillOrder = ['B', 'D', 'C', 'A', 'E'];
  const WEEKLY_MAX = 3;

  // First pass: fill needs
  for (const c of fillOrder) {
    if (remaining <= 0) break;
    const n = need[c] - (proposal[c] || 0);
    if (n > 0) {
      const fill = Math.min(n, remaining, WEEKLY_MAX - (proposal[c] || 0));
      if (fill > 0) {
        proposal[c] = (proposal[c] || 0) + fill;
        remaining -= fill;
      }
    }
  }

  // Second pass: fill remaining with η priority (avoid categories that were heavy this week)
  while (remaining > 0) {
    let filled = false;
    for (const c of fillOrder) {
      if (remaining <= 0) break;
      if ((proposal[c] || 0) >= WEEKLY_MAX) continue;
      // Skip if this category was heavy this week (3+ articles)
      if ((catCounts[c] || 0) >= 3 && remaining > 1) continue;
      proposal[c] = (proposal[c] || 0) + 1;
      remaining--;
      filled = true;
    }
    if (!filled) break;
  }

  const proposalText = ['A','B','C','D','E','G']
    .filter(c => proposal[c])
    .map(c => `${getCategoryName(c)} ${proposal[c]}本`)
    .join('、');

  const actions = [];
  actions.push(`来週の提案: ${proposalText}`);

  // Monthly shortage/excess notes
  Object.entries(MONTHLY_IDEAL).forEach(([c, [lo, hi]]) => {
    const actual = monthCats[c] || 0;
    if (actual < lo) actions.push(`${c}(${getCategoryName(c)})が月間で不足 → 優先的に配置`);
  });

  // Title advice
  actions.push('タイトルに「結果示唆」を入れる → 「わかった」「変わった」「結果」でη +4pt');

  const actionsHTML = actions.map(a => `<div class="weekly-action-item">${a}</div>`).join('');

  el.innerHTML = `
    <div class="weekly-section">
      <div class="weekly-section-title">カテゴリバランス</div>
      <div class="weekly-cat-bar">${barHTML}</div>
      <div class="weekly-cat-list">${listHTML}</div>
      <div class="weekly-ab-status ${abCls}">${abMsg}</div>
    </div>

    <div class="weekly-section" style="margin-top:24px">
      <div class="weekly-section-title">月間カテゴリ比率（直近30日: ${monthArticles.length}本）</div>
      <div class="weekly-cat-list">${monthHTML}</div>
    </div>

    <div class="weekly-section" style="margin-top:24px">
      <div class="weekly-action-label">祈るな、設計しろ。</div>
      <div class="weekly-action-list">${actionsHTML}</div>
    </div>`;
}

// Placeholder - called by renderWeeklyTab but content is merged into renderWeeklyCategoryBalance
function renderWeeklyAction() {}

// ===== 1. Ranking =====
let rankingTopN = 20;

let rankingCatFilter = 'all';

function renderRanking() {
  const container = document.getElementById('rankingChart');
  // Filter to last 30 days
  const allDates = [...new Set(articlesData.map(a => a.date))].sort();
  const rankLatestDate = allDates[allDates.length - 1] || '';
  const rank30ago = rankLatestDate ? formatDate(new Date(parseDate(rankLatestDate).getTime() - 29 * 86400000)) : '';
  const recent30 = latestSnapshot.filter(a => {
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    return pub >= rank30ago && pub <= rankLatestDate;
  });
  const filtered = rankingCatFilter === 'all' ? recent30 : recent30.filter(a => a.category === rankingCatFilter);
  const sorted = [...filtered]
    .map(a => ({ ...a, eta: a.read_count > 0 ? (a.like_count / a.read_count * 100) : 0 }))
    .sort((a, b) => b.eta - a.eta);

  const top = sorted.slice(0, rankingTopN);
  const maxEta = Math.max(...top.map(a => a.eta), 1);

  container.innerHTML = top.map((a, i) => {
    const pct = (a.eta / maxEta * 100).toFixed(1);
    const cat = a.category || '?';
    const catColor = getCategoryColor(cat);
    const shortTitle = a.title.replace(/^【.*?】/, '').replace(/\|.*$/, '').trim();
    const catInfo = cat !== '?' ? ` / カテゴリ: ${cat}（${getCategoryName(cat)}）` : '';
    return `
      <div class="bar-row" onmouseenter="showTooltip(event, '${escHtml(a.title)}', 'PV: ${a.read_count} / スキ: ${a.like_count} / η: ${a.eta.toFixed(1)}%${catInfo}')" onmouseleave="hideTooltip()">
        <div class="bar-label-wrap">
          <div class="bar-title"><span class="cat-badge" style="color:${catColor}">[${cat}]</span>${shortTitle || a.key}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background: linear-gradient(90deg, ${catColor}, ${catColor}88);"></div></div>
        </div>
        <div class="bar-value" style="color:${catColor}">${a.eta.toFixed(1)}%</div>
      </div>`;
  }).join('');

  document.getElementById('rankingLegend').innerHTML = Object.entries(CATEGORY_META).map(([k, v]) =>
    `<div class="decay-legend-item"><div class="decay-legend-dot" style="background:${v.color}"></div>${k} ${v.name}</div>`
  ).join('');
}

// ===== 2. Scatter =====
let scatterMode = 'eta'; // 'eta' or 'category'

function renderScatter() {
  const canvas = document.getElementById('scatterCanvas');
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;

  ctx.clearRect(0, 0, W, H);

  if (latestSnapshot.length === 0) return;

  const pad = { top: 20, right: 20, bottom: 40, left: 50 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const maxPV = Math.max(...latestSnapshot.map(a => a.read_count), 1);
  const maxLike = Math.max(...latestSnapshot.map(a => a.like_count), 1);

  // Grid lines
  ctx.strokeStyle = '#1e1e2e';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    const x = pad.left + (cw / 4) * i;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
  }

  // Average eta line (diagonal)
  const avgEta = latestSnapshot.reduce((s, a) => s + a.like_count, 0) /
                 Math.max(latestSnapshot.reduce((s, a) => s + a.read_count, 0), 1);
  ctx.strokeStyle = '#ffb02044';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + ch);
  const diagX = pad.left + cw;
  const diagY = pad.top + ch - (maxPV * avgEta / maxLike) * ch;
  ctx.lineTo(diagX, Math.max(diagY, pad.top));
  ctx.stroke();
  ctx.setLineDash([]);

  // Avg eta label
  ctx.fillStyle = '#ffb02088';
  ctx.font = '12px JetBrains Mono';
  ctx.fillText(`avg η=${(avgEta * 100).toFixed(1)}%`, diagX - 80, Math.max(diagY, pad.top) - 4);

  // Points
  const points = latestSnapshot.map(a => {
    const x = pad.left + (a.read_count / maxPV) * cw;
    const y = pad.top + ch - (a.like_count / maxLike) * ch;
    const eta = a.read_count > 0 ? a.like_count / a.read_count : 0;
    return { x, y, eta, ...a };
  });

  points.forEach(p => {
    let color, radius;
    if (scatterMode === 'category') {
      const cat = p.category || '?';
      color = getCategoryColor(cat);
      const meta = CATEGORY_META[cat];
      radius = (meta && meta.primary) ? 7 : (cat === 'F' || cat === 'G') ? 3 : 5;
    } else {
      const isHigh = p.eta > avgEta * 1.5;
      const isLow = p.eta < avgEta * 0.5 && p.read_count > maxPV * 0.2;
      color = '#00d4ff';
      radius = 4;
      if (isHigh) { color = '#00e676'; radius = 6; }
      if (isLow) { color = '#ff3d8e'; radius = 6; }
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color + '88';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (scatterMode === 'eta') {
      const isHigh = p.eta > avgEta * 1.5;
      const isLow = p.eta < avgEta * 0.5 && p.read_count > maxPV * 0.2;
      if (isHigh || isLow) {
        ctx.fillStyle = isHigh ? '#00e676' : '#ff3d8e';
        ctx.font = '11px JetBrains Mono';
        const label = p.title.replace(/^【.*?】/, '').replace(/\|.*$/, '').substring(0, 15);
        ctx.fillText(label, p.x + 8, p.y - 4);
      }
    }
  });

  // Axes labels
  ctx.fillStyle = '#555570';
  ctx.font = '12px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.fillText('PV →', W / 2, H - 8);
  ctx.save();
  ctx.translate(12, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('スキ →', 0, 0);
  ctx.restore();
  ctx.textAlign = 'start';

  // Axis numbers
  ctx.fillStyle = '#555570';
  ctx.font = '11px JetBrains Mono';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = Math.round(maxLike / 4 * (4 - i));
    ctx.fillText(val, pad.left - 6, pad.top + (ch / 4) * i + 4);
  }
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const val = Math.round(maxPV / 4 * i);
    ctx.fillText(val, pad.left + (cw / 4) * i, H - pad.bottom + 16);
  }

  // Legend
  const legend = document.getElementById('scatterLegend');
  if (scatterMode === 'category') {
    legend.innerHTML = Object.entries(CATEGORY_META).map(([k, v]) =>
      `<div class="decay-legend-item"><div class="decay-legend-dot" style="background:${v.color}"></div>${k} ${v.name}</div>`
    ).join('');
  } else {
    legend.innerHTML = `
      <div class="decay-legend-item"><div class="decay-legend-dot" style="background:#00e676"></div>η高（平均×1.5以上）</div>
      <div class="decay-legend-item"><div class="decay-legend-dot" style="background:#00d4ff"></div>η平均付近</div>
      <div class="decay-legend-item"><div class="decay-legend-dot" style="background:#ff3d8e"></div>η低（平均×0.5以下）</div>`;
  }

  // Canvas tooltip
  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let found = null;
    for (const p of points) {
      if (Math.hypot(p.x - mx, p.y - my) < 10) { found = p; break; }
    }
    if (found) {
      const cat = found.category || '?';
      const catInfo = cat !== '?' ? ` / カテゴリ: ${cat}（${getCategoryName(cat)}）` : '';
      showTooltip(e, found.title, `PV: ${found.read_count} / スキ: ${found.like_count} / η: ${(found.eta * 100).toFixed(1)}%${catInfo}`);
    } else {
      hideTooltip();
    }
  };
  canvas.onmouseleave = hideTooltip;
}

// Note: ranking/scatter toggle listeners are now in renderDeepDive()

// ===== 3. Category η Comparison =====
function renderCategoryChart() {
  const canvas = document.getElementById('categoryCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);

  if (latestSnapshot.length === 0) return;

  // Aggregate by category
  const catStats = {};
  latestSnapshot.forEach(a => {
    const cat = a.category || '?';
    if (cat === '?') return;
    if (!catStats[cat]) catStats[cat] = { totalPV: 0, totalLikes: 0, count: 0 };
    catStats[cat].totalPV += a.read_count;
    catStats[cat].totalLikes += a.like_count;
    catStats[cat].count++;
  });

  const categories = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const catData = categories.map(c => {
    const s = catStats[c] || { totalPV: 0, totalLikes: 0, count: 0 };
    return {
      cat: c,
      eta: s.totalPV > 0 ? (s.totalLikes / s.totalPV * 100) : 0,
      count: s.count,
      avgPV: s.count > 0 ? Math.round(s.totalPV / s.count) : 0,
    };
  }).filter(d => d.count > 0);

  if (catData.length === 0) return;

  const pad = { top: 20, right: 160, bottom: 20, left: 120 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;
  const barHeight = Math.min(32, ch / catData.length - 8);
  const gap = (ch - barHeight * catData.length) / Math.max(catData.length - 1, 1);
  const maxEta = Math.max(...catData.map(d => d.eta), 1);

  // Overall avg eta
  const totalLikes = latestSnapshot.reduce((s, a) => s + a.like_count, 0);
  const totalPV = latestSnapshot.reduce((s, a) => s + a.read_count, 0);
  const overallEta = totalPV > 0 ? (totalLikes / totalPV * 100) : 0;

  // A+B background highlight
  const primaryCats = catData.filter(d => CATEGORY_META[d.cat] && CATEGORY_META[d.cat].primary);
  if (primaryCats.length > 0) {
    const firstIdx = catData.indexOf(primaryCats[0]);
    const lastIdx = catData.indexOf(primaryCats[primaryCats.length - 1]);
    const yStart = pad.top + firstIdx * (barHeight + gap) - 4;
    const yEnd = pad.top + lastIdx * (barHeight + gap) + barHeight + 4;
    ctx.fillStyle = '#00d4ff08';
    ctx.fillRect(pad.left, yStart, cw, yEnd - yStart);
    ctx.fillStyle = '#00d4ff30';
    ctx.font = '10px JetBrains Mono';
    ctx.textAlign = 'left';
    ctx.fillText('一次情報ゾーン', pad.left + 4, yStart + 10);
  }

  // Overall avg eta vertical line
  const avgX = pad.left + (overallEta / maxEta) * cw;
  ctx.strokeStyle = '#ffb02044';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(avgX, pad.top);
  ctx.lineTo(avgX, pad.top + ch);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffb02077';
  ctx.font = '10px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.fillText(`全体η=${overallEta.toFixed(1)}%`, avgX, pad.top - 6);

  // Draw bars
  const barPoints = [];
  catData.forEach((d, i) => {
    const y = pad.top + i * (barHeight + gap);
    const barW = (d.eta / maxEta) * cw;
    const color = getCategoryColor(d.cat);
    const meta = CATEGORY_META[d.cat];
    const opacity = d.cat === 'F' ? '66' : 'cc';

    // Bar
    ctx.fillStyle = color + opacity;
    ctx.fillRect(pad.left, y, barW, barHeight);

    // Label left
    ctx.fillStyle = color;
    ctx.font = '13px JetBrains Mono';
    ctx.textAlign = 'right';
    ctx.fillText(`[${d.cat}] ${meta ? meta.name : '?'}`, pad.left - 8, y + barHeight / 2 + 5);

    // Stats right
    ctx.fillStyle = '#8888a0';
    ctx.font = '12px JetBrains Mono';
    ctx.textAlign = 'left';
    ctx.fillText(`${d.eta.toFixed(1)}%  (${d.count}記事 / avg ${d.avgPV} PV)`, pad.left + barW + 8, y + barHeight / 2 + 5);

    barPoints.push({ x: pad.left, y, w: barW, h: barHeight, ...d });
  });

  document.getElementById('catBadge').textContent = `${catData.length} categories`;

  // Legend
  document.getElementById('categoryLegend').innerHTML = `
    <div class="decay-legend-item" style="color:#00d4ff55">■ 一次情報ゾーン（A+B）</div>
    <div class="decay-legend-item" style="color:#ffb02077">--- 全体平均 η=${overallEta.toFixed(1)}%</div>`;

  // Tooltip
  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let found = null;
    for (const b of barPoints) {
      if (mx >= b.x && mx <= b.x + b.w + 160 && my >= b.y && my <= b.y + b.h) { found = b; break; }
    }
    if (found) {
      showTooltip(e, `カテゴリ${found.cat}: ${getCategoryName(found.cat)}`,
        `平均η: ${found.eta.toFixed(1)}% / 記事数: ${found.count} / 平均PV: ${found.avgPV}`);
    } else {
      hideTooltip();
    }
  };
  canvas.onmouseleave = hideTooltip;
}

// ===== 4. Recent Articles η Dot Plot =====
function renderEtaTrend() {
  const canvas = document.getElementById('etaTrendCanvas');
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);

  const dates = [...new Set(articlesData.map(a => a.date))].sort();
  const latestDate = dates[dates.length - 1];

  // Build 14-day range ending at latestDate
  const endDate = new Date(latestDate + 'T00:00:00');
  const daySlots = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    daySlots.push(iso);
  }

  // Find articles published within this 14-day range, using latest snapshot eta
  const recentArticles = latestSnapshot
    .filter(a => {
      if (!a.published_at) return false;
      const pubDay = a.published_at.substring(0, 10);
      return pubDay >= daySlots[0] && pubDay <= daySlots[daySlots.length - 1];
    })
    .map(a => ({
      ...a,
      pubDay: a.published_at.substring(0, 10),
      eta: a.read_count > 0 ? (a.like_count / a.read_count * 100) : 0,
    }));

  if (recentArticles.length === 0) {
    ctx.fillStyle = '#555570';
    ctx.font = '15px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('直近2週間に投稿された記事がありません', W / 2, H / 2);
    document.getElementById('etaTrendLegend').innerHTML = '';
    document.getElementById('etaTrendBadge').textContent = '0 articles';
    return;
  }

  const pad = { top: 28, right: 40, bottom: 58, left: 55 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  // Y scale
  const maxEta = Math.ceil(Math.max(...recentArticles.map(a => a.eta), 10) / 5) * 5;

  // Grid
  const gridSteps = 5;
  for (let i = 0; i <= gridSteps; i++) {
    const y = pad.top + (ch / gridSteps) * i;
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();

    const val = (maxEta / gridSteps * (gridSteps - i)).toFixed(0);
    ctx.fillStyle = '#555570';
    ctx.font = '11px JetBrains Mono';
    ctx.textAlign = 'right';
    ctx.fillText(val + '%', pad.left - 8, y + 3);
  }

  // Category averages for comparison (last 30 days)
  const thirtyDaysAgo = formatDate(new Date(parseDate(latestDate).getTime() - 29 * 86400000));
  const catEtas = {};
  ['A','B','C','D','E','F','G'].forEach(c => {
    const arts = latestSnapshot.filter(a => {
      if (a.category !== c) return false;
      const pub = a.published_at ? a.published_at.slice(0, 10) : '';
      return pub >= thirtyDaysAgo && pub <= latestDate;
    });
    if (arts.length === 0) return;
    const totalPV = arts.reduce((s, a) => s + a.read_count, 0);
    const totalLike = arts.reduce((s, a) => s + a.like_count, 0);
    catEtas[c] = totalPV > 0 ? totalLike / totalPV * 100 : 0;
  });

  // X axis - 14 day slots
  const slotWidth = cw / daySlots.length;

  // Vertical slot separators (subtle)
  daySlots.forEach((d, i) => {
    const x = pad.left + slotWidth * i + slotWidth / 2;
    ctx.strokeStyle = '#1a1a28';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch); ctx.stroke();
  });

  // X labels
  const dowLabels = ['日', '月', '火', '水', '木', '金', '土'];
  ctx.font = '11px JetBrains Mono';
  ctx.textAlign = 'center';
  daySlots.forEach((d, i) => {
    const x = pad.left + slotWidth * i + slotWidth / 2;
    const label = d.substring(5); // MM-DD
    const dayOfWeek = new Date(d + 'T00:00:00').getDay();
    const dowLabel = `(${dowLabels[dayOfWeek]})`;
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      ctx.fillStyle = '#666680';
    } else {
      ctx.fillStyle = '#444460';
    }
    ctx.fillText(label, x, H - pad.bottom + 16);
    ctx.fillText(dowLabel, x, H - pad.bottom + 30);
  });

  // Plot dots
  const plotPoints = [];
  // Group articles by pubDay to handle same-day offsets
  const byDay = {};
  recentArticles.forEach(a => {
    if (!byDay[a.pubDay]) byDay[a.pubDay] = [];
    byDay[a.pubDay].push(a);
  });

  Object.entries(byDay).forEach(([day, articles]) => {
    const slotIdx = daySlots.indexOf(day);
    if (slotIdx === -1) return;
    const cx = pad.left + slotWidth * slotIdx + slotWidth / 2;

    articles.forEach((a, j) => {
      const cy = pad.top + ch - (a.eta / maxEta) * ch;
      // Offset horizontally if multiple on same day
      const offset = articles.length > 1 ? (j - (articles.length - 1) / 2) * 14 : 0;
      const px = cx + offset;

      // Color by category
      const cat = a.category || '?';
      const color = cat !== '?' ? getCategoryColor(cat) : '#00d4ff';

      // Glow
      ctx.beginPath();
      ctx.arc(px, cy, 10, 0, Math.PI * 2);
      ctx.fillStyle = color + '15';
      ctx.fill();

      // Dot
      ctx.beginPath();
      ctx.arc(px, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = color + 'cc';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Category label above η
      if (cat !== '?') {
        ctx.fillStyle = color + '99';
        ctx.font = '9px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.fillText(`[${cat}]`, px, cy - 22);
      }

      // η label above dot
      ctx.fillStyle = color;
      ctx.font = 'bold 12px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText(a.eta.toFixed(1) + '%', px, cy - 12);

      // Category avg diff below dot
      const catEta = catEtas[cat] || 0;
      const diff = a.eta - catEta;
      const diffStr = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
      ctx.font = '9px JetBrains Mono';
      ctx.fillStyle = diff >= 0 ? '#00e676' : '#ff3d8e';
      ctx.fillText(diffStr, px, cy + 16);

      plotPoints.push({ x: px, y: cy, color, ...a });
    });
  });

  document.getElementById('etaTrendBadge').textContent = `${recentArticles.length} articles`;

  // Legend - category colors
  const legend = document.getElementById('etaTrendLegend');
  legend.innerHTML = Object.entries(CATEGORY_META).map(([k, v]) => {
    const ce = catEtas[k];
    return ce ? `<div class="decay-legend-item"><div class="decay-legend-dot" style="background:${v.color}"></div>${k} ${v.name} (η${ce.toFixed(1)}%)</div>` : '';
  }).join('') + `<div class="decay-legend-item" style="margin-left:12px;color:var(--text-muted)">数値は直近30日のカテゴリ平均との差</div>`;

  // Report card (通信簿)
  const reportEl = document.getElementById('etaTrendReport');
  const reportCats = ['A','B','C','D','E'].filter(c => {
    return recentArticles.some(a => a.category === c) && catEtas[c];
  });
  if (reportCats.length > 0) {
    const cards = reportCats.map(c => {
      const arts = recentArticles.filter(a => a.category === c);
      const avgDiff = arts.reduce((s, a) => s + (a.eta - (catEtas[c] || 0)), 0) / arts.length;
      const score = Math.max(0, Math.min(100, Math.round(50 + avgDiff * 10)));
      const color = getCategoryColor(c);
      const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'E';
      return `<div style="text-align:center;flex:1;min-width:80px">
        <div style="font-family:var(--font-mono);font-size:11px;color:${color};font-weight:600;margin-bottom:4px">${c} ${getCategoryName(c)}</div>
        <div style="font-size:28px;font-weight:900;color:${score >= 50 ? 'var(--accent-green)' : 'var(--accent-pink)'}">${score}</div>
        <div style="font-size:10px;color:var(--text-muted)">${arts.length}本 / 平均差${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(1)}pt</div>
      </div>`;
    }).join('');
    reportEl.innerHTML = `<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
      <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);margin-bottom:12px">直近2週間の通信簿（50点=カテゴリ平均）</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">${cards}</div>
    </div>`;
  } else {
    reportEl.innerHTML = '';
  }

  // Tooltip
  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let found = null;
    for (const p of plotPoints) {
      if (Math.hypot(p.x - mx, p.y - my) < 12) { found = p; break; }
    }
    if (found) {
      showTooltip(e, found.title, `投稿: ${found.pubDay} / PV: ${found.read_count} / スキ: ${found.like_count} / η: ${found.eta.toFixed(1)}%`);
    } else {
      hideTooltip();
    }
  };
  canvas.onmouseleave = hideTooltip;
}

// ===== 4. Article Daily Trend (sparkline rows) =====
let trendDeltaCache = null;
let trendActiveMetric = 'pv_delta';

function computeDailyDeltas() {
  const byId = {};
  articlesData.forEach(a => {
    if (!byId[a.note_id]) byId[a.note_id] = [];
    byId[a.note_id].push(a);
  });

  const allDates = [...new Set(articlesData.map(a => a.date))].sort();
  if (allDates.length < 2) return { dates: [], series: [] };

  const deltaDates = allDates.slice(1);
  const series = [];
  Object.entries(byId).forEach(([noteId, rows]) => {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const deltas = [];
    let totalPvDelta = 0, totalLikeDelta = 0;
    for (let i = 1; i < rows.length; i++) {
      const pvDelta = Math.max(0, rows[i].read_count - rows[i - 1].read_count);
      const likeDelta = Math.max(0, rows[i].like_count - rows[i - 1].like_count);
      deltas.push({ date: rows[i].date, pv_delta: pvDelta, like_delta: likeDelta });
      totalPvDelta += pvDelta;
      totalLikeDelta += likeDelta;
    }
    series.push({
      note_id: noteId, key: rows[0].key, title: rows[0].title,
      published_at: rows[0].published_at || '',
      category: rows[0].category || '?',
      totalPvDelta, totalLikeDelta, deltas,
    });
  });
  return { dates: deltaDates, series };
}

function filterTrendSeries(allData, metric) {
  const dayFilter = parseInt(document.getElementById('trendDayFilter').value) || 0;
  const minDelta = parseInt(document.getElementById('trendMinDelta').value) || 0;
  let filtered = allData.series;

  if (dayFilter > 0 && allData.dates.length > 0) {
    const latestDate = allData.dates[allData.dates.length - 1];
    const cutoff = new Date(latestDate + 'T00:00:00');
    cutoff.setDate(cutoff.getDate() - dayFilter);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}-${String(cutoff.getDate()).padStart(2,'0')}`;
    filtered = filtered.filter(s => s.published_at && s.published_at.substring(0, 10) >= cutoffStr);
  }

  if (minDelta > 0) {
    const totalKey = metric === 'pv_delta' ? 'totalPvDelta' : 'totalLikeDelta';
    filtered = filtered.filter(s => s[totalKey] >= minDelta);
  }

  const catFilter = document.getElementById('trendCatFilter').value;
  if (catFilter) {
    const cats = catFilter.split('');
    filtered = filtered.filter(s => cats.includes(s.category));
  }

  filtered.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  return filtered;
}

function drawSparkline(canvas, deltas, dates, metric, color, pubDate) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  if (deltas.length === 0) return;

  const padX = 4;
  const padTop = 14;
  const padBottom = 16; // space for date labels
  const cw = W - padX * 2;
  const ch = H - padTop - padBottom;

  const vals = dates.map(d => {
    const found = deltas.find(dd => dd.date === d);
    return found ? found[metric] : 0;
  });
  const maxVal = Math.max(...vals, 1);

  const xPos = (i) => padX + (cw / Math.max(vals.length - 1, 1)) * i;
  const yPos = (v) => padTop + ch - (v / maxVal) * ch;

  // Fill area
  ctx.beginPath();
  ctx.moveTo(padX, padTop + ch);
  vals.forEach((v, i) => ctx.lineTo(xPos(i), yPos(v)));
  ctx.lineTo(padX + cw, padTop + ch);
  ctx.closePath();
  ctx.fillStyle = color + '18';
  ctx.fill();

  // Line
  ctx.beginPath();
  vals.forEach((v, i) => {
    if (i === 0) ctx.moveTo(xPos(i), yPos(v));
    else ctx.lineTo(xPos(i), yPos(v));
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dots
  vals.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(xPos(i), yPos(v), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  // Publish date marker
  if (pubDate) {
    // Find nearest date in dates array (delta dates start from day after first data)
    const pubIdx = dates.indexOf(pubDate);
    // Also check if pubDate is one day before the first delta date
    if (pubIdx >= 0) {
      const px = xPos(pubIdx);
      ctx.strokeStyle = color + '66';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, padTop + ch);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color + 'aa';
      ctx.font = '9px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText('pub', px, padTop - 2);
    }
  }

  // X-axis date labels (first and last only)
  ctx.fillStyle = '#888888';
  ctx.font = '11px JetBrains Mono';
  const fmt = (d) => d.substring(5).replace('-', '/');
  // First date
  ctx.textAlign = 'start';
  ctx.fillText(fmt(dates[0]), padX, H - 2);
  // Last date
  if (dates.length > 1) {
    ctx.textAlign = 'end';
    ctx.fillText(fmt(dates[dates.length - 1]), padX + cw, H - 2);
  }
}

function renderTrendRows() {
  if (!trendDeltaCache || trendDeltaCache.dates.length === 0) {
    document.getElementById('trendRows').innerHTML = '<div class="no-data">差分データがありません（2日以上のデータが必要）</div>';
    document.getElementById('trendBadge').textContent = '0 articles';
    return;
  }

  const metric = trendActiveMetric;
  const filtered = filterTrendSeries(trendDeltaCache, metric);
  const dates = trendDeltaCache.dates;
  const container = document.getElementById('trendRows');
  const totalKey = metric === 'pv_delta' ? 'totalPvDelta' : 'totalLikeDelta';
  const label = metric === 'pv_delta' ? 'PV' : 'スキ';

  if (filtered.length === 0) {
    container.innerHTML = '<div class="no-data">条件に一致する記事がありません</div>';
    document.getElementById('trendBadge').textContent = '0 articles';
    return;
  }

  document.getElementById('trendBadge').textContent = `${filtered.length} articles`;

  container.innerHTML = filtered.map((s, i) => {
    const shortTitle = s.title.replace(/^【.*?】/, '').replace(/\|.*$/, '').trim();
    const displayTitle = shortTitle;
    const total = s[totalKey];
    const cat = s.category || '?';
    const catColor = getCategoryColor(cat);
    const catInfo = cat !== '?' ? ` / カテゴリ: ${cat}（${getCategoryName(cat)}）` : '';
    return `
      <div class="trend-row" data-idx="${i}"
        onmouseenter="showTooltip(event, '${escHtml(s.title)}', '${label}増分合計: +${total} / 投稿: ${s.published_at ? s.published_at.substring(0,10) : "不明"}${catInfo}')"
        onmouseleave="hideTooltip()">
        <div class="trend-row-title"><span class="cat-badge" style="color:${catColor}">[${cat}]</span>${escHtml(displayTitle)}<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${s.published_at ? s.published_at.substring(0,10) : ''}</div></div>
        <canvas class="trend-row-spark" data-series-idx="${i}"></canvas>
        <div class="trend-row-value" style="color:${catColor}">+${total}</div>
      </div>`;
  }).join('');

  // Draw sparklines after DOM update
  requestAnimationFrame(() => {
    container.querySelectorAll('.trend-row-spark').forEach(canvas => {
      const idx = parseInt(canvas.dataset.seriesIdx);
      const s = filtered[idx];
      if (!s) return;
      const color = getCategoryColor(s.category || '?');
      const pubDate = s.published_at ? s.published_at.substring(0, 10) : null;
      drawSparkline(canvas, s.deltas, dates, metric, color, pubDate);
    });
  });
}

function renderTrendCharts() {
  trendDeltaCache = computeDailyDeltas();
  renderTrendRows();
}

// Note: trend tab listeners are now in renderDeepDive()

// Note: trend filter listeners are now in renderDeepDive()

// ===== 5. Decay Curve =====
function renderDecayChart() {
  const canvas = document.getElementById('decayCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);

  const MAX_DAY = 14;

  // Get all dates and earliest date
  const allDates = [...new Set(articlesData.map(a => a.date))].sort();
  if (allDates.length < 2) {
    document.getElementById('decayBadge').textContent = '0 articles';
    return;
  }
  const earliestDate = allDates[0];

  // Group by note_id
  const byId = {};
  articlesData.forEach(a => {
    if (!byId[a.note_id]) byId[a.note_id] = [];
    byId[a.note_id].push(a);
  });

  // Build decay data for eligible articles
  const decayArticles = [];
  Object.entries(byId).forEach(([noteId, rows]) => {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const pubAt = rows[0].published_at;
    if (!pubAt) return;
    const pubDay = pubAt.substring(0, 10);
    // Only include articles published after data collection started (Day0 data available)
    if (pubDay < earliestDate) return;

    const cat = rows[0].category || '?';
    const title = rows[0].title;

    // Compute daily PV deltas, assign Day number relative to publish date
    const dayData = [];
    const pubDate = new Date(pubDay + 'T00:00:00');
    for (let i = 0; i < rows.length; i++) {
      const snapDate = new Date(rows[i].date + 'T00:00:00');
      const day = Math.round((snapDate - pubDate) / (1000 * 60 * 60 * 24));
      if (day < 0 || day > MAX_DAY) continue;
      // Day 0: use read_count as initial PV, Day 1+: delta from previous snapshot
      const pvDelta = i === 0 ? rows[i].read_count : Math.max(0, rows[i].read_count - rows[i - 1].read_count);
      dayData.push({ day, pvDelta });
    }
    if (dayData.length > 0) {
      decayArticles.push({ noteId, title, category: cat, pubDay, dayData });
    }
  });

  document.getElementById('decayBadge').textContent = `${decayArticles.length} articles`;

  if (decayArticles.length === 0) {
    ctx.fillStyle = '#555570';
    ctx.font = '15px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('対象記事がありません', W / 2, H / 2);
    document.getElementById('decayLegend').innerHTML = '';
    return;
  }

  // Collect values per Day across all articles
  const dayBins = {};
  for (let day = 0; day <= MAX_DAY; day++) dayBins[day] = [];
  decayArticles.forEach(article => {
    article.dayData.forEach(pt => {
      if (pt.day >= 0 && pt.day <= MAX_DAY) {
        dayBins[pt.day].push({ pvDelta: pt.pvDelta, title: article.title, category: article.category });
      }
    });
  });

  // Stats helper
  const percentile = (arr, p) => {
    if (arr.length === 0) return 0;
    const idx = (arr.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
  };

  // Y-axis max: 95th percentile of all deltas
  const allDeltas = decayArticles.flatMap(a => a.dayData.map(d => d.pvDelta)).sort((a, b) => a - b);
  const yMax = Math.max(percentile(allDeltas, 0.95) || 10, 5);

  // Drawing setup
  const pad = { top: 24, right: 20, bottom: 44, left: 55 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;
  const colW = cw / (MAX_DAY + 1);
  const boxW = Math.min(colW * 0.5, 24);

  const xCenter = (day) => pad.left + colW * day + colW / 2;
  const yPos = (v) => pad.top + ch - Math.min(v / yMax, 1) * ch;

  // Grid lines
  const gridSteps = 5;
  for (let i = 0; i <= gridSteps; i++) {
    const y = pad.top + (ch / gridSteps) * i;
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    const val = Math.round(yMax / gridSteps * (gridSteps - i));
    ctx.fillStyle = '#555570';
    ctx.font = '11px JetBrains Mono';
    ctx.textAlign = 'right';
    ctx.fillText(val, pad.left - 8, y + 3);
  }

  // Y-axis label
  ctx.save();
  ctx.translate(14, pad.top + ch / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#555570';
  ctx.font = '11px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.fillText('日次PV増分', 0, 0);
  ctx.restore();

  // X-axis labels
  ctx.fillStyle = '#555570';
  ctx.font = '11px JetBrains Mono';
  ctx.textAlign = 'center';
  for (let day = 0; day <= MAX_DAY; day++) {
    ctx.fillText(`Day${day}`, xCenter(day), H - pad.bottom + 18);
  }

  // "Death Valley" zone: Day 3-5 columns
  const dvLeft = pad.left + colW * 3;
  const dvRight = pad.left + colW * 6;
  ctx.fillStyle = 'rgba(255, 179, 71, 0.08)';
  ctx.fillRect(dvLeft, pad.top, dvRight - dvLeft, ch);
  ctx.fillStyle = '#ffb34766';
  ctx.font = '11px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.fillText('死の谷', (dvLeft + dvRight) / 2, pad.top + 14);

  // Store plot points for tooltip hover
  const plotPoints = [];

  // Draw box plots per Day
  for (let day = 0; day <= MAX_DAY; day++) {
    const vals = dayBins[day].map(d => d.pvDelta).sort((a, b) => a - b);
    if (vals.length === 0) continue;

    const cx = xCenter(day);
    const q1 = percentile(vals, 0.25);
    const med = percentile(vals, 0.5);
    const q3 = percentile(vals, 0.75);
    const mn = vals[0];
    const mx = vals[vals.length - 1];

    const yQ1 = yPos(q1), yQ3 = yPos(q3), yMed = yPos(med);
    const yMin = yPos(mn), yMax_ = yPos(mx);
    const halfBox = boxW / 2;

    // Whisker (min to Q1, Q3 to max)
    ctx.strokeStyle = '#555570';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, yMin); ctx.lineTo(cx, yQ1);
    ctx.moveTo(cx, yQ3); ctx.lineTo(cx, yMax_);
    ctx.stroke();
    // Whisker caps
    ctx.beginPath();
    ctx.moveTo(cx - halfBox * 0.5, yMin); ctx.lineTo(cx + halfBox * 0.5, yMin);
    ctx.moveTo(cx - halfBox * 0.5, yMax_); ctx.lineTo(cx + halfBox * 0.5, yMax_);
    ctx.stroke();

    // Box (Q1 to Q3)
    ctx.fillStyle = 'rgba(0, 212, 255, 0.12)';
    ctx.fillRect(cx - halfBox, yQ3, boxW, yQ1 - yQ3);
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - halfBox, yQ3, boxW, yQ1 - yQ3);

    // Median line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - halfBox, yMed);
    ctx.lineTo(cx + halfBox, yMed);
    ctx.stroke();

    // Overlay individual dots (jittered horizontally)
    dayBins[day].forEach((d, j) => {
      const jitter = (j - (dayBins[day].length - 1) / 2) * 3;
      const dx = cx + Math.max(-halfBox + 2, Math.min(halfBox - 2, jitter));
      const dy = yPos(d.pvDelta);
      const color = getCategoryColor(d.category);
      ctx.beginPath();
      ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color + 'aa';
      ctx.fill();
      plotPoints.push({ x: dx, y: dy, title: d.title, day, pv: d.pvDelta, category: d.category, color });
    });
  }

  // Median connecting line (white dashed)
  const medianPoints = [];
  for (let day = 0; day <= MAX_DAY; day++) {
    const vals = dayBins[day].map(d => d.pvDelta).sort((a, b) => a - b);
    if (vals.length > 0) medianPoints.push({ day, med: percentile(vals, 0.5) });
  }
  if (medianPoints.length > 1) {
    ctx.beginPath();
    medianPoints.forEach((p, i) => {
      const x = xCenter(p.day), y = yPos(p.med);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Tooltip hover
  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let closest = null, minDist = 20;
    plotPoints.forEach(p => {
      const dist = Math.sqrt((mx - p.x) ** 2 + (my - p.y) ** 2);
      if (dist < minDist) { minDist = dist; closest = p; }
    });
    if (closest) {
      const cat = closest.category !== '?' ? `[${closest.category}] ` : '';
      showTooltip(e, `${cat}${closest.title}`, `Day ${closest.day} / 日次PV +${closest.pv}`);
    } else {
      hideTooltip();
    }
  };
  canvas.onmouseleave = () => hideTooltip();

  // Legend
  const legend = document.getElementById('decayLegend');
  const catEntries = Object.entries(CATEGORY_META)
    .filter(([cat]) => decayArticles.some(a => a.category === cat))
    .map(([cat, meta]) => `<span class="decay-legend-item"><span class="decay-legend-dot" style="background:${meta.color}"></span>${cat} ${meta.name}</span>`)
    .join('');
  legend.innerHTML = catEntries +
    '<span class="decay-legend-item"><span style="display:inline-block;width:20px;height:2px;background:rgba(255,255,255,0.9);vertical-align:middle;margin-right:4px;"></span>中央値</span>' +
    '<span class="decay-legend-item"><span style="display:inline-block;width:12px;height:10px;border:1px solid rgba(0,212,255,0.5);background:rgba(0,212,255,0.12);vertical-align:middle;margin-right:4px;"></span>Q1〜Q3</span>';
}

// ===== Deep Dive Rendering =====
function renderDeepDive() {
  const el = document.getElementById('deepDiveContent');

  // Compute comment/like ratio by category for girl-lines
  const commentRateBycat = {};
  let highestCommentCat = '';
  let highestCommentRate = 0;
  ['A','B','C','D','E'].forEach(c => {
    const arts = latestSnapshot.filter(a => a.category === c);
    if (arts.length === 0) return;
    const likes = arts.reduce((s, a) => s + a.like_count, 0);
    const comments = arts.reduce((s, a) => s + a.comment_count, 0);
    const ratio = likes > 0 ? (comments / 2) / likes * 100 : 0;
    commentRateBycat[c] = ratio;
    if (ratio > highestCommentRate) { highestCommentRate = ratio; highestCommentCat = c; }
  });
  const allCommentRatesLow = Object.values(commentRateBycat).every(r => r < 15);
  const aHigherThanB = (commentRateBycat['A'] || 0) > (commentRateBycat['B'] || 0);

  // Compute η trend report card scores for girl-lines
  const dates = [...new Set(articlesData.map(a => a.date))].sort();
  const ddLatestDate = dates[dates.length - 1] || '';
  const twoWeeksAgo = ddLatestDate ? formatDate(new Date(parseDate(ddLatestDate).getTime() - 13 * 86400000)) : '';
  const thirtyDaysAgo = ddLatestDate ? formatDate(new Date(parseDate(ddLatestDate).getTime() - 29 * 86400000)) : '';

  // 30-day category η averages
  const ddCatEtas = {};
  ['A','B','C','D','E'].forEach(c => {
    const arts = latestSnapshot.filter(a => {
      if (a.category !== c) return false;
      const pub = a.published_at ? a.published_at.slice(0, 10) : '';
      return pub >= thirtyDaysAgo && pub <= ddLatestDate;
    });
    if (arts.length === 0) return;
    const totalPV = arts.reduce((s, a) => s + a.read_count, 0);
    const totalLike = arts.reduce((s, a) => s + a.like_count, 0);
    ddCatEtas[c] = totalPV > 0 ? totalLike / totalPV * 100 : 0;
  });

  // Recent 2 weeks articles with η
  const recentArts = latestSnapshot
    .filter(a => a.published_at && a.published_at.slice(0, 10) >= twoWeeksAgo && a.published_at.slice(0, 10) <= ddLatestDate && a.read_count > 0)
    .map(a => ({ ...a, eta: a.like_count / a.read_count * 100 }));

  // Scores per category
  const ddScores = {};
  let allAbove50 = true;
  let belowCount = 0;
  let lowestCat = '';
  let lowestScore = 100;
  ['A','B','C','D','E'].forEach(c => {
    const arts = recentArts.filter(a => a.category === c);
    if (arts.length === 0 || !ddCatEtas[c]) return;
    const avgDiff = arts.reduce((s, a) => s + (a.eta - ddCatEtas[c]), 0) / arts.length;
    const score = Math.max(0, Math.min(100, Math.round(50 + avgDiff * 10)));
    ddScores[c] = score;
    if (score < 50) { allAbove50 = false; belowCount++; }
    if (score < lowestScore) { lowestScore = score; lowestCat = c; }
  });
  const scoredCount = Object.keys(ddScores).length;
  const halfBelow = belowCount >= scoredCount / 2;
  const onlyOneLow = belowCount === 1 && lowestScore < 30;

  // TOP ranking check (last 30 days)
  const recent30forRank = latestSnapshot.filter(a => {
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    return pub >= thirtyDaysAgo && pub <= ddLatestDate;
  });
  const allSorted = [...recent30forRank]
    .filter(a => a.read_count > 0)
    .map(a => ({ ...a, eta: a.like_count / a.read_count * 100 }))
    .sort((a, b) => b.eta - a.eta);
  const top1key = allSorted.length > 0 ? allSorted[0].key : '';
  const top10keys = new Set(allSorted.slice(0, 10).map(a => a.key));
  const top20keys = new Set(allSorted.slice(0, 20).map(a => a.key));
  const recentInTop1 = recentArts.some(a => a.key === top1key);
  const recentInTop10 = recentArts.filter(a => top10keys.has(a.key)).length;
  const recentInTop20 = recentArts.filter(a => top20keys.has(a.key)).length;
  const top1eta = allSorted.length > 0 ? allSorted[0].eta : 0;

  const savedData = _dailyRenderData;
  _dailyRenderData = {
    highestCommentCat, highestCommentRate, allCommentRatesLow, aHigherThanB,
    allAbove50, halfBelow, onlyOneLow, lowestCat, lowestScore,
    recentInTop1, recentInTop10, recentInTop20, top1eta,
    recentArtCount: recentArts.length,
    lowestCatName: lowestCat ? getCategoryName(lowestCat) : '',
    recentPVAbove: false,
    recentLikeAbove: false,
    resurrectedCount: 0,
    rankNewCount: 0,
    rankReturnCount: 0,
    rankRegularCount: 0,
  };

  // Sparkline: recent article initial performance vs category average
  if (recentArts.length > 0) {
    const ddCatAvgs = getCategoryAvgs();
    let pvAboveCount = 0, likeAboveCount = 0;
    recentArts.forEach(a => {
      const ca = ddCatAvgs[a.category] || { avgPV: 0, avgLike: 0 };
      if (a.read_count >= ca.avgPV) pvAboveCount++;
      if (a.like_count >= ca.avgLike) likeAboveCount++;
    });
    _dailyRenderData.recentPVAbove = pvAboveCount >= recentArts.length / 2;
    _dailyRenderData.recentLikeAbove = likeAboveCount >= recentArts.length / 2;
  }

  // Resurrected: articles with PV increase on Day6+ within last 30 days
  if (dates.length >= 2) {
    const sixDaysAgo = formatDate(new Date(parseDate(ddLatestDate).getTime() - 6 * 86400000));
    const monthAgoDate = formatDate(new Date(parseDate(ddLatestDate).getTime() - 29 * 86400000));
    const resurrected = new Set();
    for (let di = 1; di < dates.length; di++) {
      const d = dates[di];
      if (d < monthAgoDate) continue;
      const prevD = dates[di - 1];
      const currArts = {};
      articlesData.filter(a => a.date === d).forEach(a => { currArts[a.key] = a; });
      const prevArts = {};
      articlesData.filter(a => a.date === prevD).forEach(a => { prevArts[a.key] = a; });
      Object.entries(currArts).forEach(([key, a]) => {
        const pub = a.published_at ? a.published_at.slice(0, 10) : '';
        if (!pub) return;
        const ageDays = Math.round((parseDate(d) - parseDate(pub)) / 86400000);
        if (ageDays < 6) return;
        const prevPV = prevArts[key] ? prevArts[key].read_count : 0;
        if (a.read_count - prevPV >= 5) resurrected.add(key);
      });
    }
    _dailyRenderData.resurrectedCount = resurrected.size;
  }


  let html = '';

  // 1. スキ率ランキング (月子=0)
  html += `<div>`;
  html += weeklyNavi(0, 'deepEtaRanking');
  html += `<div class="weekly-section">
    <div class="weekly-section-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <span>スキ率ランキング</span>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div class="toggle-group" id="rankingCatToggle">
          <div class="toggle-btn active" data-cat="all">全体</div>
          <div class="toggle-btn" data-cat="A">A</div>
          <div class="toggle-btn" data-cat="B">B</div>
          <div class="toggle-btn" data-cat="C">C</div>
          <div class="toggle-btn" data-cat="D">D</div>
          <div class="toggle-btn" data-cat="E">E</div>
        </div>
        <div class="toggle-group" id="rankingToggle">
          <div class="toggle-btn" data-top="5">5</div>
          <div class="toggle-btn" data-top="10">10</div>
          <div class="toggle-btn active" data-top="20">20</div>
        </div>
      </div>
    </div>
    <div class="bar-chart" id="rankingChart"><div class="no-data">読み込み中...</div></div>
    <div class="decay-legend" id="rankingLegend"></div>
  </div></div>`;

  // 2. カテゴリ別コメ/スキ率 (日和=6)
  html += `<div>`;
  html += weeklyNavi(6, 'deepCommentRate');
  html += `<div class="weekly-section">
    <div class="weekly-section-title">カテゴリ別 コメント/スキ率</div>
    <div class="dd-canvas-wrap"><canvas id="commentLikeRatioCanvas"></canvas></div>
  </div></div>`;

  // 3. 直近2週間スキ率推移 (月子=0) — full width
  html += `<div class="dd-full">`;
  html += weeklyNavi(0, 'deepEtaTrend');
  html += `<div class="weekly-section">
    <div class="weekly-section-title">直近2週間 スキ率推移 <span class="panel-badge" id="etaTrendBadge">--</span></div>
    <div class="dd-canvas-wrap"><canvas id="etaTrendCanvas"></canvas></div>
    <div class="decay-legend" id="etaTrendLegend"></div>
    <div id="etaTrendReport"></div>
  </div></div>`;

  // 4. 記事別日次推移 (しずく=2) — full width
  html += `<div class="dd-full">`;
  html += weeklyNavi(2, 'deepSparkline');
  html += `<div class="weekly-section">
    <div class="weekly-section-title">記事別 日次推移 <span class="panel-badge" id="trendBadge">--</span></div>
    <div class="trend-tabs">
      <div class="trend-tab active" data-metric="pv_delta">PV</div>
      <div class="trend-tab" data-metric="like_delta">スキ</div>
    </div>
    <div class="trend-filters">
      <label>投稿日: 直近
        <select id="trendDayFilter">
          <option value="7" selected>7日</option>
          <option value="14">14日</option>
          <option value="30">30日</option>
          <option value="0">すべて</option>
        </select>
      </label>
      <label>増分 ≥ <input id="trendMinDelta" type="number" value="0" min="0" style="width:60px"></label>
      <label>カテゴリ:
        <select id="trendCatFilter">
          <option value="">すべて</option>
          <option value="A">A 設計思想</option>
          <option value="B">B 試行錯誤</option>
          <option value="C">C ハウツー</option>
          <option value="D">D 振り返り</option>
          <option value="E">E キャラ系</option>
        </select>
      </label>
    </div>
    <div class="trend-rows" id="trendRows"><div class="no-data">読み込み中...</div></div>
  </div></div>`;

  // 4b. ロングテール記事 (しずく=2) — full width
  html += `<div class="dd-full">`;
  html += `<div class="weekly-section">
    <div class="weekly-section-title">ロングテール記事（Day6超でPV増あり）</div>
    <div id="longTailList"></div>
  </div></div>`;

  // 5. 減衰カーブ (凛華=3) — full width
  html += `<div class="dd-full">`;
  html += weeklyNavi(3, 'deepDecay');
  html += `<div class="weekly-section">
    <div class="weekly-section-title">記事の消費期限：公開からのPV減衰 <span class="panel-badge" id="decayBadge">--</span></div>
    <div class="dd-canvas-wrap"><canvas id="decayCanvas"></canvas></div>
    <div class="decay-legend" id="decayLegend"></div>
  </div></div>`;

  el.innerHTML = html;

  // Re-attach event listeners for toggle buttons (since DOM was replaced)
  document.querySelectorAll('#rankingCatToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rankingCatToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rankingCatFilter = btn.dataset.cat;
      renderRanking();
    });
  });
  document.querySelectorAll('#rankingToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rankingToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rankingTopN = parseInt(btn.dataset.top);
      renderRanking();
    });
  });
  // Trend tab/filter listeners
  document.querySelectorAll('.trend-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.trend-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      trendActiveMetric = tab.dataset.metric;
      renderTrendRows();
    });
  });
  ['trendDayFilter', 'trendMinDelta', 'trendCatFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { renderTrendRows(); });
  });

  _dailyRenderData = savedData;

  // Render all charts (delay to ensure layout is complete)
  setTimeout(() => {
    renderRanking();
    renderEtaTrend();
    renderTrendCharts();
    renderDecayChart();
    renderCommentByChar();
    renderLongTailList();
  }, 200);
}

// ===== 6. Suki Ranking (people, period selectable) =====
let sukiPeriod = 'week';

// Get the "ranking date" for a liked_at timestamp (5:00 JST boundary)
function getRankingDate(likedAt) {
  if (!likedAt) return '';
  const d = new Date(likedAt);
  // Convert to JST hours
  const jstHours = (d.getUTCHours() + 9) % 24;
  const dateStr = likedAt.slice(0, 10);
  if (jstHours < 5) {
    // Before 5:00 JST → count as previous day
    const prev = new Date(parseDate(dateStr));
    prev.setDate(prev.getDate() - 1);
    return formatDate(prev);
  }
  return dateStr;
}

function getSukiPeriodRange(period) {
  const src = summaryData.length > 0 ? summaryData : dailySummary;
  const dataDate = src.length > 0 ? src[src.length - 1].date : getTodayJST();

  if (period === 'week') {
    const mon = getMondayOf(dataDate);
    const sun = new Date(parseDate(mon)); sun.setDate(sun.getDate() + 6);
    return { start: mon, end: formatDate(sun) };
  }
  if (period === 'lastweek') {
    const mon = parseDate(getMondayOf(dataDate));
    mon.setDate(mon.getDate() - 7);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return { start: formatDate(mon), end: formatDate(sun) };
  }
  if (period === 'month') {
    const start = dataDate.slice(0, 7) + '-01';
    return { start, end: dataDate };
  }
  if (period === 'lastmonth') {
    const d = parseDate(dataDate);
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const start = formatDate(d).slice(0, 7) + '-01';
    const endD = parseDate(dataDate.slice(0, 7) + '-01');
    endD.setDate(endD.getDate() - 1);
    return { start, end: formatDate(endD) };
  }
  return { start: '', end: dataDate };
}

function updateFansRenderData() {
  _dailyRenderData.rankNewCount = 0;
  _dailyRenderData.rankReturnCount = 0;
  _dailyRenderData.rankRegularCount = 0;
  _dailyRenderData.rankUserCategory = {};
  if (likesData.length === 0) return;

  const range = getSukiPeriodRange(sukiPeriod);
  const periodLikes = likesData.filter(l => {
    const d = getRankingDate(l.liked_at);
    return d >= range.start && d <= range.end;
  });

  // Build per-user suki count in this period for ranking
  const userCounts = {};
  periodLikes.forEach(l => {
    const uid = l.like_user_id;
    if (!userCounts[uid]) {
      userCounts[uid] = { uid, count: 0 };
    }
    userCounts[uid].count++;
  });
  const top20 = Object.values(userCounts).sort((a, b) => b.count - a.count).slice(0, 20);

  // Classify each top20 user using shared functions
  const userWeeks = buildUserWeeks();
  let newCount = 0, returnCount = 0, regularCount = 0;
  top20.forEach(u => {
    const cat = classifyUser(u.uid, range.start, userWeeks);
    _dailyRenderData.rankUserCategory[u.uid] = cat;
    if (cat === 'new') newCount++;
    else if (cat === 'regular') regularCount++;
    else if (cat === 'return') returnCount++;
  });

  _dailyRenderData.rankNewCount = newCount;
  _dailyRenderData.rankReturnCount = returnCount;
  _dailyRenderData.rankRegularCount = regularCount;

  // Update navi line
  const naviLine = document.querySelector('#navi-fans .weekly-navi-line');
  if (naviLine) {
    naviLine.textContent = getGirlLineForIdx('fans', 4);
  }
}

// Suki timing multiplier based on hours since article publication
function getSukiMultiplier(likedAt, noteKey) {
  // Find published_at for this article
  const art = latestSnapshot.find(a => a.key === noteKey);
  if (!art || !art.published_at || !likedAt) return 1;
  const pubTime = new Date(art.published_at);
  const likeTime = new Date(likedAt);
  const diffHours = (likeTime - pubTime) / (1000 * 60 * 60);
  if (diffHours < 0) return 1;
  if (diffHours <= 1) return 3;
  if (diffHours <= 6) return 2;
  if (diffHours <= 24) return 1.5;
  return 1;
}

function renderSukiRanking() {
  const el = document.getElementById('sukiRankingContent');
  if (likesData.length === 0) { el.innerHTML = '<div class="no-data">likes.csv データなし</div>'; return; }

  updateFansRenderData();

  const range = getSukiPeriodRange(sukiPeriod);
  const periodLikes = likesData.filter(l => {
    const d = getRankingDate(l.liked_at);
    return d >= range.start && d <= range.end;
  });

  const totalByUser = {};
  likesData.forEach(l => {
    const uid = l.like_user_id;
    totalByUser[uid] = (totalByUser[uid] || 0) + 1;
  });

  // Count by user in period (with timing multiplier)
  const userMap = {};
  periodLikes.forEach(l => {
    const uid = l.like_user_id;
    if (!userMap[uid]) {
      userMap[uid] = {
        uid,
        name: l.like_username || l.like_user_urlname || uid,
        urlname: l.like_user_urlname || '',
        count: 0,
        score: 0,
        totalCount: totalByUser[uid] || 0,
        followerCount: parseInt(l.follower_count) || 0,
      };
    }
    userMap[uid].count++;
    userMap[uid].score += getSukiMultiplier(l.liked_at, l.note_key);
  });

  const ranked = Object.values(userMap).sort((a, b) => b.score - a.score).slice(0, 20);

  if (ranked.length === 0) {
    el.innerHTML = `<div class="no-data">この期間のスキデータなし（${range.start}〜${range.end}）</div>`;
    return;
  }

  function sukiCard(u, i) {
    const profileUrl = u.urlname ? `https://note.com/${u.urlname}` : '#';
    const cat = (_dailyRenderData.rankUserCategory || {})[u.uid] || '';
    const avatarClass = 'weekly-person-avatar' + (cat === 'regular' ? ' avatar-regular' : '');
    const rank = i === 0 ? 1 : (Math.round(u.score * 2) === Math.round(ranked[i - 1].score * 2) ? ranked[i - 1]._rank : i + 1);
    u._rank = rank;
    return `<div class="weekly-person">
      <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--accent-pink);min-width:28px;text-align:center">${rank}</div>
      <img class="${avatarClass}" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23333' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="">
      <div class="weekly-person-name">
        <a href="${profileUrl}" target="_blank" rel="noopener">${u.name}</a>
      </div>
      <div class="weekly-person-stats" style="flex-shrink:0">
        <div>${u.count}スキ</div>
        <div>${u.followerCount.toLocaleString()}</div>
        <div>followers</div>
      </div>
      <div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--accent-pink);white-space:nowrap;text-align:right;margin-left:4px">${Math.round(u.score * 2)}<span style="font-size:10px;font-weight:400">pt</span></div>
    </div>`;
  }

  const half = Math.ceil(ranked.length / 2);
  const left = ranked.slice(0, half);
  const right = ranked.slice(half);

  el.innerHTML = `
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">${getDayLabel(range.start)}〜${getDayLabel(range.end)}</div>
    <div class="suki-ranking-grid">
      <div>${left.map((u, i) => sukiCard(u, i)).join('')}</div>
      <div>${right.map((u, i) => sukiCard(u, i + half)).join('')}</div>
    </div>`;

  loadWeeklyAvatars();
}

// Note: suki period toggle listeners are now in renderDeepDive()

function openSukiScreenshot() {
  const range = getSukiPeriodRange(sukiPeriod);
  const periodLikes = likesData.filter(l => {
    const d = getRankingDate(l.liked_at);
    return d >= range.start && d <= range.end;
  });

  const totalByUser = {};
  likesData.forEach(l => { totalByUser[l.like_user_id] = (totalByUser[l.like_user_id] || 0) + 1; });

  const userMap = {};
  periodLikes.forEach(l => {
    const uid = l.like_user_id;
    if (!userMap[uid]) {
      userMap[uid] = { uid, name: l.like_username || l.like_user_urlname || uid, urlname: l.like_user_urlname || '', count: 0, score: 0, totalCount: totalByUser[uid] || 0, followerCount: parseInt(l.follower_count) || 0 };
    }
    userMap[uid].count++;
    userMap[uid].score += getSukiMultiplier(l.liked_at, l.note_key);
  });

  const ranked = Object.values(userMap).sort((a, b) => b.score - a.score).slice(0, 10);

  // Check if #1 was also #1 in previous period
  const prevPeriodKey = sukiPeriod === 'week' ? 'lastweek' : sukiPeriod === 'month' ? 'lastmonth' : null;
  let prevTop1Uid = null;
  if (prevPeriodKey) {
    const prevRange = getSukiPeriodRange(prevPeriodKey);
    const prevPeriodLikes = likesData.filter(l => {
      const d = getRankingDate(l.liked_at);
      return d >= prevRange.start && d <= prevRange.end;
    });
    const prevScores = {};
    prevPeriodLikes.forEach(l => {
      const uid = l.like_user_id;
      if (!prevScores[uid]) prevScores[uid] = 0;
      prevScores[uid] += getSukiMultiplier(l.liked_at, l.note_key);
    });
    const prevRanked = Object.entries(prevScores).sort((a, b) => b[1] - a[1]);
    if (prevRanked.length > 0) prevTop1Uid = prevRanked[0][0];
  }

  // Runa's line for screenshot
  let runaLine = '';
  if (ranked.length > 0) {
    const top1 = ranked[0];
    const top1Score = Math.round(top1.score * 2);
    const tiedCount = ranked.filter(u => Math.round(u.score * 2) === top1Score).length;
    if (tiedCount >= 2) {
      runaLine = `今週は${tiedCount}人が同率1位！みんなありがとー！`;
    } else if (prevTop1Uid && top1.uid === prevTop1Uid) {
      runaLine = `${top1.name}さん、2週連続1位！もう殿堂入りだね！ありがとー！`;
    } else {
      const cat = (_dailyRenderData.rankUserCategory || {})[top1.uid] || '';
      if (cat === 'new') {
        runaLine = `${top1.name}さん、初めての1位だよ！嬉しいね！これからもよろしくね！`;
      } else {
        runaLine = top1.count >= 2
          ? `${top1.name}さんが${top1.count}回もスキしてくれたよ！いつもありがとね！`
          : `${top1.name}さんがスキしてくれたよ！いつもありがとね！`;
      }
    }
  }

  const periodLabels = { week: '今週', lastweek: '先週', month: '今月', lastmonth: '先月' };
  const FAN_THANKS = [
    'いつもありがとう。一番の読者だよ。',
    'あなたのスキが、書く力になってます。',
    '毎回読んでくれて、ほんとに嬉しい。',
    '常連さん...照れる。',
    'スキの通知、いつも見てるよ。',
    'あなたがいるから、書き続けられる。',
    'ありがとう。これからもよろしくね。',
    '応援してくれて、感謝してます。',
    'いつも反応してくれて嬉しい。',
    'あなたの存在が、励みになってます。',
  ];

  const left = ranked.slice(0, 5);
  const right = ranked.slice(5, 10);

  function cardHTML(u, i) {
    const rank = i === 0 ? 1 : (Math.round(u.score * 2) === Math.round(ranked[i - 1].score * 2) ? ranked[i - 1]._rank : i + 1);
    u._rank = rank;
    const cat = (_dailyRenderData.rankUserCategory || {})[u.uid] || '';
    const avatarStyle = rank === 1
      ? 'border:3px solid #d4af37;box-shadow:0 2px 8px rgba(0,0,0,0.15);'
      : 'border:2px solid #6c5ce7;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
    const badge = cat === 'regular' ? '<span style="font-size:9px;background:#d4af37;color:#fff;padding:1px 5px;border-radius:8px;margin-left:4px;font-weight:400">常連</span>'
      : cat === 'new' ? '<span style="font-size:9px;background:#6c5ce7;color:#fff;padding:1px 5px;border-radius:8px;margin-left:4px;font-weight:400">New</span>'
      : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border-radius:12px;border:1px solid rgba(108,92,231,0.12);margin-bottom:6px;${i === 0 ? 'box-shadow:0 4px 16px rgba(108,92,231,0.1);' : ''}">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;color:${rank <= 1 ? '#d4af37' : rank <= 2 ? '#c0c0c0' : rank <= 3 ? '#cd7f32' : '#ccc'};min-width:28px;text-align:center">${rank}</div>
      <img class="weekly-person-avatar" data-urlname="${u.urlname}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect fill='%23eee' width='36' height='36' rx='18'/%3E%3C/svg%3E" alt="" style="border-radius:50%;${avatarStyle}">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:#333">${u.name}さん${badge}</div>
        <div style="font-size:10px;color:#fd79a8;margin-top:1px;font-style:italic">${FAN_THANKS[i] || ''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;min-width:50px">
        <div style="font-size:9px;color:#999">${u.count}スキ</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:#fd79a8">${Math.round(u.score * 2)}<span style="font-size:9px;color:#999">pt</span></div>
      </div>
    </div>`;
  }

  const html = `
    <div style="background:#fffbf2;color:#0a0a14;border-radius:20px;padding:28px 24px;font-family:'Noto Sans JP',sans-serif;max-width:860px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:22px;font-weight:900;color:#333"><span style="font-size:1.5em;font-weight:900;color:#6c5ce7">い</span>つもスキしてくれる人</div>
        <div style="font-size:12px;color:#999;margin-top:4px">${periodLabels[sukiPeriod] || ''} ${getDayLabel(range.start)}〜${getDayLabel(range.end)}</div>
      </div>
      ${runaLine ? `<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:20px;padding:0 4px">
        <img src="images/eyes-thumb/eyes-fri.webp" alt="るな" style="width:40px;height:40px;border-radius:50%;flex-shrink:0;border:2px solid #6c5ce7;box-shadow:0 2px 6px rgba(0,0,0,0.1)">
        <div style="position:relative;background:#fff;border:1px solid rgba(108,92,231,0.15);border-radius:12px;padding:10px 14px;font-size:13px;color:#333;box-shadow:0 2px 6px rgba(0,0,0,0.06);margin-top:6px">
          <div style="position:absolute;left:-7px;top:10px;width:12px;height:12px;background:#fff;border-left:1px solid rgba(108,92,231,0.15);border-bottom:1px solid rgba(108,92,231,0.15);transform:rotate(45deg)"></div>
          <div style="font-size:10px;color:#6c5ce7;font-weight:600;margin-bottom:2px">るな</div>
          ${runaLine}
        </div>
      </div>` : ''}
      <div class="screenshot-grid">
        <div>${left.map((u, i) => cardHTML(u, i)).join('')}</div>
        <div>${right.map((u, i) => cardHTML(u, i + 5)).join('')}</div>
      </div>
      <div style="text-align:center;margin-top:16px;font-size:10px;color:#ccc;letter-spacing:2px">ohayou kanojo / hasyamo</div>
    </div>`;

  document.getElementById('sukiScreenshotContent').innerHTML = html;
  document.getElementById('sukiScreenshotModal').style.display = '';
  loadWeeklyAvatars();
}

function closeSukiScreenshot() {
  document.getElementById('sukiScreenshotModal').style.display = 'none';
}

// ===== Ranking Tab =====
function renderRankingTab() {
  const el = document.getElementById('rankingContent');
  if (!el) return;

  updateFansRenderData();

  let html = '';
  html += weeklyNavi(4, 'fans');
  html += `<div class="weekly-section">
    <div class="weekly-section-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <span>スキランキング</span>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="commentary-copy" onclick="openSukiScreenshot()" style="font-size:11px;padding:3px 10px">スクショ用</button>
      <div class="toggle-group" id="sukiPeriodToggle">
        <div class="toggle-btn active" data-period="week">今週</div>
        <div class="toggle-btn" data-period="lastweek">先週</div>
        <div class="toggle-btn" data-period="month">今月</div>
        <div class="toggle-btn" data-period="lastmonth">先月</div>
      </div></div>
    </div>
    <div id="sukiRankingContent"><div class="no-data">読み込み中...</div></div>
  </div>`;

  el.innerHTML = html;

  // Attach period toggle listeners
  document.querySelectorAll('#sukiPeriodToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sukiPeriodToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sukiPeriod = btn.dataset.period;
      renderSukiRanking();
    });
  });

  setTimeout(() => { renderSukiRanking(); }, 200);
}

// ===== 7. Comment count by character (day of week) =====
function renderCommentByChar() {
  const canvas = document.getElementById('commentLikeRatioCanvas');
  if (!canvas || latestSnapshot.length === 0) return;

  // Compute comment/like ratio by category (comments halved for self-replies)
  const CAT_ORDER = ['A', 'B', 'C', 'D', 'E'];
  const catData = [];
  CAT_ORDER.forEach(c => {
    const arts = latestSnapshot.filter(a => a.category === c);
    if (arts.length === 0) return;
    const likes = arts.reduce((s, a) => s + a.like_count, 0);
    const comments = arts.reduce((s, a) => s + a.comment_count, 0);
    const ratio = likes > 0 ? (comments / 2) / likes * 100 : 0;
    catData.push({ cat: c, name: getCategoryName(c), color: getCategoryColor(c), ratio, articles: arts.length, likes, comments: Math.round(comments / 2) });
  });

  const ctx = canvas.getContext('2d');
  const W = canvas.parentElement.clientWidth;
  const H = 300;
  canvas.width = W * 2; canvas.height = H * 2;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.scale(2, 2);

  const pad = { t: 20, b: 50, l: 50, r: 20 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;
  const maxRatio = Math.max(...catData.map(d => d.ratio), 1);

  // Grid
  ctx.strokeStyle = '#2a2a3a'; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#666'; ctx.font = '10px JetBrains Mono'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxRatio * (1 - i / 4)) + '%', pad.l - 6, y + 4);
  }

  // Bars
  const barW = Math.min(60, cw / catData.length * 0.6);
  const gap = (cw - barW * catData.length) / (catData.length + 1);

  catData.forEach((d, i) => {
    const x = pad.l + gap + i * (barW + gap);
    const barH = (d.ratio / maxRatio) * ch;
    const y = pad.t + ch - barH;

    // Bar
    ctx.fillStyle = d.color;
    ctx.fillRect(x, y, barW, barH);

    // Value on top
    ctx.fillStyle = d.color;
    ctx.font = 'bold 12px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText(d.ratio.toFixed(1) + '%', x + barW / 2, y - 8);

    // Category label
    ctx.fillStyle = '#999';
    ctx.font = '11px JetBrains Mono';
    ctx.fillText(d.cat, x + barW / 2, H - pad.b + 14);
    ctx.font = '10px Noto Sans JP';
    ctx.fillText(d.name, x + barW / 2, H - pad.b + 28);

    // Article count
    ctx.fillStyle = '#555';
    ctx.font = '9px JetBrains Mono';
    ctx.fillText(d.articles + '本', x + barW / 2, H - pad.b + 42);
  });
}

// ===== Long Tail List =====
function renderLongTailList() {
  const listEl = document.getElementById('longTailList');
  if (!listEl || articlesData.length === 0) return;

  const dates = [...new Set(articlesData.map(a => a.date))].sort();
  const latestDate = dates[dates.length - 1];

  if (dates.length < 2) return;

  const prevDate = dates[dates.length - 2];
  const prevSnap = {};
  articlesData.filter(a => a.date === prevDate).forEach(a => { prevSnap[a.key] = a.read_count; });
  const sixDaysAgo = formatDate(new Date(parseDate(latestDate).getTime() - 6 * 86400000));

  const ltArticles = [];
  latestSnapshot.forEach(a => {
    const pub = a.published_at ? a.published_at.slice(0, 10) : '';
    if (!pub || pub > sixDaysAgo) return;
    const prevPV = prevSnap[a.key] || 0;
    const diff = a.read_count - prevPV;
    if (diff > 0) {
      const ageDays = Math.round((parseDate(latestDate) - parseDate(pub)) / 86400000);
      ltArticles.push({ title: a.title, key: a.key, pub, diff, pv: a.read_count, ageDays, category: a.category });
    }
  });
  ltArticles.sort((a, b) => b.diff - a.diff);

  if (ltArticles.length > 0) {
    listEl.innerHTML = ltArticles.map(a => {
      const catColor = getCategoryColor(a.category);
      return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:12px">
        <span style="color:var(--accent-green);font-family:var(--font-mono);font-weight:600;min-width:40px">+${a.diff}/日</span>
        <span class="cat-badge" style="color:${catColor}">${a.category}</span>
        <a href="${noteURL(a.key)}" target="_blank" rel="noopener" style="color:var(--text-primary);text-decoration:none;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.title}</a>
        <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;white-space:nowrap">Day${a.ageDays}</span>
      </div>`;
    }).join('');
  } else {
    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Day6超でPV増のある記事なし</div>';
  }
}

// ===== Tooltip =====
function showTooltip(e, title, body) {
  const tt = document.getElementById('tooltip');
  document.getElementById('tooltipTitle').textContent = title;
  document.getElementById('tooltipBody').textContent = body;
  tt.style.display = 'block';
  const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const mx = e.clientX / zoom;
  const my = e.clientY / zoom;
  const ttWidth = tt.offsetWidth;
  const spaceRight = window.innerWidth / zoom - mx;
  if (spaceRight < ttWidth + 24) {
    tt.style.left = (mx - ttWidth - 14) + 'px';
  } else {
    tt.style.left = (mx + 14) + 'px';
  }
  tt.style.top = (my - 10) + 'px';
}

function hideTooltip() {
  document.getElementById('tooltip').style.display = 'none';
}

function escHtml(s) {
  return s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ===== Load from repo (GitHub Pages) =====
async function loadFromRepo() {
  const cacheBust = '?t=' + Date.now();
  try {
    // Load articles.csv
    const res = await fetch('./data/articles.csv' + cacheBust);
    if (res.ok) {
      const text = await res.text();
      const rows = parseCSV(text);
      if (rows.length > 0) {
        // Load article_categories.csv
        try {
          const catRes = await fetch('./data/article_categories.csv' + cacheBust);
          if (catRes.ok) {
            const catText = await catRes.text();
            const catRows = parseCSV(catText);
            categoryMap = {};
            categoryTitleMap = {};
            catRows.forEach(r => {
              categoryMap[r.key] = r.category;
              categoryTitleMap[r.key] = { category: r.category, title: r.title, published_date: r.published_date || '' };
            });
          }
        } catch (e) {}

        // Load daily_summary.csv
        try {
          const sumRes = await fetch('./data/daily_summary.csv' + cacheBust);
          if (sumRes.ok) {
            const sumText = await sumRes.text();
            const sumRows = parseCSV(sumText);
            summaryData = sumRows.map(r => ({
              date: r.date,
              articleCount: parseInt(r.article_count) || 0,
              totalPV: parseInt(r.total_pv) || 0,
              totalLikes: parseInt(r.total_like) || 0,
              totalComments: parseInt(r.total_comment) || 0,
              followerCount: parseInt(r.follower_count) || 0,
            })).sort((a, b) => a.date.localeCompare(b.date));
          }
        } catch (e) {}

        // Load likes.csv
        try {
          const likesRes = await fetch('./data/likes.csv' + cacheBust);
          if (likesRes.ok) {
            const likesText = await likesRes.text();
            likesData = parseCSV(likesText);
          }
        } catch (e) {}

        // Load my_likes.csv
        try {
          const mlRes = await fetch('./data/my_likes.csv' + cacheBust);
          if (mlRes.ok) {
            const mlText = await mlRes.text();
            myLikesData = parseCSV(mlText);
          }
        } catch (e) {}

        processData(rows);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

// ===== Init =====
window.addEventListener('resize', () => {
  if (latestSnapshot.length > 0) {
    const ddTab = document.getElementById('tabDeepdive');
    if (ddTab && ddTab.classList.contains('active')) {
      renderEtaTrend();
      renderTrendCharts();
      renderDecayChart();
    }
  }
});

// Try to load from repo on init
loadFromRepo().then(() => {
  // Restore tab from URL hash
  const hash = location.hash.replace('#', '');
  if (hash && document.querySelector(`.tab-bar-btn[data-tab="${hash}"]`)) {
    switchTab(hash);
  }
});
