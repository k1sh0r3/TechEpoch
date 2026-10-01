#!/usr/bin/env node
'use strict';
/*
 * TechEpoch aggregator — fetches tech news from keyless sources, classifies,
 * scores (AI/ML/Robotics prioritized), dedupes, and writes data/feed.json.
 * Zero npm dependencies. Be polite: sequential requests, delays, timeouts,
 * per-source isolation so one failure never kills the run.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'feed.json');
const UA = 'TechEpoch/1.0 (tech news aggregator; github.com/k1sh0r3/TechEpoch)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchText(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    let req;
    try {
      req = lib.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return fetchText(next, timeoutMs).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
      });
    } catch (e) { return reject(e); }
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout after ' + timeoutMs + 'ms')));
  });
}

/* ---------- tiny XML helpers (no deps) ---------- */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
function unwrapCdata(s) {
  return decodeEntities(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}
function tagContent(block, tag) {
  const m = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? unwrapCdata(m[1]).trim() : '';
}
function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function toISO(d) {
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

/* ---------- sources ---------- */
async function fetchHN() {
  const out = [];
  const urls = [
    'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60',
    // targeted searches so AI/Robotics/ML get strong representation
    'https://hn.algolia.com/api/v1/search?query=AI%20artificial%20intelligence&tags=story&hitsPerPage=25',
    'https://hn.algolia.com/api/v1/search?query=robot%20robotics&tags=story&hitsPerPage=15',
  ];
  for (const u of urls) {
    const raw = await fetchText(u);
    const j = JSON.parse(raw);
    for (const h of j.hits || []) {
      if (!h.title || !h.url) continue;
      out.push({
        title: decodeEntities(h.title), url: h.url, points: h.points || 0,
        publishedAt: h.created_at || new Date().toISOString(),
        sourceName: 'Hacker News', rawSource: 'hn',
      });
    }
    await sleep(800);
  }
  return out;
}

async function fetchArxiv() {
  const cats = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.RO', 'cs.CV'].map((c) => 'cat:' + c).join('+OR+');
  const q = 'https://export.arxiv.org/api/query?search_query=' + cats +
    '&sortBy=submittedDate&sortOrder=descending&max_results=30';
  const xml = await fetchText(q, 25000);
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((e) => ({
    title: tagContent(e, 'title').replace(/\s+/g, ' '),
    url: tagContent(e, 'id'),
    summary: tagContent(e, 'summary').replace(/\s+/g, ' ').slice(0, 220),
    publishedAt: toISO(tagContent(e, 'published')),
    sourceName: 'arXiv', rawSource: 'arxiv',
  })).filter((x) => x.title && x.url && !/error/i.test(x.title));
}

function attrHref(block) {
  const m = block.match(/<link[^>]*href="([^"]+)"/i);
  return m ? m[1] : '';
}

async function fetchReddit() {
  // Reddit's public JSON is 403 for scripts now; the .rss Atom feeds still work.
  const subs = ['MachineLearning', 'artificial', 'technology', 'robotics'];
  const out = [];
  for (const s of subs) {
    const xml = await fetchText('https://www.reddit.com/r/' + s + '/hot.rss?limit=20');
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    for (const e of entries) {
      const title = decodeEntities(tagContent(e, 'title')).replace(/\s+/g, ' ');
      const author = tagContent(e, 'author');
      if (!title) continue;
      if (/automoderator/i.test(author)) continue;               // pinned mod threads
      if (/daily (discussion|questions|thread)/i.test(title)) continue;
      const url = attrHref(e);
      if (!url) continue;
      out.push({
        title, url, points: 0,
        publishedAt: toISO(tagContent(e, 'updated')),
        sourceName: 'r/' + s, rawSource: 'reddit',
      });
    }
    await sleep(4000); // reddit throttles aggressively — be patient
  }
  return out;
}

const RSS_FEEDS = [
  { url: 'https://blog.google/technology/ai/rss/', name: 'Google AI Blog' },
  { url: 'https://www.technologyreview.com/feed/', name: 'MIT Tech Review' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica' },
];

async function fetchRSS() {
  const out = [];
  for (const f of RSS_FEEDS) {
    const xml = await fetchText(f.url, 25000);
    const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    for (const b of blocks.slice(0, 20)) {
      const title = tagContent(b, 'title');
      const link = tagContent(b, 'link');
      if (!title || !link) continue;
      const pub = tagContent(b, 'pubDate') || tagContent(b, 'dc:date');
      out.push({
        title, url: link,
        summary: stripHtml(tagContent(b, 'description')).slice(0, 220),
        publishedAt: pub ? toISO(pub) : new Date().toISOString(),
        sourceName: f.name, rawSource: 'rss',
      });
    }
    await sleep(1200);
  }
  return out;
}

/* ---------- classification & scoring ---------- */
const KEYWORDS = {
  AI: ['llm', 'gpt', 'chatbot', 'generative ai', 'genai', 'openai', 'anthropic', 'gemini',
       'copilot', 'artificial intelligence', 'ai agent', 'agi', 'diffusion', 'text-to-video'],
  Robotics: ['robot', 'humanoid', 'drone', 'boston dynamics', 'optimus', 'manipulat',
             'locomotion', 'warehouse automat', 'tesla bot'],
  'Machine Learning': ['neural network', 'transformer', 'pytorch', 'tensorflow', 'fine-tun',
       'training data', 'benchmark', 'deep learning', 'machine learning', 'foundation model',
       'inference', 'dataset'],
};
const PRIORITY = { AI: 4, Robotics: 4, 'Machine Learning': 3, Research: 3, Tech: 1 };

function classify(item) {
  if (item.rawSource === 'arxiv') return { category: 'Research', hits: 2 };
  const t = (item.title + ' ' + (item.summary || '')).toLowerCase();
  let best = { category: 'Tech', hits: 0 };
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    let hits = 0;
    for (const w of words) if (t.includes(w)) hits++;
    if (hits > best.hits) best = { category: cat, hits };
  }
  return best;
}

function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']
      .forEach((p) => x.searchParams.delete(p));
    return x.toString().replace(/\/$/, '').toLowerCase();
  } catch { return String(u).toLowerCase(); }
}
function wordSet(s) {
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
}
function titlesSimilar(a, b) {
  const A = wordSet(a), B = wordSet(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size) > 0.75;
}

function slugify(title) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  let h = 0;
  for (let i = 0; i < title.length; i++) h = ((h << 5) - h + title.charCodeAt(i)) | 0;
  return (base || 'story') + '-' + Math.abs(h).toString(36);
}

function scoreItem(item) {
  const { category, hits } = classify(item);
  const pts = Math.log10(1 + (item.points || 0));
  const ageH = Math.max(0, (Date.now() - new Date(item.publishedAt).getTime()) / 36e5);
  const recency = 8 * Math.exp(-ageH / 48);
  return {
    id: slugify(item.title),
    title: item.title, url: item.url,
    sourceName: item.sourceName, publishedAt: item.publishedAt,
    summary: item.summary || '', category,
    score: +(10 * PRIORITY[category] + 3 * hits + pts + recency).toFixed(3),
  };
}

function dedupe(items) {
  const kept = [];
  const seenUrls = new Set();
  for (const it of items) {
    const nu = normUrl(it.url);
    if (seenUrls.has(nu)) continue;
    let dup = false;
    for (const k of kept) {
      if (titlesSimilar(it.title, k.title)) {
        dup = true;
        if (it.score > k.score) {
          const i = kept.indexOf(k);
          kept[i] = it;
        }
        break;
      }
    }
    if (!dup) { kept.push(it); seenUrls.add(nu); }
  }
  return kept;
}

/* ---------- main ---------- */
async function main() {
  const sources = [
    ['Hacker News', fetchHN],
    ['arXiv', fetchArxiv],
    ['Reddit', fetchReddit],
    ['RSS', fetchRSS],
  ];
  let fresh = [];
  for (const [name, fn] of sources) {
    try {
      const items = await fn();
      console.log(name + ': ' + items.length + ' items');
      fresh = fresh.concat(items);
    } catch (e) {
      console.log(name + ' FAILED: ' + e.message);
    }
    await sleep(1000);
  }

  let prev = [];
  try {
    prev = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).items || [];
  } catch { /* first run */ }

  const weekAgo = Date.now() - 7 * 24 * 36e5;
  prev = prev.filter((it) => new Date(it.publishedAt).getTime() > weekAgo);

  const scored = fresh.map(scoreItem);
  const merged = dedupe(scored.concat(prev))
    .sort((a, b) => b.score - a.score)
    .slice(0, 120);

  const byCat = {};
  for (const it of merged) byCat[it.category] = (byCat[it.category] || 0) + 1;
  console.log('total: ' + merged.length, JSON.stringify(byCat));

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    updatedAt: new Date().toISOString(),
    totalItems: merged.length,
    categories: byCat,
    items: merged,
  }, null, 2) + '\n');
  console.log('wrote ' + DATA_FILE);
}

main().catch((e) => { console.error('aggregator failed:', e); process.exit(1); });
