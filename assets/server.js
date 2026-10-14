#!/usr/bin/env node
// Webapp Reviewer — Companion server
// Serves the saved reviews at /reviews. Saving goes through native-host.js and needs no server.
// Usage: node server.js [--port 10002]

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--port') || '10002', 10);
const BASE_DIR = path.join(process.env.HOME, '.claude', 'reviews');
const PID_FILE = path.join(process.env.HOME, '.claude', 'webapp-reviewer.pid');
fs.mkdirSync(BASE_DIR, { recursive: true });
fs.writeFileSync(PID_FILE, String(process.pid));

// Auto-shutdown after 30 min idle
let idleTimer = setTimeout(shutdown, 30 * 60 * 1000);
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, 30 * 60 * 1000);
}

function shutdown() {
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const server = http.createServer((req, res) => {
  // Only the extension may call this server. A wildcard origin would let any open
  // website read saved reviews.
  const origin = req.headers.origin || '';
  // DNS rebinding: a page on attacker.com re-pointed at 127.0.0.1 makes same-origin
  // requests without an Origin header, but its Host header still says attacker.com.
  const host = req.headers.host || '';
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (origin.startsWith('chrome-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else if (origin && req.method !== 'GET') {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    resetIdle();
    const reviews = fs.existsSync(BASE_DIR)
      ? fs.readdirSync(BASE_DIR).filter(f => fs.statSync(path.join(BASE_DIR, f)).isDirectory())
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', pid: process.pid, port: PORT, reviews: reviews.length }));
    return;
  }

  // Serve screenshot images: /screenshots/{session}/{file}
  const ssMatch = req.url.match(/^\/screenshots\/([^/]+)\/(.+)$/);
  if (req.method === 'GET' && ssMatch) {
    const imgPath = path.join(BASE_DIR, ssMatch[1], 'screenshots', ssMatch[2]);
    try {
      const img = fs.readFileSync(imgPath);
      res.writeHead(200, { 'Content-Type': imgPath.endsWith('.png') ? 'image/png' : 'image/jpeg' });
      res.end(img);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // Reviews dashboard
  if (req.method === 'GET' && req.url === '/reviews') {
    resetIdle();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildReviewsDashboard());
    return;
  }

  // Single review detail: /reviews/{session}
  const reviewMatch = req.url.match(/^\/reviews\/([^/]+)$/);
  if (req.method === 'GET' && reviewMatch) {
    resetIdle();
    const session = reviewMatch[1];
    const sessionDir = path.join(BASE_DIR, session);
    if (!fs.existsSync(sessionDir)) {
      res.writeHead(404);
      res.end('Review not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildReviewDetail(session, sessionDir));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── Dashboard helpers ────────────────────────────

function loadReviewMeta(sessionDir) {
  // Try metadata.json first
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf8'));
  } catch {}
  // Fall back to parsing review.md header
  try {
    const md = fs.readFileSync(path.join(sessionDir, 'review.md'), 'utf8');
    const url = (md.match(/\*\*URL:\*\* (.+)/) || [])[1] || '';
    const title = (md.match(/\*\*Title:\*\* (.+)/) || [])[1] || '';
    const date = (md.match(/\*\*Date:\*\* (.+)/) || [])[1] || '';
    const eventCount = parseInt((md.match(/\*\*Events:\*\* (\d+)/) || [])[1] || '0');
    const screenshots = fs.existsSync(path.join(sessionDir, 'screenshots'))
      ? fs.readdirSync(path.join(sessionDir, 'screenshots')).filter(f => /\.(png|jpg)$/.test(f))
      : [];
    return { url, title, date, eventCount, screenshotCount: screenshots.length };
  } catch {}
  return null;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getDomain(url) {
  try { return new URL(url).hostname; } catch { return url || 'unknown'; }
}

function buildReviewsDashboard() {
  const dirs = fs.existsSync(BASE_DIR)
    ? fs.readdirSync(BASE_DIR).filter(f => {
        const p = path.join(BASE_DIR, f);
        return f !== 'latest' && fs.statSync(p).isDirectory();
      })
    : [];

  const reviews = dirs.map(dir => {
    const meta = loadReviewMeta(path.join(BASE_DIR, dir));
    return meta ? { session: dir, ...meta } : null;
  }).filter(Boolean);

  // Sort newest first
  reviews.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Group by domain
  const byDomain = {};
  reviews.forEach(r => {
    const domain = getDomain(r.url);
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push(r);
  });

  // Group by date
  const byDate = {};
  reviews.forEach(r => {
    const day = (r.date || '').substring(0, 10);
    if (!byDate[day]) byDate[day] = [];
    byDate[day].push(r);
  });

  let domainCards = '';
  for (const [domain, items] of Object.entries(byDomain)) {
    domainCards += `<div class="domain-group">
      <h3>${escHtml(domain)} <span class="count">${items.length}</span></h3>
      ${items.map(r => reviewCard(r)).join('')}
    </div>`;
  }

  let dateCards = '';
  for (const [day, items] of Object.entries(byDate)) {
    const label = new Date(day + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    dateCards += `<div class="date-group">
      <h3>${escHtml(label)} <span class="count">${items.length}</span></h3>
      ${items.map(r => reviewCard(r)).join('')}
    </div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Review Sessions</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
  .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  .tabs { display: flex; gap: 2px; margin-bottom: 20px; background: #1e293b; border-radius: 8px; padding: 3px; }
  .tab { flex: 1; text-align: center; padding: 8px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; color: #94a3b8; transition: all 0.15s; }
  .tab.active { background: #334155; color: #f1f5f9; }
  .tab:hover:not(.active) { color: #cbd5e1; }
  .view { display: none; }
  .view.active { display: block; }
  .domain-group, .date-group { margin-bottom: 20px; }
  .domain-group h3, .date-group h3 { font-size: 14px; font-weight: 600; color: #94a3b8; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #1e293b; }
  .count { background: #334155; color: #94a3b8; font-size: 11px; padding: 1px 6px; border-radius: 10px; margin-left: 4px; }
  .card { display: flex; gap: 12px; padding: 12px; margin-bottom: 6px; background: #1e293b; border-radius: 8px; text-decoration: none; color: inherit; transition: background 0.15s; }
  .card:hover { background: #334155; }
  .thumb { width: 80px; height: 50px; border-radius: 4px; object-fit: cover; background: #0f172a; flex-shrink: 0; }
  .card-body { flex: 1; min-width: 0; }
  .card-title { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
  .card-url { font-size: 12px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
  .card-meta { font-size: 11px; color: #475569; }
  .card-meta span { margin-right: 10px; }
  .empty { text-align: center; padding: 60px 20px; color: #475569; }
  .empty p { margin-bottom: 8px; }
  .all-list .card { margin-bottom: 4px; }
</style></head><body>
  <h1>Review Sessions</h1>
  <p class="subtitle">${reviews.length} review${reviews.length !== 1 ? 's' : ''} saved</p>
  ${reviews.length === 0 ? '<div class="empty"><p>No reviews yet.</p><p>Use the Webapp Reviewer extension to record feedback.</p></div>' : `
  <div class="tabs">
    <div class="tab active" data-view="by-date">By Date</div>
    <div class="tab" data-view="by-domain">By Domain</div>
    <div class="tab" data-view="all">All</div>
  </div>
  <div id="by-date" class="view active">${dateCards}</div>
  <div id="by-domain" class="view">${domainCards}</div>
  <div id="all" class="view all-list">${reviews.map(r => reviewCard(r)).join('')}</div>
  `}
  <script>
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.view).classList.add('active');
      });
    });
  </script>
</body></html>`;
}

function reviewCard(r) {
  const time = r.date ? new Date(r.date).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '';
  const day = r.date ? new Date(r.date).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '';
  const firstShot = r.screenshotCount > 0
    ? (fs.readdirSync(path.join(BASE_DIR, r.session, 'screenshots')).sort()[0] || '')
    : '';
  const thumbSrc = firstShot ? `/screenshots/${escHtml(r.session)}/${escHtml(firstShot)}` : '';
  const thumbHtml = thumbSrc
    ? `<img class="thumb" src="${thumbSrc}" alt="" loading="lazy">`
    : `<div class="thumb"></div>`;
  return `<a class="card" href="/reviews/${escHtml(r.session)}">
    ${thumbHtml}
    <div class="card-body">
      <div class="card-title">${escHtml(r.title || r.session)}</div>
      <div class="card-url">${escHtml(r.url)}</div>
      <div class="card-meta">
        <span>${day} ${time}</span>
        <span>${r.eventCount || 0} events</span>
        <span>${r.screenshotCount || 0} screenshots</span>
      </div>
    </div>
  </a>`;
}

function buildReviewDetail(session, sessionDir) {
  const meta = loadReviewMeta(sessionDir) || {};
  let mdContent = '';
  try { mdContent = fs.readFileSync(path.join(sessionDir, 'review.md'), 'utf8'); } catch {}

  // Convert markdown to basic HTML
  let html = escHtml(mdContent);
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Images - rewrite to our screenshot endpoint
  html = html.replace(/!\[([^\]]*)\]\(screenshots\/([^)]+)\)/g,
    `<img src="/screenshots/${escHtml(session)}/$2" alt="$1" style="max-width:100%;border-radius:6px;margin:8px 0">`);
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // Line breaks
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/---/g, '<hr>');
  html = html.replace(/\n\n/g, '<br><br>');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escHtml(meta.title || session)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
  a { color: #60a5fa; }
  .back { display: inline-block; margin-bottom: 16px; color: #64748b; text-decoration: none; font-size: 13px; }
  .back:hover { color: #94a3b8; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 17px; margin: 16px 0 8px; color: #94a3b8; }
  h3 { font-size: 15px; margin: 16px 0 6px; color: #7dd3fc; }
  hr { border: none; border-top: 1px solid #1e293b; margin: 16px 0; }
  code { background: #1e293b; padding: 1px 5px; border-radius: 3px; font-size: 13px; }
  strong { color: #f1f5f9; }
  li { margin-left: 20px; margin-bottom: 4px; }
  img { max-width: 100%; border-radius: 6px; margin: 8px 0; }
  .content { background: #1e293b; padding: 20px; border-radius: 10px; }
</style></head><body>
  <a class="back" href="/reviews">&larr; All reviews</a>
  <div class="content">${html}</div>
</body></html>`;
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Webapp Reviewer server running on port ${PORT}`);
  console.log(`Reviews saved to: ${BASE_DIR}`);
  console.log(`PID: ${process.pid}`);
});
