// Run with: node --test
const test = require('node:test');
const assert = require('node:assert');
const { parseTrendsRss } = require('../server');

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
<item>
  <title>allsvenskan</title>
  <ht:approx_traffic>20000+</ht:approx_traffic>
  <pubDate>Mon, 6 Oct 2026 18:40:00 -0700</pubDate>
  <ht:picture>https://example.com/p.jpg</ht:picture>
  <ht:news_item>
    <ht:news_item_title>Malm&amp;ouml; &amp; AIK drama</ht:news_item_title>
    <ht:news_item_url>https://example.com/a</ht:news_item_url>
    <ht:news_item_source>Aftonbladet</ht:news_item_source>
  </ht:news_item>
</item>
<item><title>väder</title><ht:approx_traffic>500+</ht:approx_traffic></item>
</channel></rss>`;

test('parses Google Trends RSS items', () => {
  const items = parseTrendsRss(SAMPLE, 'SE');
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].query, 'allsvenskan');
  assert.strictEqual(items[0].trafficValue, 20000);
  assert.strictEqual(items[0].news[0].source, 'Aftonbladet');
  assert.strictEqual(items[1].query, 'väder');
  assert.deepStrictEqual(items[1].news, []);
});
