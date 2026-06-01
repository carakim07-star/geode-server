const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

// ── APAC region config ────────────────────────────────────
const APAC_QUERIES = [
  { query: 'South China Sea military naval', type: 'geopolitical', region: 'South China Sea' },
  { query: 'China Philippines Taiwan dispute', type: 'geopolitical', region: 'East Asia' },
  { query: 'Indonesia Malaysia economy trade', type: 'business', region: 'Southeast Asia' },
  { query: 'Japan South Korea economy', type: 'business', region: 'Northeast Asia' },
  { query: 'typhoon flood earthquake Asia', type: 'environmental', region: 'APAC' },
  { query: 'Myanmar conflict military coup', type: 'conflict', region: 'Myanmar' },
  { query: 'India China border dispute trade', type: 'geopolitical', region: 'South Asia' },
  { query: 'Singapore Vietnam supply chain semiconductor', type: 'business', region: 'Southeast Asia' },
  { query: 'North Korea missile nuclear', type: 'conflict', region: 'Korean Peninsula' },
  { query: 'ASEAN summit trade agreement', type: 'business', region: 'Southeast Asia' },
];

// ── Location → coordinates lookup ────────────────────────
const LOCATION_COORDS = {
  'south china sea': { lat: 12.0, lng: 114.0 },
  'taiwan': { lat: 23.5, lng: 121.0 },
  'taiwan strait': { lat: 24.0, lng: 119.5 },
  'philippines': { lat: 12.5, lng: 122.0 },
  'manila': { lat: 14.6, lng: 121.0 },
  'vietnam': { lat: 14.0, lng: 108.0 },
  'hanoi': { lat: 21.0, lng: 105.8 },
  'ho chi minh': { lat: 10.8, lng: 106.7 },
  'indonesia': { lat: -5.0, lng: 120.0 },
  'jakarta': { lat: -6.2, lng: 106.8 },
  'malaysia': { lat: 4.2, lng: 108.0 },
  'kuala lumpur': { lat: 3.1, lng: 101.7 },
  'singapore': { lat: 1.35, lng: 103.8 },
  'thailand': { lat: 13.0, lng: 101.0 },
  'bangkok': { lat: 13.75, lng: 100.5 },
  'myanmar': { lat: 19.0, lng: 96.5 },
  'yangon': { lat: 16.8, lng: 96.2 },
  'china': { lat: 35.0, lng: 105.0 },
  'beijing': { lat: 39.9, lng: 116.4 },
  'shanghai': { lat: 31.2, lng: 121.5 },
  'hong kong': { lat: 22.3, lng: 114.2 },
  'japan': { lat: 36.0, lng: 138.0 },
  'tokyo': { lat: 35.7, lng: 139.7 },
  'osaka': { lat: 34.7, lng: 135.5 },
  'south korea': { lat: 36.5, lng: 127.5 },
  'seoul': { lat: 37.6, lng: 126.9 },
  'north korea': { lat: 40.0, lng: 127.0 },
  'india': { lat: 20.0, lng: 77.0 },
  'new delhi': { lat: 28.6, lng: 77.2 },
  'mumbai': { lat: 19.1, lng: 72.9 },
  'bangladesh': { lat: 23.7, lng: 90.4 },
  'pakistan': { lat: 30.4, lng: 69.3 },
  'cambodia': { lat: 12.5, lng: 104.9 },
  'laos': { lat: 18.0, lng: 103.0 },
  'sri lanka': { lat: 7.9, lng: 80.7 },
  'nepal': { lat: 28.0, lng: 84.0 },
  'australia': { lat: -25.0, lng: 133.0 },
  'sydney': { lat: -33.9, lng: 151.2 },
  'papua new guinea': { lat: -6.0, lng: 147.0 },
  'mekong': { lat: 15.0, lng: 105.0 },
  'spratly': { lat: 10.0, lng: 114.0 },
  'paracel': { lat: 16.5, lng: 112.0 },
  'xinjiang': { lat: 42.0, lng: 87.0 },
  'tibet': { lat: 32.0, lng: 88.0 },
  'sichuan': { lat: 30.5, lng: 103.0 },
  'guangdong': { lat: 23.5, lng: 113.0 },
  'kachin': { lat: 25.7, lng: 96.5 },
  'east china sea': { lat: 29.0, lng: 124.0 },
  'yellow sea': { lat: 35.0, lng: 123.0 },
  'indian ocean': { lat: -10.0, lng: 80.0 },
  'strait of malacca': { lat: 3.5, lng: 101.0 },
  'banda sea': { lat: -5.0, lng: 128.0 },
  'celebes sea': { lat: 4.0, lng: 123.0 },
};

const TYPE_COLORS = {
  geopolitical: '#e8854a',
  business: '#4a8fe8',
  environmental: '#4ab87a',
  conflict: '#e8c44a',
};

// ── Extract location from article ────────────────────────
function extractLocation(title, description, queryRegion) {
  const text = (title + ' ' + (description || '')).toLowerCase();

  for (const [place, coords] of Object.entries(LOCATION_COORDS)) {
    if (text.includes(place)) {
      return {
        name: place.charAt(0).toUpperCase() + place.slice(1),
        ...coords
      };
    }
  }

  // Fallback: use query region center
  const regionFallbacks = {
    'South China Sea': { lat: 12.0, lng: 114.0 },
    'East Asia': { lat: 35.0, lng: 118.0 },
    'Southeast Asia': { lat: 5.0, lng: 112.0 },
    'Northeast Asia': { lat: 37.0, lng: 128.0 },
    'APAC': { lat: 15.0, lng: 110.0 },
    'Myanmar': { lat: 19.0, lng: 96.5 },
    'South Asia': { lat: 25.0, lng: 80.0 },
    'Korean Peninsula': { lat: 38.0, lng: 127.0 },
  };

  const fallback = regionFallbacks[queryRegion] || { lat: 15.0, lng: 105.0 };
  // Add small random offset so events don't stack perfectly
  return {
    name: queryRegion,
    lat: fallback.lat + (Math.random() - 0.5) * 4,
    lng: fallback.lng + (Math.random() - 0.5) * 6,
  };
}

// ── Assess significance ───────────────────────────────────
function assessSignificance(title) {
  const high = ['war', 'military', 'attack', 'invasion', 'conflict', 'crisis', 'sanction', 'ban', 'collapse', 'typhoon', 'earthquake', 'tsunami', 'explosion', 'missile', 'nuclear', 'coup', 'protest'];
  const medium = ['tension', 'dispute', 'concern', 'warning', 'risk', 'disruption', 'shortage', 'tariff', 'arrest', 'flood', 'fire'];

  const t = title.toLowerCase();
  if (high.some(w => t.includes(w))) return { level: 'High', score: 4 };
  if (medium.some(w => t.includes(w))) return { level: 'Medium', score: 3 };
  return { level: 'Low', score: 2 };
}

// ── Fetch from GDELT DOC API ──────────────────────────────
async function fetchGDELT(query, maxRecords = 8) {
  const encoded = encodeURIComponent(query);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encoded}&mode=artlist&maxrecords=${maxRecords}&format=json&timespan=6h&sort=hybridrel`;

  const res = await fetch(url, { timeout: 8000 });
  if (!res.ok) throw new Error(`GDELT returned ${res.status}`);
  const data = await res.json();
  return data.articles || [];
}

// ── Process raw articles into Geode events ────────────────
function processArticles(articles, queryConfig) {
  return articles
    .filter(a => a.title && a.title.length > 20)
    .map((a, i) => {
      const loc = extractLocation(a.title, a.seendate, queryConfig.region);
      const sig = assessSignificance(a.title);
      const timeAgo = getTimeAgo(a.seendate);

      return {
        id: `gdelt-${Date.now()}-${i}-${Math.random().toString(36).substr(2,6)}`,
        type: queryConfig.type,
        title: a.title,
        shortTitle: a.title.length > 60 ? a.title.slice(0, 57) + '...' : a.title,
        lede: `Reported by ${a.domain || 'News source'}. ${queryConfig.region} update.`,
        location: loc.name,
        country: '',
        lat: loc.lat,
        lng: loc.lng,
        time: timeAgo,
        sig: sig.level,
        sigLevel: sig.score,
        color: TYPE_COLORS[queryConfig.type],
        url: a.url,
        source: a.domain || 'Unknown',
        what: a.title,
        soWhat: `This development in ${loc.name} may have significant implications for regional stability and supply chains across APAC. Monitor for follow-on developments.`,
        affected: [],
        next: [],
        history: `Part of ongoing developments in the ${queryConfig.region} region. Historical pattern analysis available for Pro subscribers.`,
        patternMatch: null,
        patternScore: null,
        escalation: sig.score,
        marketImpact: { affected: queryConfig.region },
        gdelt: true,
        seendate: a.seendate,
      };
    });
}

function getTimeAgo(seendate) {
  if (!seendate) return 'Recently';
  try {
    // GDELT format: YYYYMMDDHHMMSS
    const y = seendate.slice(0,4), mo = seendate.slice(4,6), d = seendate.slice(6,8);
    const h = seendate.slice(8,10), mi = seendate.slice(10,12);
    const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:00Z`);
    const diff = (Date.now() - date.getTime()) / 1000 / 60; // minutes
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${Math.round(diff)}m ago`;
    if (diff < 1440) return `${Math.round(diff/60)}h ago`;
    return `${Math.round(diff/1440)}d ago`;
  } catch { return 'Recently'; }
}

// ── Event cache ───────────────────────────────────────────
let eventCache = { events: [], lastUpdated: null };

async function refreshEvents() {
  console.log('[GDELT] Refreshing events...');
  const allEvents = [];

  for (const queryConfig of APAC_QUERIES) {
    try {
      const articles = await fetchGDELT(queryConfig.query, 5);
      const events = processArticles(articles, queryConfig);
      allEvents.push(...events);
      await new Promise(r => setTimeout(r, 400)); // rate limit
    } catch (err) {
      console.error(`[GDELT] Failed query "${queryConfig.query}":`, err.message);
    }
  }

  // Deduplicate by similar titles
  const seen = new Set();
  const deduped = allEvents.filter(e => {
    const key = e.title.slice(0, 40).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by significance then recency
  deduped.sort((a, b) => b.sigLevel - a.sigLevel);

  eventCache = {
    events: deduped.slice(0, 40),
    lastUpdated: new Date().toISOString(),
  };

  console.log(`[GDELT] Cached ${eventCache.events.length} events`);
}

// ── Routes ────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const { type, sig } = req.query;
  let events = eventCache.events;

  if (type) events = events.filter(e => e.type === type);
  if (sig) events = events.filter(e => e.sig === sig);

  res.json({
    events,
    lastUpdated: eventCache.lastUpdated,
    count: events.length,
    source: 'GDELT Project 2.0',
  });
});

app.get('/api/events/:id', (req, res) => {
  const event = eventCache.events.find(e => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    eventCount: eventCache.events.length,
    lastUpdated: eventCache.lastUpdated,
    source: 'GDELT Project 2.0',
    coverage: 'APAC · Real-time news intelligence',
  });
});

app.post('/api/refresh', async (req, res) => {
  await refreshEvents();
  res.json({ success: true, count: eventCache.events.length });
});

// ── Startup ───────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

refreshEvents().then(() => {
  app.listen(PORT, () => {
    console.log(`[Geode] Server running on port ${PORT}`);
    console.log(`[Geode] Events: ${eventCache.events.length}`);
  });
});

// Refresh every 15 minutes
cron.schedule('*/15 * * * *', refreshEvents);
