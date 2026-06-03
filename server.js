const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ────────────────────────────────────────────────
const NEWSDATA_KEY = process.env.NEWSDATA_API_KEY || '';
const MEDIASTACK_KEY = process.env.MEDIASTACK_API_KEY || '';

// ── Location lookup ───────────────────────────────────────
const LOCATIONS = {
  'south china sea': { lat:12.0, lng:114.0 },
  'taiwan strait': { lat:24.0, lng:119.5 },
  'taiwan': { lat:23.5, lng:121.0 },
  'philippines': { lat:12.5, lng:122.0 },
  'manila': { lat:14.6, lng:121.0 },
  'vietnam': { lat:14.0, lng:108.0 },
  'hanoi': { lat:21.0, lng:105.8 },
  'ho chi minh': { lat:10.8, lng:106.7 },
  'indonesia': { lat:-5.0, lng:120.0 },
  'jakarta': { lat:-6.2, lng:106.8 },
  'malaysia': { lat:4.2, lng:108.0 },
  'kuala lumpur': { lat:3.1, lng:101.7 },
  'singapore': { lat:1.35, lng:103.8 },
  'thailand': { lat:13.0, lng:101.0 },
  'bangkok': { lat:13.75, lng:100.5 },
  'myanmar': { lat:19.0, lng:96.5 },
  'yangon': { lat:16.8, lng:96.2 },
  'china': { lat:35.0, lng:105.0 },
  'beijing': { lat:39.9, lng:116.4 },
  'shanghai': { lat:31.2, lng:121.5 },
  'hong kong': { lat:22.3, lng:114.2 },
  'japan': { lat:36.0, lng:138.0 },
  'tokyo': { lat:35.7, lng:139.7 },
  'osaka': { lat:34.7, lng:135.5 },
  'south korea': { lat:36.5, lng:127.5 },
  'korea': { lat:36.5, lng:127.5 },
  'seoul': { lat:37.6, lng:126.9 },
  'north korea': { lat:40.0, lng:127.0 },
  'pyongyang': { lat:39.0, lng:125.7 },
  'india': { lat:20.0, lng:77.0 },
  'new delhi': { lat:28.6, lng:77.2 },
  'mumbai': { lat:19.1, lng:72.9 },
  'pakistan': { lat:30.4, lng:69.3 },
  'bangladesh': { lat:23.7, lng:90.4 },
  'cambodia': { lat:12.5, lng:104.9 },
  'laos': { lat:18.0, lng:103.0 },
  'sri lanka': { lat:7.9, lng:80.7 },
  'australia': { lat:-25.0, lng:133.0 },
  'sydney': { lat:-33.9, lng:151.2 },
  'papua new guinea': { lat:-6.0, lng:147.0 },
  'spratly': { lat:10.0, lng:114.0 },
  'paracel': { lat:16.5, lng:112.0 },
  'xinjiang': { lat:42.0, lng:87.0 },
  'tibet': { lat:32.0, lng:88.0 },
  'kachin': { lat:25.7, lng:96.5 },
  'strait of malacca': { lat:3.5, lng:101.0 },
  'mekong': { lat:15.0, lng:105.0 },
  'east china sea': { lat:29.0, lng:124.0 },
  'yellow sea': { lat:35.0, lng:123.0 },
  'nepal': { lat:28.0, lng:84.0 },
  'cambodia': { lat:12.5, lng:104.9 },
};

const TYPE_COLORS = {
  geopolitical: '#e8854a',
  business: '#4a8fe8',
  environmental: '#4ab87a',
  conflict: '#e8c44a',
};

// ── Classify type ─────────────────────────────────────────
function classifyType(text) {
  const t = text.toLowerCase();
  const conflict = ['war','attack','military','missile','bomb','troops','coup','shooting','killed','battle','armed','conflict','combat','weapon','airstrike','navy','fleet'];
  const env = ['typhoon','earthquake','flood','tsunami','volcano','climate','storm','wildfire','drought','pollution','disaster','cyclone','hurricane'];
  const geo = ['sanction','diplomatic','treaty','territorial','dispute','tension','espionage','tariff','trade war','summit','election','protest','minister','president','government','foreign','bilateral','nuclear','security council'];
  if (conflict.some(w => t.includes(w))) return 'conflict';
  if (env.some(w => t.includes(w))) return 'environmental';
  if (geo.some(w => t.includes(w))) return 'geopolitical';
  return 'business';
}

// ── Extract location ──────────────────────────────────────
function extractLocation(text) {
  const lower = (text || '').toLowerCase();
  for (const [place, coords] of Object.entries(LOCATIONS)) {
    if (lower.includes(place)) {
      const name = place.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return { name, ...coords };
    }
  }
  return { name: 'Asia-Pacific', lat: 15 + (Math.random()-0.5)*8, lng: 108 + (Math.random()-0.5)*20 };
}

// ── Assess significance ───────────────────────────────────
function assessSig(text) {
  const t = (text||'').toLowerCase();
  const high = ['war','attack','missile','nuclear','coup','invasion','explosion','typhoon','earthquake','tsunami','sanctions','crisis','emergency','critical'];
  const med = ['tension','dispute','concern','warning','disruption','shortage','tariff','arrest','flood','conflict','military','protest'];
  if (high.some(w => t.includes(w))) return { level:'High', score:4 };
  if (med.some(w => t.includes(w))) return { level:'Medium', score:3 };
  return { level:'Low', score:2 };
}

// ── Time formatting ───────────────────────────────────────
function timeAgo(dateStr) {
  try {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 60000;
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${Math.round(diff)}m ago`;
    if (diff < 1440) return `${Math.round(diff/60)}h ago`;
    return `${Math.round(diff/1440)}d ago`;
  } catch { return 'Recently'; }
}

// ── Deduplicate ───────────────────────────────────────────
function deduplicate(articles) {
  const seen = new Set();
  return articles.filter(a => {
    if (!a.title) return false;
    const key = a.title.slice(0,40).toLowerCase().replace(/[^a-z0-9]/g,'');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── APAC relevance check ──────────────────────────────────
function isAPACRelevant(title, description) {
  const text = ((title||'') + ' ' + (description||'')).toLowerCase();
  const apacKeywords = [
    'china','taiwan','japan','korea','vietnam','indonesia','philippines',
    'singapore','malaysia','thailand','myanmar','india','pakistan',
    'asean','asia','apac','pacific','south china sea','semiconductor',
    'supply chain','trade','shipping','huawei','beijing','tokyo','seoul',
    'jakarta','manila','hanoi','rare earth','battery','ev','lithium',
    'indo-pacific','east asia','southeast asia','northeast asia'
  ];
  return apacKeywords.some(k => text.includes(k));
}

// ── Source 1: NewsData.io ─────────────────────────────────
async function fetchNewsData() {
  if (!NEWSDATA_KEY) return [];

  // Get date range — last 12 hours only
  const from = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().split('T')[0];

  const queries = [
    'South China Sea Taiwan Strait military naval',
    'China sanctions military diplomatic Asia',
    'Korea Japan semiconductor trade supply chain',
    'Southeast Asia Indonesia Philippines Vietnam conflict',
    'India Pakistan border geopolitical',
    'typhoon cyclone earthquake flood Asia Pacific',
    'Myanmar conflict military',
    'North Korea missile nuclear',
    'ASEAN trade dispute Asia economy',
    'rare earth battery supply chain disruption',
  ];

  // Top-tier sources only
  const TRUSTED_DOMAINS = [
    'reuters.com','apnews.com','bbc.com','bloomberg.com',
    'ft.com','scmp.com','nikkei.com','channelnewsasia.com',
    'straitstimes.com','theguardian.com','wsj.com',
    'aljazeera.com','cnbc.com','economist.com',
    'japantimes.co.jp','koreaherald.com','bangkokpost.com',
    'thestar.com.my','vnexpress.net','irrawaddy.com',
  ];

  const allArticles = [];
  for (const q of queries) {
    try {
      const url = `https://newsdata.io/api/1/news?apikey=${NEWSDATA_KEY}&q=${encodeURIComponent(q)}&language=en&size=5&prioritydomain=top&from_date=${from}&domainurl=${TRUSTED_DOMAINS.slice(0,5).join(',')}`;
      const res = await fetch(url, { timeout: 8000 });
      if (!res.ok) {
        // Fallback without domain filter
        const url2 = `https://newsdata.io/api/1/news?apikey=${NEWSDATA_KEY}&q=${encodeURIComponent(q)}&language=en&size=5&prioritydomain=top&from_date=${from}`;
        const res2 = await fetch(url2, { timeout: 8000 });
        if (!res2.ok) { console.log(`[NewsData] ${res2.status}`); continue; }
        const data2 = await res2.json();
        if (data2.results) allArticles.push(...data2.results.filter(a => isRecent(a.pubDate, 24)));
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      const data = await res.json();
      if (data.results) {
        // Only keep articles from last 24 hours
        const recent = data.results.filter(a => isRecent(a.pubDate, 24));
        allArticles.push(...recent);
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[NewsData] Query failed: ${err.message}`);
    }
  }
  return allArticles;
}

function isRecent(dateStr, hours) {
  if (!dateStr) return true; // keep if no date
  try {
    const diff = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
    return diff <= hours;
  } catch { return true; }
}

// ── Source 2: GDELT DOC API ───────────────────────────────
async function fetchGDELT() {
  const queries = [
    'South China Sea conflict',
    'Taiwan China military',
    'Asia Pacific supply chain disruption',
    'ASEAN geopolitical',
    'Korea Japan trade',
  ];

  const allArticles = [];
  for (const q of queries) {
    try {
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=5&format=json&timespan=12h&sort=hybridrel`;
      const res = await fetch(url, { timeout: 8000 });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.articles) {
        const formatted = data.articles.map(a => ({
          title: a.title,
          description: a.title,
          link: a.url,
          source_id: a.domain,
          pubDate: a.seendate ? `${a.seendate.slice(0,4)}-${a.seendate.slice(4,6)}-${a.seendate.slice(6,8)}T${a.seendate.slice(8,10)}:${a.seendate.slice(10,12)}:00Z` : new Date().toISOString(),
        }));
        allArticles.push(...formatted);
      }
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.log(`[GDELT] ${err.message}`);
    }
  }
  return allArticles;
}

// ── Process into events ───────────────────────────────────
function processArticles(rawArticles) {
  const articles = deduplicate(rawArticles);
  return articles
    .filter(a => a.title && a.title.length > 25)
    .filter(a => isAPACRelevant(a.title, a.description))
    .map((a, i) => {
      const text = (a.title||'') + ' ' + (a.description||'');
      const type = classifyType(text);
      const loc = extractLocation(text);
      const sig = assessSig(a.title);
      return {
        id: `live-${Date.now()}-${i}-${Math.random().toString(36).substr(2,5)}`,
        type,
        title: a.title,
        shortTitle: a.title.length > 70 ? a.title.slice(0,67)+'...' : a.title,
        lede: a.description ? a.description.slice(0,140)+'...' : `Reported by ${a.source_id||'news source'}.`,
        location: loc.name,
        lat: loc.lat,
        lng: loc.lng,
        time: timeAgo(a.pubDate),
        sig: sig.level,
        sigLevel: sig.score,
        color: TYPE_COLORS[type],
        url: a.link,
        source: a.source_id || 'Unknown',
        what: a.description || a.title,
        soWhat: null,
        affected: [],
        next: [],
        history: null,
        escalation: sig.score,
        marketImpact: { affected: loc.name },
        live: true,
        pubDate: a.pubDate,
      };
    })
    .sort((a,b) => b.sigLevel - a.sigLevel)
    .slice(0, 60);
}

// ── Cache ─────────────────────────────────────────────────
let cache = {
  events: [],
  lastUpdated: null,
  isLive: false,
  sources: [],
};

async function refresh() {
  console.log('[Geode] Refreshing news feed...');
  const allArticles = [];
  const sources = [];

  // Try NewsData.io
  if (NEWSDATA_KEY) {
    try {
      const articles = await fetchNewsData();
      allArticles.push(...articles);
      sources.push(`NewsData.io (${articles.length})`);
      console.log(`[Geode] NewsData: ${articles.length} articles`);
    } catch (err) {
      console.error('[Geode] NewsData failed:', err.message);
    }
  }

  // Try GDELT as supplement
  try {
    const articles = await fetchGDELT();
    allArticles.push(...articles);
    sources.push(`GDELT (${articles.length})`);
    console.log(`[Geode] GDELT: ${articles.length} articles`);
  } catch (err) {
    console.log('[Geode] GDELT unavailable:', err.message);
  }

  if (allArticles.length > 0) {
    const events = processArticles(allArticles);
    cache = {
      events,
      lastUpdated: new Date().toISOString(),
      isLive: true,
      sources,
    };
    console.log(`[Geode] Cache: ${events.length} APAC events | Sources: ${sources.join(', ')}`);
  } else {
    console.log('[Geode] No articles fetched — serving cached data');
  }
}

// ── Routes ────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const { type, sig, limit } = req.query;
  let events = [...cache.events];
  if (type) events = events.filter(e => e.type === type);
  if (sig) events = events.filter(e => e.sig === sig);
  if (limit) events = events.slice(0, parseInt(limit));
  res.json({
    events,
    lastUpdated: cache.lastUpdated,
    count: events.length,
    isLive: cache.isLive,
    sources: cache.sources,
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    eventCount: cache.events.length,
    lastUpdated: cache.lastUpdated,
    isLive: cache.isLive,
    sources: cache.sources,
    apiKeys: {
      newsdata: !!NEWSDATA_KEY,
      gdelt: true,
    }
  });
});

app.post('/api/refresh', async (req, res) => {
  await refresh();
  res.json({ success: true, count: cache.events.length, sources: cache.sources });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
refresh().then(() => {
  app.listen(PORT, () => {
    console.log(`[Geode] Server on port ${PORT} | Events: ${cache.events.length} | Live: ${cache.isLive}`);
  });
});

// Refresh every 10 minutes
cron.schedule('*/10 * * * *', refresh);
