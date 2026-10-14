const test = require('node:test');
const assert = require('node:assert');
const { parseFeed, decodeEntities, excerpt, EXCERPT_MAX } = require('../feeds');
const { SOURCES, selectSources } = require('../sources');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Feed title is ignored</title>
  <atom:link href="https://example.com/feed" rel="self"/>
  <item>
    <title><![CDATA[Taylor Swift &amp; friends <em>sell out</em> Stockholm]]></title>
    <link>https://example.com/a?utm_medium=rss</link>
    <description><![CDATA[<figure><img src="x.jpg"></figure><p>Fans queued for <b>hours</b>&nbsp;outside Friends Arena.</p>]]></description>
    <pubDate>Wed, 14 Oct 2026 22:19:26 +0200</pubDate>
    <media:title>Not the headline</media:title>
  </item>
  <item>
    <title>NYT &gt; Kriget i Ukraina: Malm&amp;ouml; &#8211; &#x201C;svar&#x201D;</title>
    <guid isPermaLink="true">https://example.com/b</guid>
    <description>&lt;p&gt;Escaped &lt;a href="#"&gt;HTML&lt;/a&gt; text&lt;/p&gt;</description>
  </item>
  <item><title>No link at all</title></item>
  <item><title>Bad date</title><link>https://example.com/c</link><pubDate>someday</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">The Feed</title>
  <link rel="self" href="https://example.com/atom"/>
  <entry>
    <title type="html"><![CDATA[McKinsey &#38; Co tests an AI client]]></title>
    <link rel="replies" href="https://example.com/x#comments"/>
    <link rel="alternate" type="text/html" href="https://example.com/x"/>
    <id>https://example.com/?p=1</id>
    <updated>2026-10-14T18:53:31-04:00</updated>
    <published>2026-10-14T18:50:00-04:00</published>
    <summary type="html">Short &lt;b&gt;summary&lt;/b&gt;.</summary>
    <content type="html"><![CDATA[<p>Full text that must not be used when a summary exists.</p>]]></content>
  </entry>
  <entry>
    <title>Second</title>
    <link href='https://example.com/y'/>
    <updated>2026-10-13T10:00:00Z</updated>
    <content type="html"><![CDATA[<p>${'word '.repeat(80)}</p>]]></content>
  </entry>
</feed>`;

test('parses RSS 2.0 items', () => {
  const items = parseFeed(RSS, 'demo');
  assert.strictEqual(items.length, 3, 'item without a link is skipped');
  const [a, b, c] = items;
  assert.strictEqual(a.title, 'Taylor Swift & friends sell out Stockholm');
  assert.strictEqual(a.url, 'https://example.com/a?utm_medium=rss');
  assert.strictEqual(a.source, 'demo');
  assert.strictEqual(a.publishedAt, '2026-10-14T20:19:26.000Z');
  assert.strictEqual(a.excerpt, 'Fans queued for hours outside Friends Arena.');
  assert.strictEqual(b.title, 'NYT > Kriget i Ukraina: Malmö – “svar”');
  assert.strictEqual(b.url, 'https://example.com/b', 'falls back to a permalink guid');
  assert.strictEqual(b.excerpt, 'Escaped HTML text');
  assert.strictEqual(b.publishedAt, null);
  assert.strictEqual(c.publishedAt, null, 'unparseable dates become null');
});

test('parses Atom entries', () => {
  const [x, y] = parseFeed(ATOM, 'atom');
  assert.strictEqual(x.title, 'McKinsey & Co tests an AI client');
  assert.strictEqual(x.url, 'https://example.com/x', 'uses rel=alternate, not replies');
  assert.strictEqual(x.publishedAt, '2026-10-14T22:50:00.000Z', 'prefers published over updated');
  assert.strictEqual(x.excerpt, 'Short summary.');
  assert.strictEqual(y.url, 'https://example.com/y');
  assert.ok(y.excerpt.length <= EXCERPT_MAX + 1, 'long content is cut to an excerpt');
  assert.ok(y.excerpt.endsWith('…'));
});

test('excerpt cuts at a word boundary', () => {
  assert.strictEqual(excerpt('short'), 'short');
  assert.strictEqual(excerpt('alpha beta gamma delta', 12), 'alpha beta…');
});

test('decodes named and numeric entities', () => {
  assert.strictEqual(decodeEntities('&aring;&auml;&ouml; &#246; &#xF6; &unknown;'), 'åäö ö ö &unknown;');
});

test('source list is well formed', () => {
  const ids = new Set();
  for (const s of SOURCES) {
    assert.ok(s.id && s.name && s.short && s.color, s.id);
    assert.ok(['news', 'tech'].includes(s.category), s.id);
    assert.ok(['SE', 'INT'].includes(s.region), s.id);
    assert.match(s.feedUrl, /^https:\/\//, s.id);
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
  }
  assert.ok(selectSources({ region: 'se' }).every((s) => s.region === 'SE'));
  assert.ok(selectSources({ category: 'tech' }).every((s) => s.category === 'tech'));
  assert.strictEqual(selectSources().length, SOURCES.length);
});
