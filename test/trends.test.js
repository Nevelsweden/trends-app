const test = require('node:test');
const assert = require('node:assert');
const { termsOf, tokenize, freshness, buildDocs, scoreTopics, HALF_LIFE_H } = require('../trends');

const NOW = Date.parse('2026-10-14T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 36e5).toISOString();
const doc = (source, title, h = 1, kind = 'news') =>
  ({ title, url: `https://example.com/${source}/${encodeURIComponent(title)}`, source, sourceName: source, kind, publishedAt: hoursAgo(h) });
const labels = (topics) => topics.map((t) => t.label);

test('termsOf drops stopwords and builds phrases', () => {
  const terms = termsOf('Taylor Swift announces new album with the Eras crew');
  assert.ok(terms.has('taylor swift'));
  assert.ok(terms.has('taylor') && terms.has('swift'));
  assert.ok(!terms.has('the') && !terms.has('with') && !terms.has('new'));
  assert.ok(!terms.has('swift announces'), 'filler words break phrases');
  assert.ok(termsOf('Regeringen och SVT: nu höjs skatten').has('SVT'), 'acronyms keep their case');
  assert.ok(!termsOf('Regeringen och oppositionen är inte överens').has('och'), 'Swedish stopwords');
});

test('punctuation breaks phrases and possessives are removed', () => {
  const terms = termsOf("Musk's Starlink: Ukraine says access improved");
  assert.ok(terms.has('musk') && terms.has('starlink'));
  assert.ok(!terms.has('starlink ukraine'));
});

test('names are capitalised words that are not first in a headline', () => {
  const [seg] = tokenize('Fans cheer as Taylor Swift lands');
  const by = Object.fromEntries(seg.map((t) => [t.key, t.name]));
  assert.strictEqual(by.fans, false);
  assert.strictEqual(by.taylor, true);
  assert.strictEqual(by.cheer, false);
  const [tc] = tokenize('How To Build Better Design Systems');
  assert.ok(tc.every((t) => !t.name), 'Title Case headlines carry no name signal');
});

test('freshness halves every half-life and treats undated docs as middling', () => {
  assert.strictEqual(freshness({ publishedAt: hoursAgo(0) }, NOW), 1);
  assert.ok(Math.abs(freshness({ publishedAt: hoursAgo(HALF_LIFE_H) }, NOW) - 0.5) < 1e-9);
  assert.strictEqual(freshness({ publishedAt: null }, NOW), 0.5);
  assert.strictEqual(freshness({ publishedAt: hoursAgo(-2) }, NOW), 1, 'future dates are clamped');
});

test('a topic needs at least two distinct sources', () => {
  const topics = scoreTopics([
    doc('bbc', 'Greta Thunberg sails again'),
    doc('bbc', 'Greta Thunberg speaks in port'),
  ], { now: NOW });
  assert.deepStrictEqual(topics, []);
});

test('more distinct sources beat more articles from one source', () => {
  const docs = [
    doc('bbc', 'Storm Amy hits Scotland'), doc('dn', 'Ovädret Amy drar in över Skottland'), doc('svt', 'Stormen Amy: tusentals utan ström'),
    doc('nyt', 'Inflation report worries Fed'), doc('nyt', 'Inflation keeps rising'), doc('nyt', 'Inflation and you'), doc('yahoo', 'Inflation hits groceries'),
  ];
  const topics = scoreTopics(docs, { now: NOW });
  assert.deepStrictEqual(labels(topics), ['Amy', 'Inflation']);
  assert.strictEqual(topics[0].sourceCount, 3);
  assert.strictEqual(topics[1].sourceCount, 2);
  assert.strictEqual(topics[1].articleCount, 4);
});

test('fresher coverage ranks above stale coverage', () => {
  const docs = [
    doc('bbc', 'Talks with Macron collapse', 40), doc('nyt', 'Paris says Macron will stay', 36),
    doc('bbc', 'Kim Jong Un visits Moscow', 1), doc('nyt', 'Putin welcomes Kim Jong Un', 2),
  ];
  assert.deepStrictEqual(labels(scoreTopics(docs, { now: NOW })), ['Kim Jong Un', 'Macron']);
});

test('topics seen in news, search and video outrank news-only topics', () => {
  const docs = [
    doc('bbc', 'Arsenal sign new striker'), doc('nyt', 'Why Arsenal paid so much'), doc('guardian', 'Arsenal fans react'),
    doc('dn', 'Kritik mot Melodifestivalen växer'), doc('google', 'melodifestivalen', 0, 'search'), doc('youtube', 'Melodifestivalen 2027 – alla bidrag', 0, 'video'),
  ];
  const topics = scoreTopics(docs, { now: NOW });
  assert.deepStrictEqual(labels(topics), ['Melodifestivalen', 'Arsenal']);
  assert.deepStrictEqual(topics[0].kinds.sort(), ['news', 'search', 'video']);
});

test('a name phrase absorbs its parts and keeps the cased label', () => {
  const docs = [
    doc('google', 'erling haaland', 0, 'search'),
    doc('bbc', 'Goals from Erling Haaland sink PSG'),
    doc('aftonbladet', 'Succé för Erling Haaland igen'),
  ];
  const [top, ...rest] = scoreTopics(docs, { now: NOW });
  assert.strictEqual(top.label, 'Erling Haaland');
  assert.ok(!labels(rest).includes('Haaland') && !labels(rest).includes('Erling'));
  assert.strictEqual(top.sources.length, 3);
});

test('identical wire headlines collapse to one short topic', () => {
  const docs = [doc('svd', 'Rumänien utreder möjlig drönarattack'), doc('aftonbladet', 'Rumänien utreder möjlig drönarattack')];
  const topics = scoreTopics(docs, { now: NOW });
  assert.strictEqual(topics.length, 1, 'overlapping terms are merged');
});

test('Swedish genitive folds into the name', () => {
  const docs = [doc('dn', 'Kritik mot Trumps tullar'), doc('bbc', 'Tariffs from Trump bite'), doc('svt', 'Nytt besked från Trump')];
  const [top] = scoreTopics(docs, { now: NOW });
  assert.strictEqual(top.label, 'Trump');
  assert.strictEqual(top.sourceCount, 3);
});

test('variants of a bigger topic are folded in, unrelated narrower topics are kept', () => {
  const docs = [
    doc('bbc', 'Tariffs from Trump bite'), doc('nyt', 'Senate defies Trump'), doc('dn', 'Kritik mot Trump'),
    doc('svt', 'Nytt besked från Trump'), doc('yahoo', 'Polls: Trump slips'),
    doc('guardian', 'Allies split over Donald Trump plan for Greenland'), doc('aljazeera', 'Denmark rejects Donald Trump on Greenland'),
  ];
  const got = labels(scoreTopics(docs, { now: NOW }));
  assert.strictEqual(got[0], 'Trump');
  assert.ok(!got.includes('Donald Trump'), got.join());
  assert.ok(got.includes('Greenland'), got.join());
});

test('requireKind keeps only topics with that kind of doc', () => {
  const docs = [doc('google', 'champions league', 0, 'search'), doc('youtube', 'Champions League highlights', 0, 'video')];
  assert.strictEqual(scoreTopics(docs, { now: NOW }).length, 1);
  assert.strictEqual(scoreTopics(docs, { now: NOW, requireKind: 'news' }).length, 0);
});

test('limit caps the number of topics', () => {
  const docs = [];
  for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
    docs.push(doc('bbc', `Report on ${name} Corp`), doc('nyt', `Inside ${name} Corp`));
  }
  assert.strictEqual(scoreTopics(docs, { now: NOW, limit: 2 }).length, 2);
});

test('buildDocs merges sources, drops old and duplicate items', () => {
  const docs = buildDocs({
    news: [{ id: 'bbc', name: 'BBC', category: 'news', region: 'INT', items: [
      { title: 'Fresh', url: 'https://x/1', publishedAt: hoursAgo(1) },
      { title: 'Fresh', url: 'https://x/1b', publishedAt: hoursAgo(1) },
      { title: 'Stale', url: 'https://x/2', publishedAt: hoursAgo(100) },
    ] }],
    google: [{ region: 'SE', fetchedAt: hoursAgo(0), items: [{ query: 'melodifestivalen', traffic: '5000+' }] }],
    youtube: [{ region: 'SE', items: [{ id: 'abc', title: 'A video', channel: 'Chan' }] }],
  }, NOW);
  assert.deepStrictEqual(docs.map((d) => [d.title, d.kind]), [['Fresh', 'news'], ['melodifestivalen', 'search'], ['A video', 'video']]);
  assert.strictEqual(docs[1].url, 'https://www.google.com/search?q=melodifestivalen');
  assert.strictEqual(docs[2].url, 'https://www.youtube.com/watch?v=abc');
});
