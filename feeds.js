// Feed fetching and parsing: a small regex-based reader for RSS 2.0 and Atom,
// the Hacker News API and the Google Trends "Trending now" RSS feed.
// Only headline, link, source, publish time and a short excerpt are kept; the UI
// always links to the original article.
const EXCERPT_MAX = 200;
const TIMEOUT_MS = 10000;
const USER_AGENT = 'trends-app/0.2 (+https://github.com/Nevelsweden/trends-app)';

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–',
  mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', deg: '°',
  aring: 'å', Aring: 'Å', auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö', eacute: 'é', Eacute: 'É',
  egrave: 'è', aacute: 'á', uuml: 'ü', Uuml: 'Ü', oslash: 'ø', Oslash: 'Ø', aelig: 'æ', AElig: 'Æ',
  ccedil: 'ç', ntilde: 'ñ', szlig: 'ß', iacute: 'í', oacute: 'ó', uacute: 'ú',
};

function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return NAMED[e] ?? m;
  });
}

// HTML fragment -> plain text.
function stripHtml(html = '') {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|figure|iframe|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|br|div|li|ul|ol|h[1-6]|tr|td|th|blockquote|figcaption|section|article)\b[^>]*>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '');
}

const clean = (s) => decodeEntities(stripHtml(s)).replace(/\s+/g, ' ').trim();

function excerpt(text, max = EXCERPT_MAX) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?–-]+$/, '')}…`;
}

// Inner text of the first <name ...>...</name> element (raw, unescaped once).
function element(s, name) {
  const m = s.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  const inner = m[1].trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(inner);
}

function first(s, names) {
  for (const n of names) {
    const v = element(s, n);
    if (v != null && v.trim()) return v;
  }
  return '';
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2]) : null;
}

function atomLink(entry) {
  const links = entry.match(/<link\b[^>]*>/gi) || [];
  const pick = links.find((l) => (attr(l, 'rel') || 'alternate') === 'alternate') || links[0];
  return pick ? attr(pick, 'href') : null;
}

function isoDate(s) {
  if (!s) return null;
  const d = new Date(s.trim());
  return isNaN(d) ? null : d.toISOString();
}

// Parse an RSS 2.0 or Atom document into
// [{ title, url, source, publishedAt, excerpt }].
function parseFeed(xml, source = '') {
  const atom = !/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const items = [];
  for (const b of blocks) {
    const title = clean(first(b, ['title']));
    let url = atom ? atomLink(b) : clean(first(b, ['link']));
    if (!url) {
      const guid = b.match(/<(guid|id)(\s[^>]*)?>([\s\S]*?)<\/\1>/i);
      if (guid && /^https?:\/\//.test(guid[3].trim())) url = guid[3].trim();
    }
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    const text = clean(first(b, ['description', 'summary', 'content:encoded', 'content', 'media:description']));
    items.push({
      title,
      url,
      source,
      publishedAt: isoDate(first(b, ['pubDate', 'published', 'updated', 'dc:date'])),
      excerpt: excerpt(text),
    });
  }
  return items;
}

async function get(url, as = 'text') {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === 'json' ? res.json() : res.text();
}

// Hacker News: official Firebase API, top 30 stories.
async function fetchHackerNews(source, limit = 30) {
  const ids = (await get(source.feedUrl, 'json')).slice(0, limit);
  const stories = await Promise.allSettled(ids.map((id) =>
    get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, 'json')));
  return stories
    .filter((r) => r.status === 'fulfilled' && r.value && r.value.title)
    .map(({ value: s }) => ({
      title: decodeEntities(s.title),
      url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
      source: source.id,
      publishedAt: s.time ? new Date(s.time * 1000).toISOString() : null,
      excerpt: `${s.score || 0} points · ${s.descendants || 0} comments`,
      discussionUrl: `https://news.ycombinator.com/item?id=${s.id}`,
    }));
}

async function fetchSource(source) {
  if (source.type === 'hn') return fetchHackerNews(source);
  const items = parseFeed(await get(source.feedUrl), source.id);
  if (!items.length) throw new Error('Feed returned no items');
  return items.slice(0, 60);
}

// Google Trends has no official API; this reads the public "Trending now" RSS feed.
async function fetchGoogleTrends(region) {
  return parseTrendsRss(await get(`https://trends.google.com/trending/rss?geo=${region}`), region);
}

function parseTrendsRss(xml, region) {
  const tag = (s, name) => clean(element(s, name) || '');
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m, i) => {
    const item = m[1];
    const news = [...item.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map((n) => ({
      title: tag(n[1], 'ht:news_item_title'),
      url: tag(n[1], 'ht:news_item_url'),
      source: tag(n[1], 'ht:news_item_source'),
    }));
    const traffic = tag(item, 'ht:approx_traffic');
    return {
      rank: i + 1,
      query: tag(item, 'title'),
      traffic,
      trafficValue: Number(traffic.replace(/[^\d]/g, '')) || 0,
      startedAt: tag(item, 'pubDate'),
      picture: tag(item, 'ht:picture'),
      news,
      region,
    };
  });
}

module.exports = {
  decodeEntities, stripHtml, excerpt, parseFeed, parseTrendsRss,
  fetchSource, fetchGoogleTrends, EXCERPT_MAX,
};
