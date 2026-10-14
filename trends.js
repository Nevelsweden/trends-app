// Trend detection: finds keywords and names that show up in several sources at
// once. Pure functions only (no network) so the scoring is easy to test.
//
// Pipeline:
//   1. buildDocs()    turn news items, Google searches and YouTube titles into
//                     uniform "docs" { title, url, source, kind, publishedAt }
//   2. termsOf()      pull candidate terms out of a title: single words that are
//                     not stopwords, plus 2-3 word phrases ("Taylor Swift")
//   3. scoreTopics()  per term: sum over distinct sources of the freshest doc's
//                     freshness, boosted when the term spans several kinds
//                     (news + search + video) and for names; then merge
//                     overlapping terms and return the top N
const HALF_LIFE_H = 12;       // freshness halves every 12 hours
const WINDOW_H = 48;          // docs older than this are ignored
const KIND_BONUS = 0.75;      // x1.75 for two kinds, x2.5 for news + search + video
const NAME_BONUS = 1.15;      // every word capitalised mid-headline, or an acronym
const PHRASE_BONUS = 1.3;     // multi-word names ("Real Madrid") are the most specific topics
const PLAIN_PENALTY = 0.7;    // ordinary words ("prices") need more sources to rank
const ABSORB = 0.6;           // a phrase replaces a shorter term if it covers >=60% of its docs
const OVERLAP = 0.6;          // skip a topic whose docs mostly match (Jaccard) a higher-ranked one
const MIN_SOURCES = 2;

const EN = `a about above after again against ago all almost also am among an and another any are around as at
away back be became because been before being below between both but by can cannot could did do does doing done
down during each either else even ever every few for from further get gets getting got had has have having he her
here hers herself him himself his how however i if in into is it its itself just last least less let like made
make makes many may me might more most much must my myself near need never new next no nor not now of off often
on once one only or other others our ours out over own per put rather really said same say says saying see seen
she should since so some still such take than that the their theirs them themselves then there these they this
those though through thus to too toward under until up upon us very via was way we well were what when where
whether which while who whom whose why will with within without would yet you your yours yourself
dont doesnt didnt cant wont isnt arent wasnt werent im ive youre theyre thats whats heres theres lets`;

const SV = `alla allt alltid andra annan annat att av bara bland blev bli blir blivit bra då där de dem den denna
deras dess dessa det detta dig din dina ditt du efter eller en ens er era ert ett få får för före från fått ha
hade han hans har hela helt henne hennes hit hon honom hur här i ifrån igen in inför inga ingen inget inte
innan jag kan kom komma kommer kunde kunna man med mellan men mer mig min mina mitt mot mycket många ned ni nu
när någon något några och också om oss på samma sedan sig sin sina sitt själv ska skall skulle som så sådan
till tills under upp ut utan vad var vara varför varit varje vars vem vi vid vilka vilken vilket vår våra vårt
än är ännu åt över ens nya nytt ny gör göra gjorde säger sade sa ser se tar tog går gick fick menar vill ville
kanske dock tre två fyra fem sex sju åtta nio tio`;

// Words that are common in headlines but never a topic on their own.
const FILLER = `news live update updates latest breaking video videos watch photo photos pictures opinion analysis
review reviews today tonight yesterday tomorrow week weeks weekend month months year years day days time times
first second third two three four five six seven eight nine ten hundreds thousands million millions billion
report reports reported according amid over after says said told tells claims call calls calling plan plans
people man woman men women world country government official officials leader leaders state states group
monday tuesday wednesday thursday friday saturday sunday january february march april june july august
september october november december best top big small good bad high low old long short open full part
right left help know think want look looks show shows find found keep start starts end ends set back home
podcast newsletter episode official music trailer shorts feat lyrics highlights vlog reaction ep
warns warn urges faces face hits hit wins win loses gets takes gives goes continues continue returns reveals
announces launches slams vows sues inside behind amid among move moves deal deals fight cuts rise falls lead
poängställning resultat score scores mot
nyheter senaste direkt just idag igår imorgon dag dagar vecka veckan år året månad timmar minuter
måndag tisdag onsdag torsdag fredag lördag söndag januari februari mars maj juni juli augusti
oktober november december del stor stort stora liten små ny första andra tredje sverige svensk svenska svenskt
krönika debatt ledare insändare kolumn quiz läsarfrågor tv tittare bild bilder sport
därför trodde tror testat testar utreder utreds enligt kräver varnar hotar döms dömd dömde misstänkt misstänks
avslöjar slutar kväll kvällen morgon natt natten gång gången fall läget allt mest bästa sämsta vann förlorade
bort larm larmar efter beskedet besked nytt klart stoppas stoppar öppnar stänger börjar höjer sänker ökar minskar`;

// All-caps tokens that are shouting rather than acronyms.
// US/UK are in so many headlines that they drown out real topics.
const CAPS_STOP = new Set(['US', 'UK', 'JUST', 'NU', 'LIVE', 'VIDEO', 'TV', 'OK', 'THE', 'NEW', 'FULL', 'HD', 'MV', 'VS', 'FT', 'PM', 'AM', 'I', 'II']);

const STOP = new Set(`${EN} ${SV} ${FILLER}`.split(/\s+/).filter(Boolean));

// Split a headline into segments (punctuation breaks phrases), then tokens.
function tokenize(title) {
  const text = title
    .replace(/\b((?:\p{Lu}\.){2,})/gu, (m) => m.replace(/\./g, ''))   // U.S. -> US
    .replace(/['’]s\b/gi, '')                                            // possessive 's
    .replace(/['’]/g, '');
  const letters = text.replace(/[^\p{L}]/gu, '');
  const shouting = letters.length > 8 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.7;
  // In Title Case Headlines capitals say nothing about names.
  const words = text.match(/[\p{L}]{4,}/gu) || [];
  const titleCase = words.length >= 3 && words.filter((w) => /^\p{Lu}/u.test(w)).length / words.length > 0.7;
  const segments = text.split(/[:;,.!?|()[\]{}"“”«»–—/#@]+|\s-\s/);
  let first = true;
  return segments.map((seg) => {
    const out = [];
    for (const raw of seg.match(/[\p{L}\p{N}]+/gu) || []) {
      const acronym = !shouting && /^\p{Lu}[\p{Lu}\d]{1,4}$/u.test(raw) && !CAPS_STOP.has(raw);
      const lower = raw.toLocaleLowerCase('sv');
      out.push({
        raw: shouting ? lower : raw,
        key: acronym ? raw : lower,
        acronym,
        // Capitalised mid-sentence suggests a name; the first word of a headline proves nothing.
        name: acronym || (!shouting && !titleCase && !first && /^\p{Lu}\p{Ll}/u.test(raw)),
      });
      first = false;
    }
    return out;
  });
}

function usable(t) {
  if (t.acronym) return true;
  // Two-letter words only as part of a name ("Kim Jong Un", "Xi").
  return t.key.length >= (t.name ? 2 : 3) && !STOP.has(t.key) && !/^\d+$/.test(t.key);
}

// Map of term key -> { surface, n, name } for one title (each term once).
function termsOf(title) {
  const found = new Map();
  for (const seg of tokenize(title)) {
    for (let i = 0; i < seg.length; i++) {
      for (let n = 1; n <= 3 && i + n <= seg.length; n++) {
        const run = seg.slice(i, i + n);
        if (!run.every(usable)) break;
        // Phrases must contain a non-number word.
        if (n > 1 && run.every((t) => /^\d+$/.test(t.key))) continue;
        const key = run.map((t) => t.key).join(' ');
        if (!found.has(key)) {
          found.set(key, { surface: run.map((t) => t.raw).join(' '), n, name: run.every((t) => t.name) });
        }
      }
    }
  }
  return found;
}

function freshness(doc, now) {
  if (!doc.publishedAt) return 0.5;
  const age = Math.max(0, (now - Date.parse(doc.publishedAt)) / 36e5);
  return 0.5 ** (age / HALF_LIFE_H);
}

// news: [{ id, name, category, region, items: [{ title, url, publishedAt }] }]
// google: [{ region, fetchedAt, items: [{ query }] }]
// youtube: [{ region, fetchedAt, items: [{ id, title, channel }] }]
// Searches and videos are "trending now", so they are dated at fetch time.
function buildDocs({ news = [], google = [], youtube = [] }, now = Date.now()) {
  const docs = [];
  const seen = new Set();
  const add = (d) => {
    const k = `${d.source}|${d.title.toLowerCase()}`;
    if (seen.has(k)) return;
    if (d.publishedAt && now - Date.parse(d.publishedAt) > WINDOW_H * 36e5) return;
    seen.add(k);
    docs.push(d);
  };
  for (const s of news) {
    for (const it of s.items || []) {
      add({ title: it.title, url: it.url, source: s.id, sourceName: s.name, kind: 'news',
        category: s.category, region: s.region, publishedAt: it.publishedAt || null });
    }
  }
  for (const g of google) {
    const at = g.fetchedAt || new Date(now).toISOString();
    for (const it of g.items || []) {
      add({ title: it.query, url: `https://www.google.com/search?q=${encodeURIComponent(it.query)}`,
        source: 'google', sourceName: 'Google Trends', kind: 'search', region: g.region,
        traffic: it.traffic, publishedAt: at });
    }
  }
  for (const y of youtube) {
    const at = y.fetchedAt || new Date(now).toISOString();
    for (const it of y.items || []) {
      add({ title: it.title, url: `https://www.youtube.com/watch?v=${encodeURIComponent(it.id)}`,
        source: 'youtube', sourceName: 'YouTube', kind: 'video', region: y.region,
        channel: it.channel, publishedAt: at });
    }
  }
  return docs;
}

function pickLabel(forms) {
  const sorted = [...forms.entries()].sort((a, b) => b[1] - a[1]);
  const cased = sorted.find(([f]) => f !== f.toLocaleLowerCase('sv'));
  const label = (cased || sorted[0])[0];
  return label[0].toLocaleUpperCase('sv') + label.slice(1);
}

function scoreTerm(term, docs, now) {
  const bySource = new Map();
  const kinds = new Set();
  for (const i of term.docs) {
    const d = docs[i];
    kinds.add(d.kind);
    bySource.set(d.source, Math.max(bySource.get(d.source) || 0, freshness(d, now)));
  }
  let base = 0;
  for (const f of bySource.values()) base += f;
  const shape = term.nameHits > 0 ? NAME_BONUS * (term.n > 1 ? PHRASE_BONUS : 1) : PLAIN_PENALTY;
  return base * (1 + KIND_BONUS * (kinds.size - 1)) * shape;
}

const subKeys = (key) => {
  const w = key.split(' ');
  const out = [];
  for (let n = 1; n < w.length; n++) for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' '));
  return out;
};

function scoreTopics(docs, { now = Date.now(), limit = 30, minSources = MIN_SOURCES, requireKind, itemsPerTopic = 15 } = {}) {
  // 1. Collect terms.
  const terms = new Map();
  docs.forEach((d, i) => {
    for (const [key, t] of termsOf(d.title)) {
      let e = terms.get(key);
      if (!e) terms.set(key, e = { key, n: t.n, docs: new Set(), forms: new Map(), nameHits: 0 });
      e.docs.add(i);
      e.forms.set(t.surface, (e.forms.get(t.surface) || 0) + 1);
      if (t.name) e.nameHits++;
    }
  });

  // 2. Swedish genitive: fold "Trumps" into "Trump" when the base form is a name.
  for (const [key, e] of terms) {
    if (key.length < 5 || !key.endsWith('s')) continue;
    const base = terms.get(key.slice(0, -1));
    if (!base || !base.nameHits) continue;
    for (const i of e.docs) base.docs.add(i);
    terms.delete(key);
  }

  // 3. Score; keep terms seen in enough distinct sources.
  let list = [];
  for (const e of terms.values()) {
    const sources = new Set([...e.docs].map((i) => docs[i].source));
    if (sources.size < minSources) continue;
    if (requireKind && ![...e.docs].some((i) => docs[i].kind === requireKind)) continue;
    e.sources = sources;
    e.score = scoreTerm(e, docs, now);
    list.push(e);
  }

  // 4. A name phrase that covers most of a shorter term's docs replaces it
  //    ("Erling Haaland" absorbs "Haaland"), taking the higher score. Plain
  //    phrases ("Romania investigates possible") never absorb anything.
  const byKey = new Map(list.map((e) => [e.key, e]));
  for (const p of [...list].sort((a, b) => b.n - a.n)) {
    if (p.n === 1 || p.absorbed || !p.nameHits) continue;
    for (const k of subKeys(p.key)) {
      const q = byKey.get(k);
      if (q && !q.absorbed && p.docs.size >= ABSORB * q.docs.size) {
        q.absorbed = true;
        p.score = Math.max(p.score, q.score);
      }
    }
  }
  // Ties (e.g. identical wire headlines) go to the term with more docs, then a
  // capitalised form, then the shorter term.
  const cased = (e) => [...e.forms.keys()].some((f) => f !== f.toLocaleLowerCase('sv'));
  list = list.filter((e) => !e.absorbed).sort((a, b) =>
    b.score - a.score || b.docs.size - a.docs.size || cased(b) - cased(a) || a.n - b.n);

  // 5. Skip topics that are essentially the same set of articles as a
  //    higher-ranked one. Jaccard rather than containment, so a broad topic
  //    ("Trump") does not hide a narrower one ("Greenland").
  const picked = [];
  for (const e of list) {
    const dup = picked.some((p) => {
      let shared = 0;
      for (const i of e.docs) if (p.docs.has(i)) shared++;
      return shared / (e.docs.size + p.docs.size - shared) >= OVERLAP;
    });
    if (!dup) picked.push(e);
    if (picked.length >= limit) break;
  }

  return picked.map((e) => {
    const items = [...e.docs].map((i) => docs[i])
      .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
    const sources = new Map();
    for (const d of items) {
      const s = sources.get(d.source) || { id: d.source, name: d.sourceName, kind: d.kind, count: 0 };
      s.count++;
      sources.set(d.source, s);
    }
    return {
      id: e.key,
      label: pickLabel(e.forms),
      score: Math.round(e.score * 100) / 100,
      sourceCount: sources.size,
      articleCount: items.length,
      kinds: [...new Set(items.map((d) => d.kind))],
      latestAt: items.find((d) => d.publishedAt)?.publishedAt || null,
      sources: [...sources.values()].sort((a, b) => b.count - a.count),
      items: items.slice(0, itemsPerTopic).map(({ title, url, source, sourceName, kind, publishedAt, region, channel, traffic }) =>
        ({ title, url, source, sourceName, kind, publishedAt, region, channel, traffic })),
    };
  });
}

module.exports = { tokenize, termsOf, freshness, buildDocs, scoreTopics, STOP, HALF_LIFE_H, WINDOW_H };
