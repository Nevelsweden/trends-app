const state = { region: localStorage.getItem('region') || 'SE', youtube: [], google: [] };
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const esc = (s = '') => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ago(date) {
  const h = (Date.now() - new Date(date)) / 36e5;
  if (isNaN(h)) return '';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

async function init() {
  const { regions } = await (await fetch('/api/regions')).json();
  const order = ['SE', 'US', 'EU', ...Object.keys(regions).filter((k) => !['SE', 'US', 'EU'].includes(k))];
  $('regions').innerHTML = order.map((k) =>
    `<button data-region="${k}">${esc(regions[k])}</button>`).join('');
  $('regions').onclick = (e) => {
    const r = e.target.dataset?.region;
    if (r) { state.region = r; try { localStorage.setItem('region', r); } catch {} load(); }
  };
  $('yt-filter').oninput = renderYoutube;
  $('gt-filter').oninput = renderGoogle;
  if (!regions[state.region]) state.region = 'SE';
  load();
}

async function load() {
  for (const b of $('regions').children) b.setAttribute('aria-pressed', b.dataset.region === state.region);
  $('youtube').innerHTML = $('google').innerHTML = '<li class="state">Loading…</li>';
  const get = async (kind) => {
    const res = await fetch(`/api/${kind}?region=${state.region}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    return body.items;
  };
  const [yt, gt] = await Promise.allSettled([get('youtube'), get('google')]);
  showResult('youtube', yt, renderYoutube);
  showResult('google', gt, renderGoogle);
}

function showResult(kind, result, render) {
  if (result.status === 'fulfilled') { state[kind] = result.value; render(); }
  else $(kind).innerHTML = `<li class="state error">Could not load: ${esc(result.reason.message)}</li>`;
}

function matches(q, ...fields) {
  q = q.trim().toLowerCase();
  return !q || fields.some((f) => (f || '').toLowerCase().includes(q));
}

function renderYoutube() {
  const q = $('yt-filter').value;
  const rows = state.youtube.filter((v) => matches(q, v.title, v.channel));
  $('youtube').innerHTML = rows.length ? rows.map((v) => `
    <li>
      <span class="rank">${v.rank}</span>
      <a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener"><img class="thumb" src="${esc(v.thumbnail)}" alt="" loading="lazy"></a>
      <div class="body">
        <a class="title" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a>
        <div class="meta">${esc(v.channel)} · ${fmt.format(v.views)} views · ${fmt.format(v.likes)} likes · ${ago(v.publishedAt)}</div>
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
        <div class="meta">${esc(t.traffic)} searches · ${ago(t.startedAt)}${state.region === 'EU' ? ` · <span class="chip">${t.region}</span>` : ''}</div>
        <ul class="news">${t.news.slice(0, 2).map((n) =>
          `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="meta">${esc(n.source)}</span></li>`).join('')}</ul>
      </div>
    </li>`).join('') : '<li class="state">No search trends.</li>';
}

init();
