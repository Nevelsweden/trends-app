# Trend Spotter

A small web dashboard that collects what is trending right now on YouTube, Google
search and the major news sites, and highlights topics that show up in several
sources at the same time.

- **Hottest topics right now**: topics mentioned by several different sources,
  ranked by number of sources × freshness, with a boost when a topic appears in
  news, searches *and* videos. Click a topic to see the articles, searches and
  videos behind it.
- **Tabs**: All / News / Tech & design / YouTube / Search. The YouTube and Google
  tabs keep the original per-country views (Sweden, the US, individual European
  countries and a combined Europe view).
- **Region filter**: Everywhere / Sweden / International.
- Latest headlines grouped by source, a source-health indicator, a "last updated"
  stamp and auto refresh. A source that is down is shown as unavailable; the rest
  of the page keeps working.
- Light and dark mode (follows the system, or toggle auto / light / dark).

## Run

Requires Node.js 18 or newer. No `npm install` is needed (no dependencies).

```sh
cp .env.example .env     # then put your YouTube Data API key in .env
npm start                # open http://localhost:3000
npm test                 # parser and trend-scoring tests
```

Without `YOUTUBE_API_KEY` everything except YouTube still works; YouTube is then
listed as unavailable.

## Data sources

### News feeds

News is read from each publication's public RSS/Atom feed (never by scraping
HTML), plus the official Hacker News API. Only the headline, link, source,
publish time and a short excerpt (max ~200 characters) are kept, and every item
links to the original article; full texts are never republished.

| Source | Category | Region | Feed |
| --- | --- | --- | --- |
| Yahoo News | News | International | `https://news.yahoo.com/rss/` (top stories) |
| BBC News | News | International | `https://feeds.bbci.co.uk/news/rss.xml` |
| The Guardian | News | International | `https://www.theguardian.com/international/rss` |
| New York Times | News | International | `https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml` |
| Al Jazeera | News | International | `https://www.aljazeera.com/xml/rss/all.xml` |
| Dagens Nyheter | News | Sweden | `https://www.dn.se/rss/` |
| Svenska Dagbladet | News | Sweden | `https://www.svd.se/feed/articles.rss` |
| Aftonbladet | News | Sweden | `https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/` |
| Expressen | News | Sweden | `https://feeds.expressen.se/nyheter/` |
| SVT Nyheter | News | Sweden | `https://www.svt.se/nyheter/rss.xml` |
| Hacker News | Tech & design | International | Official API, `https://hacker-news.firebaseio.com/v0/topstories.json` (top 30) |
| The Verge | Tech & design | International | `https://www.theverge.com/rss/index.xml` (Atom) |
| Smashing Magazine | Tech & design | International | `https://www.smashingmagazine.com/feed/` |

All of these were verified by fetching them on 2026-10-14. Notes from that check:

- Yahoo News has no working world-news feed: `https://news.yahoo.com/rss/world`
  returns 404 and `https://www.yahoo.com/news/rss` returns 403, so only the top
  stories feed is used.
- SvD and Aftonbladet both publish TT wire stories, so identical headlines can
  appear in both. They still count as separate sources.
- Smashing Magazine publishes a few articles a week, so it rarely contributes to
  the 48-hour topic window, but its articles show up under headlines.

No requested source was skipped: every one had a working feed.

### YouTube and Google

- **YouTube**: YouTube Data API v3, `videos.list` with `chart=mostPopular` per
  region (25 videos). The key stays on the server; the browser only talks to
  `/api/youtube`. Each region costs 1 quota unit per refresh; the Europe view
  costs 11, and topic detection uses SE, US and GB.
- **Google**: Google Trends has no official API, so the server reads the public
  "Trending now" RSS feed (`https://trends.google.com/trending/rss?geo=SE`),
  which lists current trending searches with approximate search volume and
  related news links.

The Europe view merges SE, GB, DE, FR, ES, IT, NL, NO, DK, FI and PL. Videos
trending in more countries rank higher; searches rank by approximate volume.
Edit `REGIONS` and `EUROPE` in `server.js` to change the list.

All upstream responses are cached on the server for 10 minutes.

## Adding a news source

Add an entry to `SOURCES` in [`sources.js`](sources.js):

```js
{ id: 'reuters', name: 'Reuters', category: 'news', region: 'INT', short: 'R', color: '#ff8000',
  feedUrl: 'https://example.com/reuters/rss.xml' },
```

- `id`: unique key; `name`: display name
- `category`: `news` or `tech` (the Tech & design tab)
- `region`: `SE` or `INT`
- `feedUrl`: any RSS 2.0 or Atom feed
- `short` and `color` (optional `ink` for the text color): the source badge

Fetch the feed once to check that it works (for example
`node -e "require('./feeds').fetchSource(require('./sources').SOURCES.at(-1)).then(console.log)"`)
and run `npm test`, which checks that the source list is well formed. Nothing
else needs to change: the source appears in the headlines, the health indicator
and the topic detection.

## How topics are detected

[`trends.js`](trends.js) is pure functions with unit tests in `test/trends.test.js`.

1. Every headline from the last 48 hours, every Google trending search and every
   trending YouTube title becomes a "doc".
2. Each title is split into words and 2–3 word phrases. Swedish and English
   stopwords and common headline filler words are removed. Capitalised words in
   the middle of a sentence and acronyms count as names ("Taylor Swift", "NATO");
   Title Case headlines carry no name signal. Swedish genitives ("Trumps") fold
   into the name.
3. A topic must appear in at least 2 different sources. Its score is the sum over
   distinct sources of the freshest mention's freshness (halves every 12 hours),
   × 1.75 if it spans two kinds of source (news, search, video) or × 2.5 for all
   three, × 1.15 for names (× 1.3 more for multi-word names) and × 0.7 for
   ordinary words.
4. A name phrase replaces its parts ("Erling Haaland" absorbs "Haaland"), and
   topics that are the same set of articles, or a variant of a higher-ranked
   topic ("Donald Trump" under "Trump"), are merged. The top 30 are returned.

## Endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /api/trends?region=all\|se\|int&category=all\|news\|tech` | `{ updatedAt, docCount, topics: [{ id, label, score, sourceCount, articleCount, kinds, latestAt, sources: [{ id, name, kind, count }], items: [{ title, url, source, sourceName, kind, publishedAt, region }] }], sources: [status] }`. With `category=news` or `tech`, a topic must include at least one article from those sources. |
| `GET /api/news?region=all\|se\|int&category=all\|news\|tech` | `{ updatedAt, sources: [{ id, name, category, region, ok, error?, fetchedAt, items: [{ title, url, source, publishedAt, excerpt }] }] }` |
| `GET /api/sources` | Source list (id, name, category, region, badge, feed URL) |
| `GET /api/youtube?region=SE\|US\|EU\|…` | `{ region, updatedAt, items }` trending videos |
| `GET /api/google?region=SE\|US\|EU\|…` | `{ region, updatedAt, items }` trending searches |
| `GET /api/regions` | Country codes and names for the YouTube and Search tabs |

`updatedAt` is the fetch time of the oldest data in the response. Each entry in a
`sources` status list has `ok: false` and an `error` when that source could not be
fetched; the other sources are still returned.

## Snapshot artifact

`node scripts/build-artifact.js` fetches everything once and writes a
self-contained page, `artifact/youtube-trends.html` (from
`artifact/template.html`), for publishing as a claude.ai artifact. It holds the
top topics for Everywhere / Sweden / International and, when `YOUTUBE_API_KEY` is
set, the YouTube charts for all regions. Without a key it builds a topics-only
snapshot.
