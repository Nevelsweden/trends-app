// News sources read via RSS/Atom (or an official API). To add a source, append an
// entry here; nothing else needs to change.
//   id        short unique key, used in URLs and the UI
//   name      display name
//   category  'news' or 'tech' (the "Tech & design" tab)
//   region    'SE' (Sweden) or 'INT' (international)
//   feedUrl   RSS 2.0 or Atom feed URL (type 'hn' uses the Hacker News API instead)
//   short     1-3 characters for the source badge, color for its background
// Every URL below was verified by fetching it (see README for the date and the
// feeds that were checked and skipped).
const SOURCES = [
  { id: 'yahoo', name: 'Yahoo News', category: 'news', region: 'INT', short: 'Y!', color: '#6001d2',
    feedUrl: 'https://news.yahoo.com/rss/' },
  { id: 'bbc', name: 'BBC News', category: 'news', region: 'INT', short: 'BBC', color: '#b80000',
    feedUrl: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { id: 'guardian', name: 'The Guardian', category: 'news', region: 'INT', short: 'G', color: '#052962',
    feedUrl: 'https://www.theguardian.com/international/rss' },
  { id: 'nyt', name: 'New York Times', category: 'news', region: 'INT', short: 'NYT', color: '#222222',
    feedUrl: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
  { id: 'aljazeera', name: 'Al Jazeera', category: 'news', region: 'INT', short: 'AJ', color: '#c68a00',
    feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml' },

  { id: 'dn', name: 'Dagens Nyheter', category: 'news', region: 'SE', short: 'DN', color: '#d6001c',
    feedUrl: 'https://www.dn.se/rss/' },
  { id: 'svd', name: 'Svenska Dagbladet', category: 'news', region: 'SE', short: 'SvD', color: '#1d3f6e',
    feedUrl: 'https://www.svd.se/feed/articles.rss' },
  { id: 'aftonbladet', name: 'Aftonbladet', category: 'news', region: 'SE', short: 'Ab', color: '#e2001a',
    feedUrl: 'https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/' },
  { id: 'expressen', name: 'Expressen', category: 'news', region: 'SE', short: 'Ex', color: '#ffd200', ink: '#000',
    feedUrl: 'https://feeds.expressen.se/nyheter/' },
  { id: 'svt', name: 'SVT Nyheter', category: 'news', region: 'SE', short: 'SVT', color: '#1e7a3c',
    feedUrl: 'https://www.svt.se/nyheter/rss.xml' },

  { id: 'hn', name: 'Hacker News', category: 'tech', region: 'INT', short: 'HN', color: '#ff6600', type: 'hn',
    feedUrl: 'https://hacker-news.firebaseio.com/v0/topstories.json' },
  { id: 'verge', name: 'The Verge', category: 'tech', region: 'INT', short: 'V', color: '#5200ff',
    feedUrl: 'https://www.theverge.com/rss/index.xml' },
  { id: 'smashing', name: 'Smashing Magazine', category: 'tech', region: 'INT', short: 'SM', color: '#d33a2c',
    feedUrl: 'https://www.smashingmagazine.com/feed/' },
];

// region: 'all' | 'se' | 'int'; category: 'all' | 'news' | 'tech'
function selectSources({ region = 'all', category = 'all' } = {}) {
  return SOURCES.filter((s) =>
    (region === 'all' || s.region === region.toUpperCase()) &&
    (category === 'all' || s.category === category));
}

module.exports = { SOURCES, selectSources };
