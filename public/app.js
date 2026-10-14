const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const fmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const TABS = ['all', 'news', 'tech', 'youtube', 'google'];
const SCOPES = ['all', 'se', 'int'];
const TOPICS_COLLAPSED = 12;
const REFRESH_MS = 10 * 60 * 1000;
const CLIENT_CACHE_MS = 2 * 60 * 1000;

const state = {
  tab: TABS.includes(store.get('tab')) ? store.get('tab') : 'all',
  scope: SCOPES.includes(store.get('scope')) ? store.get('scope') : 'all',
  country: store.get('region') || 'SE',
  regions: {},
  sources: {
    google: { name: 'Google Trends', short: 'G', color: '#1a73e8' },
    youtube: { name: 'YouTube', short: '▶', color: '#e62117' },
  },
  topics: [],
  headlines: [],
  youtube: [],
  google: [],
  allTopics: false,
  updatedAt: null,
};

const ICONS = {
  news: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h9v10H3a1 1 0 0 1-1-1zm10 3h2v6a1 1 0 0 1-2 0zM4 5v2h5V5zm0 4v1h5V9zm0 2v1h5v-1z"/></svg>',
  search: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 2a5 5 0 0 1 4 8l3 3-1 1-3-3a5 5 0 1 1-3-9zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
  video: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3 2.5v5l4.5-2.5z"/></svg>',
};
const KIND_LABEL = { news: 'News', search: 'Search', video: 'Video' };

function ago(date) {
  const h = (Date.now() - new Date(date)) / 36e5;
  if (!date || isNaN(h)) return '';
  if (h < 1 / 60) return 'just now';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function badge(id, large = false) {
  const s = state.sources[id] || { short: (id || '?').slice(0, 2).toUpperCase(), color: '#6b7280' };
  return `<span class="badge${large ? ' lg' : ''}" style="background:${esc(s.color)}${s.ink ? `;color:${esc(s.ink)}` : ''}" title="${esc(s.name || id)}">${esc(s.short)}</span>`;
}
const kindChip = (k) => `<span class="kind ${k}">${ICONS[k]}${KIND_LABEL[k]}</span>`;

// Small client cache so switching tabs is instant; the server caches for 10 min.
const memo = new Map();
async function getJSON(url, force) {
  const hit = memo.get(url);
  if (!force && hit && Date.now() - hit.at < CLIENT_CACHE_MS) return hit.body;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  memo.set(url, { at: Date.now(), body });
  return body;
}

async function init() {
  // Source metadata and country list; the page still works if either fails.
  const [src, reg] = await Promise.allSettled([getJSON('/api/sources'), getJSON('/api/regions')]);
  if (src.status === 'fulfilled') for (const s of src.value.sources) state.sources[s.id] = s;
  state.regions = reg.status === 'fulfilled' ? reg.value.regions : { SE: 'Sweden', US: 'United States' };
  if (!state.regions[state.country]) state.country = 'SE';
  const order = ['SE', 'US', 'EU', ...Object.keys(state.regions).filter((k) => !['SE', 'US', 'EU'].includes(k))]
    .filter((k) => state.regions[k]);
  $('countries').innerHTML = order.map((k) => `<button data-country="${k}">${esc(state.regions[k])}</button>`).join('');

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]')?.dataset.tab;
    if (t && t !== state.tab) { state.tab = t; store.set('tab', t); load(); }
  });
  $('scope').addEventListener('click', (e) => {
    const s = e.target.closest('[data-scope]')?.dataset.scope;
    if (s && s !== state.scope) { state.scope = s; store.set('scope', s); load(); }
  });
  $('countries').addEventListener('click', (e) => {
    const c = e.target.closest('[data-country]')?.dataset.country;
    if (c && c !== state.country) { state.country = c; store.set('region', c); load(); }
  });
  $('topics').addEventListener('click', (e) => {
    const b = e.target.closest('[data-topic]');
    if (b) openTopic(state.topics[Number(b.dataset.topic)]);
  });
  $('more-topics').onclick = () => { state.allTopics = !state.allTopics; renderTopics(); };
  $('refresh').onclick = () => load(true);
  $('theme').onclick = cycleTheme;
  $('headline-filter').oninput = renderHeadlines;
  $('yt-filter').oninput = renderYoutube;
  $('gt-filter').oninput = renderGoogle;
  const dlg = $('topic-dialog');
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });

  showTheme();
  setInterval(() => load(true, true), REFRESH_MS);
  setInterval(renderStamp, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.updatedAt && Date.now() - new Date(state.updatedAt) > REFRESH_MS) load(true, true);
  });
  load();
}

// --- Loading -----------------------------------------------------------------

let loadSeq = 0;
async function load(force = false, quiet = false) {
  const seq = ++loadSeq;
  const tab = state.tab;
  const charts = tab === 'youtube' || tab === 'google';
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.setAttribute('aria-selected', b.dataset.tab === tab);
  for (const b of document.querySelectorAll('#scope [data-scope]')) b.setAttribute('aria-checked', b.dataset.scope === state.scope);
  for (const b of document.querySelectorAll('#countries [data-country]')) b.setAttribute('aria-pressed', b.dataset.country === state.country);
  $('scope').hidden = charts;
  $('countries').hidden = !charts;
  $('topics-view').hidden = $('headlines-view').hidden = charts;
  $('youtube-view').hidden = tab !== 'youtube';
  $('google-view').hidden = tab !== 'google';
  $('refresh').classList.add('spin');

  try {
    if (charts) {
      if (!quiet) $(tab).innerHTML = '<li class="state">Loading…</li>';
      $('health').hidden = true;
      try {
        const body = await getJSON(`/api/${tab}?region=${state.country}`, force);
        if (seq !== loadSeq) return;
        state[tab] = body.items;
        state.updatedAt = body.updatedAt;
        (tab === 'youtube' ? renderYoutube : renderGoogle)();
      } catch (err) {
        if (seq !== loadSeq) return;
        $(tab).innerHTML = `<li class="state error">Could not load: ${esc(err.message)}</li>`;
      }
    } else {
      const q = `region=${state.scope}&category=${tab}`;
      if (!quiet) {
        $('topics').innerHTML = '<li class="skeleton"></li>'.repeat(8);
        $('headlines').innerHTML = '<div class="state">Loading headlines…</div>';
      }
      const [trends, news] = await Promise.allSettled([getJSON(`/api/trends?${q}`, force), getJSON(`/api/news?${q}`, force)]);
      if (seq !== loadSeq) return;
      if (trends.status === 'fulfilled') {
        state.topics = trends.value.topics;
        renderTopics(trends.value);
        renderHealth(trends.value.sources);
      } else {
        state.topics = [];
        $('topics').innerHTML = `<li class="empty error">Could not compute trending topics: ${esc(trends.reason.message)}</li>`;
        $('more-topics').hidden = true;
      }
      if (news.status === 'fulfilled') {
        state.headlines = news.value.sources;
        renderHeadlines();
        if (trends.status === 'rejected') renderHealth(news.value.sources.map((s) => ({ ...s, count: s.items.length })));
      } else {
        $('headlines').innerHTML = `<div class="empty error">Could not load headlines: ${esc(news.reason.message)}</div>`;
      }
      const stamps = [trends, news].filter((r) => r.status === 'fulfilled').map((r) => r.value.updatedAt).sort();
      state.updatedAt = stamps[0] || null;
    }
  } finally {
    if (seq === loadSeq) { $('refresh').classList.remove('spin'); renderStamp(); }
  }
}

function renderStamp() {
  const d = state.updatedAt && new Date(state.updatedAt);
  $('updated').textContent = d && !isNaN(d)
    ? `Updated ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${ago(d)})` : '';
}

function renderHealth(sources) {
  const up = sources.filter((s) => s.ok);
  const el = $('health');
  el.hidden = false;
  el.classList.toggle('degraded', up.length < sources.length);
  el.querySelector('summary').textContent = up.length === sources.length
    ? `All ${sources.length} sources live` : `${up.length} of ${sources.length} sources live`;
  el.querySelector('ul').innerHTML = sources.map((s) => `<li>
    <span class="${s.ok ? 'ok' : 'bad'}" aria-label="${s.ok ? 'OK' : 'Unavailable'}">${s.ok ? '●' : '○'}</span>
    ${badge(s.id)} <span>${esc(s.name)}</span>
    <small>${s.ok ? `${s.count} items` : esc(s.error || 'unavailable')}</small></li>`).join('');
}

// --- Topics ------------------------------------------------------------------

function renderTopics(body) {
  const topics = state.topics;
  if (!topics.length) {
    const why = state.tab === 'tech' && state.scope === 'se'
      ? 'There are no Swedish tech &amp; design sources yet; try International.'
      : 'Nothing is showing up in two or more sources right now.';
    $('topics').innerHTML = `<li class="empty">${why}</li>`;
    $('more-topics').hidden = true;
    return;
  }
  const max = topics[0].score || 1;
  const shown = state.allTopics ? topics : topics.slice(0, TOPICS_COLLAPSED);
  $('topics').innerHTML = shown.map((t, i) => `<li>
    <button class="topic${i < 3 ? ' hot' : ''}" data-topic="${i}" aria-haspopup="dialog">
      <span class="row"><span class="rank">${i + 1}</span><span class="label">${esc(t.label)}</span></span>
      <span class="heat"><i style="width:${Math.max(4, (t.score / max) * 100).toFixed(0)}%"></i></span>
      <span class="stats"><b>${t.sourceCount}</b> sources · <b>${t.articleCount}</b> ${t.articleCount === 1 ? 'item' : 'items'}${t.latestAt ? ` · ${ago(t.latestAt)}` : ''}</span>
      <span class="badges">${t.sources.map((s) => badge(s.id)).join('')}</span>
      <span class="kinds">${t.kinds.map(kindChip).join('')}</span>
      <span class="lead">${esc(t.items.find((d) => d.kind === 'news')?.title || t.items[0]?.title || '')}</span>
    </button></li>`).join('');
  const more = $('more-topics');
  more.hidden = topics.length <= TOPICS_COLLAPSED;
  more.textContent = state.allTopics ? 'Show fewer' : `Show all ${topics.length} topics`;
}

function highlight(text, topic) {
  const words = topic.id.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${words.join('|')})`, 'giu');
  return esc(text).replace(re, '<mark>$1</mark>');
}

function openTopic(t) {
  if (!t) return;
  $('dialog-title').textContent = t.label;
  $('dialog-meta').textContent = `${t.sourceCount} sources · ${t.articleCount} items · ${t.kinds.map((k) => KIND_LABEL[k]).join(', ')}`;
  $('dialog-sources').innerHTML = t.sources.map((s) =>
    `<span class="src">${badge(s.id, true)}${esc(state.sources[s.id]?.name || s.name)} <span class="meta">${s.count}</span></span>`).join('');
  $('dialog-items').innerHTML = t.items.map((d) => `<li>
    ${badge(d.source)}
    <div class="body">
      <a href="${esc(d.url)}" target="_blank" rel="noopener">${highlight(d.title, t)}</a>
      <div class="meta">${[d.sourceName, ago(d.publishedAt), d.region && d.kind !== 'news' ? d.region : '',
        d.channel, d.traffic && `${d.traffic} searches`].filter(Boolean).map(esc).join(' · ')}</div>
    </div></li>`).join('') +
    (t.articleCount > t.items.length ? `<li class="meta">…and ${t.articleCount - t.items.length} more</li>` : '');
  const dlg = $('topic-dialog');
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}

// --- Headlines by source -------------------------------------------------------

function renderHeadlines() {
  const q = $('headline-filter').value.trim().toLowerCase();
  const cards = state.headlines.map((s) => {
    const head = `<div class="source-head">${badge(s.id, true)}<h3>${esc(s.name)}</h3><span class="tag">${s.region === 'SE' ? 'Sweden' : 'International'}</span></div>`;
    if (!s.ok) return `<article class="source down">${head}<p>Temporarily unavailable (${esc(s.error)}). Other sources are unaffected.</p></article>`;
    const items = s.items.filter((it) => !q || it.title.toLowerCase().includes(q) || it.excerpt?.toLowerCase().includes(q));
    if (q && !items.length) return '';
    const li = (it) => `<li><a href="${esc(it.url)}" target="_blank" rel="noopener" title="${esc(it.excerpt || '')}">${esc(it.title)}</a>
      <span class="meta">${esc(ago(it.publishedAt))}${it.discussionUrl ? ` · <a class="meta" href="${esc(it.discussionUrl)}" target="_blank" rel="noopener">${esc(it.excerpt)}</a>` : ''}</span></li>`;
    const first = items.slice(0, 6);
    const rest = items.slice(6, 20);
    return `<article class="source">${head}<ul class="headlines">${first.map(li).join('')}</ul>${rest.length
      ? `<details><summary>${rest.length} more</summary><ul class="headlines">${rest.map(li).join('')}</ul></details>` : ''}</article>`;
  }).join('');
  $('headlines').innerHTML = cards || '<div class="empty">No headlines match.</div>';
}

// --- YouTube and Google views (as before) ----------------------------------------

const matches = (q, ...fields) => !q || fields.some((f) => f && f.toLowerCase().includes(q.toLowerCase()));

function renderYoutube() {
  const q = $('yt-filter').value;
  const rows = state.youtube.filter((v) => matches(q, v.title, v.channel));
  $('youtube').innerHTML = rows.length ? rows.map((v) => `
    <li>
      <span class="rank">${v.rank}</span>
      <a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener"><img class="thumb" src="${esc(v.thumbnail)}" alt="" loading="lazy"></a>
      <div class="body">
        <a class="title" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a>
        <div class="meta">${esc(v.channel)}</div>
        <div class="meta">${fmt.format(v.views)} views · ${fmt.format(v.likes)} likes · ${ago(v.publishedAt)}</div>
        ${v.regions ? `<div class="chips">${v.regions.map((r) => `<span class="chip">${r}</span>`).join('')}</div>` : ''}
      </div>
    </li>`).join('') : '<li class="state">No videos.</li>';
}

function renderGoogle() {
  const q = $('gt-filter').value;
  const rows = state.google.filter((t) => matches(q, t.query, ...t.news.map((n) => n.title)));
  $('google').innerHTML = rows.length ? rows.map((t) => `
    <li>
      <span class="rank">${t.rank}</span>
      ${t.picture ? `<img class="pic" src="${esc(t.picture)}" alt="" loading="lazy">` : ''}
      <div class="body">
        <a class="title" href="https://www.google.com/search?q=${encodeURIComponent(t.query)}" target="_blank" rel="noopener">${esc(t.query)}</a>
        <div class="meta">${esc(t.traffic)} searches · ${ago(t.startedAt)}${state.country === 'EU' ? ` · <span class="chip">${t.region}</span>` : ''}</div>
        <ul class="news">${t.news.slice(0, 2).map((n) =>
          `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="meta">${esc(n.source)}</span></li>`).join('')}</ul>
      </div>
    </li>`).join('') : '<li class="state">No search trends.</li>';
}

// --- Theme: auto -> light -> dark ----------------------------------------------

function showTheme() {
  const t = document.documentElement.dataset.theme || 'auto';
  $('theme').title = `Theme: ${t}`;
  $('theme').setAttribute('aria-label', `Theme: ${t}`);
}
function cycleTheme() {
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[document.documentElement.dataset.theme || 'auto'];
  if (next === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  store.set('theme', next === 'auto' ? '' : next);
  showTheme();
}

init();
