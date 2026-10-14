// Small dependency-free server: serves the dashboard and proxies the two data
// sources so the YouTube API key never reaches the browser.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseTrendsRss, fetchGoogleTrends, fetchSource } = require('./feeds');
const { SOURCES, selectSources } = require('./sources');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.YOUTUBE_API_KEY;
const CACHE_MS = 10 * 60 * 1000;

const REGIONS = {
  SE: 'Sweden', US: 'United States', GB: 'United Kingdom', DE: 'Germany',
  FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', PL: 'Poland',
};
// The "Europe" view merges these countries.
const EUROPE = ['SE', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'NO', 'DK', 'FI', 'PL'];

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const cache = new Map();
// Caches successful results for CACHE_MS; concurrent callers share one request.
// Resolves to { value, at } so callers can report how fresh the data is.
function cachedEntry(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const entry = { at: Date.now() };
  entry.promise = Promise.resolve().then(fn).then((value) => ({ value, at: entry.at }));
  entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  cache.set(key, entry);
  return entry.promise;
}
const cached = async (key, fn) => (await cachedEntry(key, fn)).value;

// Fetch several news sources; one failing source never fails the whole response.
async function loadNews(sources) {
  const results = await Promise.allSettled(sources.map((s) => cachedEntry(`news:${s.id}`, () => fetchSource(s))));
  return sources.map((s, i) => {
    const r = results[i];
    const { feedUrl, type, ...meta } = s;
    return r.status === 'fulfilled'
      ? { ...meta, ok: true, fetchedAt: new Date(r.value.at).toISOString(), items: r.value.value }
      : { ...meta, ok: false, error: r.reason.message, items: [] };
  });
}

async function youtubeTrending(region) {
  if (!API_KEY) throw new Error('YOUTUBE_API_KEY is not set (see .env.example)');
  return cached(`yt:${region}`, async () => {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({
      part: 'snippet,statistics,contentDetails', chart: 'mostPopular',
      regionCode: region, maxResults: '25', key: API_KEY,
    });
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message || `YouTube API ${res.status}`);
    return body.items.map((v, i) => ({
      rank: i + 1,
      id: v.id,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      publishedAt: v.snippet.publishedAt,
      thumbnail: v.snippet.thumbnails?.medium?.url,
      views: Number(v.statistics?.viewCount || 0),
      likes: Number(v.statistics?.likeCount || 0),
      region,
    }));
  });
}

async function googleTrends(region) {
  return cached(`gt:${region}`, () => fetchGoogleTrends(region));
}

// Fetch one region, or merge all European ones.
async function forRegion(region, fn, merge) {
  if (region !== 'EU') return fn(region);
  const results = await Promise.allSettled(EUROPE.map(fn));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw results[0].reason;
  return merge(ok.flat());
}

function mergeVideos(videos) {
  const byId = new Map();
  for (const v of videos) {
    const e = byId.get(v.id);
    if (e) e.regions.push(v.region);
    else byId.set(v.id, { ...v, regions: [v.region] });
  }
  return [...byId.values()]
    .sort((a, b) => b.regions.length - a.regions.length || b.views - a.views)
    .slice(0, 40).map((v, i) => ({ ...v, rank: i + 1 }));
}

function mergeTrends(trends) {
  return trends
    .sort((a, b) => b.trafficValue - a.trafficValue)
    .slice(0, 60).map((t, i) => ({ ...t, rank: i + 1 }));
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const SCOPES = { region: ['all', 'se', 'int'], category: ['all', 'news', 'tech'] };

// The age of the stalest data in a response (what "last updated" should show).
function oldest(parts) {
  const times = parts.filter((p) => p.fetchedAt).map((p) => p.fetchedAt).sort();
  return times[0] || new Date().toISOString();
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const region = (url.searchParams.get('region') || 'SE').toUpperCase();
  const scope = {
    region: (url.searchParams.get('region') || 'all').toLowerCase(),
    category: (url.searchParams.get('category') || 'all').toLowerCase(),
  };
  try {
    if (url.pathname === '/api/sources') {
      return send(res, 200, { sources: SOURCES.map(({ type, ...s }) => s) });
    }
    if (url.pathname === '/api/news') {
      if (!SCOPES.region.includes(scope.region) || !SCOPES.category.includes(scope.category)) {
        return send(res, 400, { error: 'region must be all|se|int, category all|news|tech' });
      }
      const sources = await loadNews(selectSources(scope));
      return send(res, 200, { ...scope, updatedAt: oldest(sources), sources });
    }
    if (url.pathname === '/api/regions') {
      return send(res, 200, { regions: { EU: 'Europe (combined)', ...REGIONS } });
    }
    if (url.pathname === '/api/youtube' || url.pathname === '/api/google') {
      if (region !== 'EU' && !REGIONS[region]) return send(res, 400, { error: 'Unknown region' });
      const items = url.pathname === '/api/youtube'
        ? await forRegion(region, youtubeTrending, mergeVideos)
        : await forRegion(region, googleTrends, mergeTrends);
      return send(res, 200, { region, items });
    }
    const file = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file)) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': (MIME[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    send(res, 502, { error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Trends app on http://localhost:${PORT}`));
}
module.exports = { parseTrendsRss };
