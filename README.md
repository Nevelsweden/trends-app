# Trends Overview

A small web dashboard showing trending YouTube videos and trending Google searches
side by side for Sweden, the United States, individual European countries, and a
combined Europe view.

## Run

Requires Node.js 18 or newer. No `npm install` is needed (no dependencies).

```sh
cp .env.example .env     # then put your YouTube Data API key in .env
npm start                # open http://localhost:3000
npm test                 # parser test
```

## Data sources

- **YouTube**: YouTube Data API v3, `videos.list` with `chart=mostPopular` per
  region (25 videos). The key stays on the server; the browser only talks to
  `/api/youtube`. Each region costs 1 quota unit per refresh; the Europe view
  costs 11. Responses are cached for 10 minutes.
- **Google**: Google Trends has no official API, so the server reads the public
  "Trending now" RSS feed (`https://trends.google.com/trending/rss?geo=SE`),
  which lists current trending searches with approximate search volume and
  related news links.

The Europe view merges SE, GB, DE, FR, ES, IT, NL, NO, DK, FI and PL. Videos
trending in more countries rank higher; searches rank by approximate volume.
Edit `REGIONS` and `EUROPE` in `server.js` to change the list.
