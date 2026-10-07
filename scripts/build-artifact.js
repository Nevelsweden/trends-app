// Builds a self-contained snapshot page for publishing as a claude.ai artifact.
// Artifacts cannot call the YouTube API themselves, so this fetches the data
// now and embeds it in artifact/youtube-trends.html.
// Usage: node scripts/build-artifact.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
for (const line of fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY) throw new Error('YOUTUBE_API_KEY is not set');

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

(async () => {
  const categories = {};
  const cats = await api('videoCategories', { part: 'snippet', regionCode: 'US', hl: 'en' });
  for (const c of cats.items) categories[c.id] = c.snippet.title;

  const videos = {};
  const charts = {};
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

  const data = { fetchedAt: new Date().toISOString(), regions: REGIONS, categories, charts, videos };
  const template = fs.readFileSync(path.join(root, 'artifact', 'template.html'), 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const out = template.replace('/*__DATA__*/null', json);
  fs.writeFileSync(path.join(root, 'artifact', 'youtube-trends.html'), out);
  console.log('videos', Object.keys(videos).length, 'bytes', out.length);
})();
