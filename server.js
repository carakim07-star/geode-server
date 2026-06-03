const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ────────────────────────────────────────────────
const NEWSDATA_KEY = process.env.NEWSDATA_API_KEY || '';
const USE_MOCK = !NEWSDATA_KEY;

// ── Location lookup ───────────────────────────────────────
const LOCATION_COORDS = {
  'south china sea': { lat: 12.0, lng: 114.0 },
  'taiwan': { lat: 23.5, lng: 121.0 },
  'philippines': { lat: 12.5, lng: 122.0 },
  'manila': { lat: 14.6, lng: 121.0 },
  'vietnam': { lat: 14.0, lng: 108.0 },
  'hanoi': { lat: 21.0, lng: 105.8 },
  'indonesia': { lat: -5.0, lng: 120.0 },
  'jakarta': { lat: -6.2, lng: 106.8 },
  'malaysia': { lat: 4.2, lng: 108.0 },
  'singapore': { lat: 1.35, lng: 103.8 },
  'thailand': { lat: 13.0, lng: 101.0 },
  'myanmar': { lat: 19.0, lng: 96.5 },
  'china': { lat: 35.0, lng: 105.0 },
  'beijing': { lat: 39.9, lng: 116.4 },
  'shanghai': { lat: 31.2, lng: 121.5 },
  'hong kong': { lat: 22.3, lng: 114.2 },
  'japan': { lat: 36.0, lng: 138.0 },
  'tokyo': { lat: 35.7, lng: 139.7 },
  'south korea': { lat: 36.5, lng: 127.5 },
  'korea': { lat: 36.5, lng: 127.5 },
  'seoul': { lat: 37.6, lng: 126.9 },
  'north korea': { lat: 40.0, lng: 127.0 },
  'india': { lat: 20.0, lng: 77.0 },
  'new delhi': { lat: 28.6, lng: 77.2 },
  'mumbai': { lat: 19.1, lng: 72.9 },
  'pakistan': { lat: 30.4, lng: 69.3 },
  'bangladesh': { lat: 23.7, lng: 90.4 },
  'cambodia': { lat: 12.5, lng: 104.9 },
  'australia': { lat: -25.0, lng: 133.0 },
  'taiwan strait': { lat: 24.0, lng: 119.5 },
  'mekong': { lat: 15.0, lng: 105.0 },
  'spratly': { lat: 10.0, lng: 114.0 },
  'xinjiang': { lat: 42.0, lng: 87.0 },
  'kachin': { lat: 25.7, lng: 96.5 },
  'strait of malacca': { lat: 3.5, lng: 101.0 },
};

const TYPE_COLORS = {
  geopolitical: '#e8854a',
  business: '#4a8fe8',
  environmental: '#4ab87a',
  conflict: '#e8c44a',
};

// ── Classify article ──────────────────────────────────────
function classifyType(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  const conflict = ['war', 'attack', 'military', 'missile', 'bomb', 'troops', 'coup', 'shooting', 'killed', 'battle', 'armed', 'conflict', 'combat'];
  const geo = ['sanction', 'diplomatic', 'treaty', 'territorial', 'dispute', 'tension', 'espionage', 'tariff', 'trade war', 'summit', 'election', 'protest', 'government', 'minister', 'president'];
  const env = ['typhoon', 'earthquake', 'flood', 'tsunami', 'volcano', 'climate', 'storm', 'wildfire', 'drought', 'pollution', 'disaster'];
  if (conflict.some(w => text.includes(w))) return 'conflict';
  if (env.some(w => text.includes(w))) return 'environmental';
  if (geo.some(w => text.includes(w))) return 'geopolitical';
  return 'business';
}

function extractLocation(text) {
  const lower = text.toLowerCase();
  for (const [place, coords] of Object.entries(LOCATION_COORDS)) {
    if (lower.includes(place)) {
      return { name: place.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), ...coords };
    }
  }
  // Default APAC center with slight random offset
  return {
    name: 'Asia-Pacific',
    lat: 15 + (Math.random() - 0.5) * 20,
    lng: 110 + (Math.random() - 0.5) * 30,
  };
}

function assessSig(title) {
  const high = ['war', 'military', 'attack', 'invasion', 'typhoon', 'earthquake', 'tsunami', 'missile', 'nuclear', 'coup', 'sanction', 'ban', 'crisis', 'collapse'];
  const t = title.toLowerCase();
  if (high.some(w => t.includes(w))) return { level: 'High', score: 4 };
  return { level: 'Medium', score: 3 };
}

function timeAgo(dateStr) {
  try {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 60000;
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${Math.round(diff)}m ago`;
    if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
    return `${Math.round(diff / 1440)}d ago`;
  } catch { return 'Recently'; }
}

// ── Fetch from NewsData.io ────────────────────────────────
async function fetchNewsData() {
  const queries = [
    'South China Sea OR Taiwan Strait OR Philippines military',
    'Asia Pacific geopolitical conflict',
    'Indonesia Malaysia Vietnam economy',
    'Japan Korea China trade',
    'typhoon flood earthquake Southeast Asia',
    'Myanmar conflict India Pakistan',
    'Singapore supply chain semiconductor ASEAN',
  ];

  const allArticles = [];

  for (const q of queries) {
    try {
      const url = `https://newsdata.io/api/1/news?apikey=${NEWSDATA_KEY}&q=${encodeURIComponent(q)}&language=en&size=5`;
      const res = await fetch(url, { timeout: 8000 });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.results) allArticles.push(...data.results);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[NewsData] Query failed: ${err.message}`);
    }
  }

  return allArticles;
}

// ── Process articles ──────────────────────────────────────
function processArticles(articles) {
  const seen = new Set();
  return articles
    .filter(a => a.title && a.title.length > 20)
    .filter(a => {
      const key = a.title.slice(0, 40).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((a, i) => {
      const text = a.title + ' ' + (a.description || '');
      const type = classifyType(a.title, a.description);
      const loc = extractLocation(text);
      const sig = assessSig(a.title);
      return {
        id: `nd-${Date.now()}-${i}`,
        type,
        title: a.title,
        shortTitle: a.title.length > 65 ? a.title.slice(0, 62) + '...' : a.title,
        lede: a.description ? a.description.slice(0, 120) + '...' : `Reported by ${a.source_id || 'News source'}.`,
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
        soWhat: `This development in ${loc.name} may have significant implications for regional stability and economic activity across APAC.`,
        affected: [],
        next: [],
        history: 'Historical pattern analysis available for Pro subscribers.',
        patternMatch: null,
        patternScore: null,
        escalation: sig.score,
        marketImpact: { affected: loc.name },
        live: true,
        pubDate: a.pubDate,
      };
    })
    .sort((a, b) => b.sigLevel - a.sigLevel)
    .slice(0, 50);
}

// ── Mock data fallback ────────────────────────────────────
const MOCK_EVENTS = [
  { id: 'm1', type: 'geopolitical', title: 'South China Sea naval tensions escalate near Spratly Islands', shortTitle: 'SCS naval escalation', lede: 'Demo data — add NEWSDATA_API_KEY for live intelligence.', location: 'South China Sea', lat: 12.0, lng: 114.0, time: '4m ago', sig: 'High', sigLevel: 4, color: '#e8854a', source: 'Demo', what: 'Demo event.', soWhat: 'Add your NewsData.io API key to see real events.', affected: [], next: [], history: '', escalation: 4, marketImpact: { affected: 'APAC' }, live: false },
  { id: 'm2', type: 'business', title: 'Indonesia extends nickel ore export ban affecting EV supply chains', shortTitle: 'Indonesia nickel ban extended', lede: 'Demo data — add NEWSDATA_API_KEY for live intelligence.', location: 'Jakarta, Indonesia', lat: -6.2, lng: 106.8, time: '1h ago', sig: 'High', sigLevel: 4, color: '#4a8fe8', source: 'Demo', what: 'Demo event.', soWhat: 'Add your NewsData.io API key to see real events.', affected: [], next: [], history: '', escalation: 3, marketImpact: { affected: 'Global EV' }, live: false },
  { id: 'm3', type: 'environmental', title: 'Typhoon intensifies in Philippine Sea heading toward Luzon', shortTitle: 'Typhoon approaching Philippines', lede: 'Demo data — add NEWSDATA_API_KEY for live intelligence.', location: 'Philippine Sea', lat: 16.0, lng: 126.0, time: '18m ago', sig: 'High', sigLevel: 5, color: '#4ab87a', source: 'Demo', what: 'Demo event.', soWhat: 'Add your NewsData.io API key to see real events.', affected: [], next: [], history: '', escalation: 5, marketImpact: { affected: 'Philippines' }, live: false },
  { id: 'm4', type: 'conflict', title: 'Armed clashes in Myanmar Kachin region disrupt rare earth mining', shortTitle: 'Myanmar Kachin mining conflict', lede: 'Demo data — add NEWSDATA_API_KEY for live intelligence.', location: 'Kachin State, Myanmar', lat: 25.7, lng: 96.5, time: '31m ago', sig: 'Medium', sigLevel: 3, color: '#e8c44a', source: 'Demo', what: 'Demo event.', soWhat: 'Add your NewsData.io API key to see real events.', affected: [], next: [], history: '', escalation: 3, marketImpact: { affected: 'Myanmar' }, live: false },
  { id: 'm5', type: 'geopolitical', title: 'India imposes new semiconductor tariffs on Chinese components', shortTitle: 'India semiconductor tariffs', lede: 'Demo data — add NEWSDATA_API_KEY for live intelligence.', location: 'New Delhi, India', lat: 28.6, lng: 77.2, time: '55m ago', sig: 'High', sigLevel: 4, color: '#e8854a', source: 'Demo', what: 'Demo event.', soWhat: 'Add your NewsData.io API key to see real events.', affected: [], next: [], history: '', escalation: 4, marketImpact: { affected: 'South Asia' }, live: false },
];

// ── Cache ─────────────────────────────────────────────────
let cache = { events: MOCK_EVENTS, lastUpdated: new Date().toISOString(), isLive: false };

async function refresh() {
  if (USE_MOCK) {
    console.log('[Geode] No API key — using demo data. Set NEWSDATA_API_KEY env var.');
    return;
  }
  console.log('[Geode] Fetching live news...');
  try {
    const articles = await fetchNewsData();
    const events = processArticles(articles);
    if (events.length > 0) {
      cache = { events, lastUpdated: new Date().toISOString(), isLive: true };
      console.log(`[Geode] Cached ${events.length} live events`);
    }
  } catch (err) {
    console.error('[Geode] Refresh failed:', err.message);
  }
}

// ── Routes ────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const { type } = req.query;
  let events = cache.events;
  if (type) events = events.filter(e => e.type === type);
  res.json({ events, lastUpdated: cache.lastUpdated, count: events.length, isLive: cache.isLive, source: cache.isLive ? 'NewsData.io' : 'Demo' });
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', eventCount: cache.events.length, lastUpdated: cache.lastUpdated, isLive: cache.isLive, apiKeySet: !USE_MOCK });
});

app.post('/api/refresh', async (req, res) => {
  await refresh();
  res.json({ success: true, count: cache.events.length, isLive: cache.isLive });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
refresh().then(() => {
  app.listen(PORT, () => console.log(`[Geode] Running on port ${PORT} | Live: ${cache.isLive}`));
});
cron.schedule('*/15 * * * *', refresh);
