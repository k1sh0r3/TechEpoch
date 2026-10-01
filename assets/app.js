'use strict';
/* Tech_Epoch feed app: render, filter, search, share modal, Instagram story-card generator. */

const CATEGORIES = ['All', 'AI', 'Robotics', 'Machine Learning', 'Research', 'Tech'];
const state = { items: [], updatedAt: null, filter: 'All', query: '' };
let shareItem = null;

const $ = (id) => document.getElementById(id);

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pillClass(cat) {
  return 'pill ' + cat.replace('Machine Learning', 'ML');
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.items.filter((it) => {
    if (state.filter !== 'All' && it.category !== state.filter) return false;
    if (q && !(it.title.toLowerCase().includes(q) ||
        (it.summary || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function render() {
  const list = filtered();
  const feed = $('feed');
  feed.innerHTML = list.map((it) => `
    <article class="card">
      <div class="card-top">
        <span class="${pillClass(it.category)}">${esc(it.category)}</span>
        <span class="card-meta">${esc(it.sourceName)} · ${timeAgo(it.publishedAt)}</span>
      </div>
      <h2><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h2>
      ${it.summary ? `<p class="summary">${esc(it.summary)}</p>` : ''}
      <div class="card-foot">
        <button class="btn" data-share="${it.id}">Share ↗</button>
      </div>
    </article>`).join('');
  $('empty').hidden = list.length > 0;
  feed.querySelectorAll('[data-share]').forEach((b) =>
    b.addEventListener('click', () => openShare(b.dataset.share)));
}

function renderChips() {
  $('chips').innerHTML = CATEGORIES.map((c) =>
    `<button class="chip${c === state.filter ? ' active' : ''}" data-cat="${c}">${c}</button>`).join('');
  $('chips').querySelectorAll('.chip').forEach((b) =>
    b.addEventListener('click', () => { state.filter = b.dataset.cat; renderChips(); render(); }));
}

function renderMeta() {
  const t = state.updatedAt ? timeAgo(state.updatedAt) : '—';
  $('meta').textContent = `${state.items.length} stories · updated ${t} · refreshes 4× daily`;
}

/* ---------- share ---------- */
function shareLinks(it) {
  const u = encodeURIComponent(it.url);
  const t = encodeURIComponent(it.title);
  return [
    ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ['X', `https://twitter.com/intent/tweet?text=${t}&url=${u}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ['WhatsApp', `https://wa.me/?text=${t}%20${u}`],
    ['Telegram', `https://t.me/share/url?url=${u}&text=${t}`],
  ];
}

function openShare(id) {
  shareItem = state.items.find((i) => i.id === id);
  if (!shareItem) return;
  $('modalTitle').textContent = shareItem.title;
  $('shareGrid').innerHTML = shareLinks(shareItem)
    .map(([name, href]) => `<a class="btn" href="${href}" target="_blank" rel="noopener">${name} ↗</a>`).join('');
  $('igStatus').textContent = '';
  $('modalBackdrop').hidden = false;
}
function closeShare() { $('modalBackdrop').hidden = true; shareItem = null; }

/* ---------- Instagram story card (1080×1920, drawn in-browser) ---------- */
const CAT_COLORS = {
  'AI': '#7c5cff', 'Robotics': '#38e1c6', 'Machine Learning': '#4da3ff',
  'Research': '#ffb84d', 'Tech': '#8a93a6',
};

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawCard(it) {
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0b1026'); g.addColorStop(0.55, '#141b3d'); g.addColorStop(1, '#3b1d5e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // soft glows
  const glow = (x, y, r, c) => {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  glow(880, 320, 420, 'rgba(124,92,255,0.35)');
  glow(180, 1620, 460, 'rgba(56,225,198,0.18)');

  // top accent bar
  const bar = ctx.createLinearGradient(0, 0, W, 0);
  bar.addColorStop(0, '#7c5cff'); bar.addColorStop(1, '#38e1c6');
  ctx.fillStyle = bar; ctx.fillRect(0, 0, W, 14);

  // brand
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 46px system-ui, -apple-system, sans-serif';
  ctx.fillText('TECH_EPOCH', 80, 150);
  ctx.fillStyle = '#9aa1b8';
  ctx.font = '400 30px system-ui, -apple-system, sans-serif';
  ctx.fillText('Every epoch of tech, daily.', 80, 200);

  // category pill
  const cat = it.category || 'Tech';
  const color = CAT_COLORS[cat] || '#8a93a6';
  ctx.font = '700 30px system-ui, -apple-system, sans-serif';
  const tw = ctx.measureText(cat.toUpperCase()).width;
  const px = 80, py = 260, pw = tw + 56, ph = 62;
  ctx.fillStyle = color;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 31);
    ctx.fill();
  } else {
    ctx.fillRect(px, py, pw, ph);
  }
  ctx.fillStyle = '#0b0e17';
  ctx.fillText(cat.toUpperCase(), px + 28, py + 42);

  // headline
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 62px system-ui, -apple-system, sans-serif';
  const lines = wrapText(ctx, it.title, W - 160).slice(0, 9);
  let y = 480;
  for (const ln of lines) { ctx.fillText(ln, 80, y); y += 84; }

  // source + date
  const d = new Date(it.publishedAt);
  const dateStr = isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  ctx.fillStyle = '#9aa1b8';
  ctx.font = '400 34px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${it.sourceName}${dateStr ? ' · ' + dateStr : ''}`, 80, y + 40);

  // footer
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(80, H - 220, W - 160, 2);
  ctx.fillStyle = '#9aa1b8';
  ctx.font = '400 28px system-ui, -apple-system, sans-serif';
  ctx.fillText('Shared via Tech_Epoch', 80, H - 150);

  return cv;
}

function buildCaption(it) {
  return `${it.title}\n\nvia Tech_Epoch — Every epoch of tech, daily.\n${it.url}\n\n#AI #MachineLearning #Robotics #TechNews #Tech_Epoch`;
}

function downloadCard() {
  if (!shareItem) return;
  try {
    const cv = drawCard(shareItem);
    const a = document.createElement('a');
    a.download = 'tech-epoch-story.png';
    a.href = cv.toDataURL('image/png');
    a.click();
    $('igStatus').textContent = '✓ Card downloaded — post it to your story, then paste the caption.';
  } catch (e) {
    $('igStatus').textContent = 'Could not render the card in this browser.';
  }
}

async function copyCaption() {
  if (!shareItem) return;
  const text = buildCaption(shareItem);
  try {
    await navigator.clipboard.writeText(text);
    $('igStatus').textContent = '✓ Caption copied to clipboard.';
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); $('igStatus').textContent = '✓ Caption copied to clipboard.'; }
    catch { $('igStatus').textContent = 'Copy failed — long-press to copy manually.'; }
    ta.remove();
  }
}

/* ---------- init ---------- */
async function init() {
  renderChips();
  $('search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
  $('modalClose').addEventListener('click', closeShare);
  $('modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeShare(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShare(); });
  $('igDownload').addEventListener('click', downloadCard);
  $('igCaption').addEventListener('click', copyCaption);

  try {
    const res = await fetch('data/feed.json');
    const data = await res.json();
    state.items = data.items || [];
    state.updatedAt = data.updatedAt;
  } catch {
    state.items = [];
  }
  renderMeta();
  render();
}

document.addEventListener('DOMContentLoaded', init);
