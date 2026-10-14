// Builds a self-contained snapshot page for publishing as a claude.ai artifact.
// Artifacts cannot call the YouTube API or read feeds themselves, so this
// fetches the data now and embeds it in artifact/youtube-trends.html:
// trending topics (news feeds + Google Trends + YouTube) and the YouTube charts.
// Without YOUTUBE_API_KEY the snapshot contains the topics only.
// Usage: node scripts/build-artifact.js
const fs = require('fs');
const path = require('path');
const { SOURCES, selectSources } = require('../sources');
const { fetchSource, fetchGoogleTrends } = require('../feeds');
const { buildDocs, scoreTopics } = require('../trends');

const root = path.join(__dirname, '..');
for (const line of fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY) console.warn('YOUTUBE_API_KEY is not set: building a snapshot without YouTube charts');

const REGIONS = {
  SE: 'Sweden', US: 'United States', GB: 'United Kingdom', DE: 'Germany',
  FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', PL: 'Poland',
};

async function api(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.search = new URLSearchParams({ ...params, key: KEY });
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `YouTube API ${res.status}`);
  return body;
}

function seconds(iso = '') {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function youtubeCharts() {
  const categories = {};
  const videos = {};
  const charts = {};
  if (!KEY) return { categories, videos, charts };
  const cats = await api('videoCategories', { part: 'snippet', regionCode: 'US', hl: 'en' });
  for (const c of cats.items) categories[c.id] = c.snippet.title;

  for (const region of Object.keys(REGIONS)) {
    const body = await api('videos', {
      part: 'snippet,statistics,contentDetails', chart: 'mostPopular',
      regionCode: region, maxResults: '50', hl: 'en',
    });
    charts[region] = body.items.map((v) => v.id);
    for (const v of body.items) {
      videos[v.id] ??= {
        t: v.snippet.title,
        c: v.snippet.channelTitle,
        k: v.snippet.categoryId,
        p: v.snippet.publishedAt,
        d: seconds(v.contentDetails?.duration),
        v: Number(v.statistics?.viewCount || 0),
        l: Number(v.statistics?.likeCount || 0),
        m: Number(v.statistics?.commentCount || 0),
        lang: v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || '',
      };
    }
    console.log(region, body.items.length);
  }
  return { categories, videos, charts };
}

// Same inputs as /api/trends, computed once per region filter.
async function trendSnapshot(yt) {
  const news = await Promise.all(SOURCES.map(async (s) => {
    try { return { ...s, items: await fetchSource(s) }; } catch (err) {
      console.warn(`skipping ${s.id}: ${err.message}`);
      return { ...s, items: [] };
    }
  }));
  const google = (await Promise.all(['SE', 'US', 'GB'].map(async (region) => {
    try { return { region, items: await fetchGoogleTrends(region) }; } catch (err) {
      console.warn(`skipping Google Trends ${region}: ${err.message}`);
      return null;
    }
  }))).filter(Boolean);
  const youtube = Object.entries(yt.charts).map(([region, ids]) =>
    ({ region, items: ids.map((id) => ({ id, title: yt.videos[id].t, channel: yt.videos[id].c })) }));
  const regions = { all: ['SE', 'US', 'GB'], se: ['SE'], int: ['US', 'GB'] };
  const trends = {};
  for (const [scope, codes] of Object.entries(regions)) {
    const ids = new Set(selectSources({ region: scope }).map((s) => s.id));
    const docs = buildDocs({
      news: news.filter((s) => ids.has(s.id)),
      google: google.filter((g) => codes.includes(g.region)),
      youtube: youtube.filter((y) => codes.includes(y.region)),
    });
    trends[scope] = scoreTopics(docs, { itemsPerTopic: 10 });
    console.log(`topics ${scope}`, trends[scope].length, 'from', docs.length, 'docs');
  }
  const sources = Object.fromEntries(SOURCES.map((s) => [s.id, { name: s.name, short: s.short, color: s.color, ink: s.ink }]));
  sources.google = { name: 'Google Trends', short: 'G', color: '#1a73e8' };
  sources.youtube = { name: 'YouTube', short: '▶', color: '#e62117' };
  const live = news.filter((s) => s.items.length).length + (google.length ? 1 : 0) + (youtube.length ? 1 : 0);
  return { trends, sources, sourceCount: { live, total: SOURCES.length + 2 } };
}

(async () => {
  const yt = await youtubeCharts();
  const t = await trendSnapshot(yt);
  const data = { fetchedAt: new Date().toISOString(), regions: REGIONS, ...yt, ...t };
  const template = fs.readFileSync(path.join(root, 'artifact', 'template.html'), 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const out = template.replace('/*__DATA__*/null', json);
  fs.writeFileSync(path.join(root, 'artifact', 'youtube-trends.html'), out);
  console.log('videos', Object.keys(yt.videos).length, 'bytes', out.length);
})();
