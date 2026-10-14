#!/usr/bin/env node
// Webapp Reviewer — Chrome native messaging host
// Chrome starts this process when the extension connects and ends it when the
// port closes, so nothing runs between exports. Registered by install.sh.
//
// Messages (one JSON object each, framed by a 4-byte little-endian length):
//   { type: 'get-key' }                                    -> { key }
//   { type: 'begin', session, markdown, metadata, timeline, consoleLog } -> { ok }
//   { type: 'screenshot', session, name, dataUrl }         -> { ok }   name: screenshots/001.jpg or pages/07.jpg
//   { type: 'finish', session, screenshotCount }           -> { path }
// Screenshots travel one per message so a long review never approaches Chrome's
// per-message limit.

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(process.env.HOME, '.claude', 'reviews');
const SKILL_DIR = path.resolve(__dirname, '..');

function loadSonioxKey() {
  if (process.env.SONIOX_KEY) return process.env.SONIOX_KEY;
  for (const file of [path.join(SKILL_DIR, '.env')]) {
    try {
      const match = fs.readFileSync(file, 'utf8').match(/SONIOX_KEY=(.+)/);
      if (match) return match[1].trim();
    } catch {}
  }
  return null;
}

function sessionDir(session) {
  if (!/^review-[\w-]+$/.test(session || '')) throw new Error('invalid session name');
  return path.join(BASE_DIR, session);
}

function handle(msg) {
  if (msg.type === 'get-key') return { key: loadSonioxKey() };

  if (msg.type === 'begin') {
    const dir = sessionDir(msg.session);
    fs.mkdirSync(path.join(dir, 'screenshots'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'review.md'), msg.markdown || '');
    if (msg.timeline) fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(msg.timeline, null, 2));
    if (msg.consoleLog) fs.writeFileSync(path.join(dir, 'console.log'), msg.consoleLog);
    const m = msg.metadata || {};
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
      session: msg.session,
      url: m.url || '',
      title: m.title || '',
      date: m.date || new Date().toISOString(),
      eventCount: m.eventCount || 0,
      pages: m.pages || [],
      screenshotCount: m.screenshotCount || 0,
    }, null, 2));
    return { ok: true };
  }

  if (msg.type === 'screenshot') {
    const dir = sessionDir(msg.session);
    if (!/^(screenshots\/\d{3}|pages\/\d{2,3}(-\d+)?)\.(png|jpg)$/.test(msg.name || '')) throw new Error('invalid screenshot name');
    const base64 = String(msg.dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(path.join(dir, msg.name), Buffer.from(base64, 'base64'));
    return { ok: true };
  }

  if (msg.type === 'finish') {
    const dir = sessionDir(msg.session);
    const latest = path.join(BASE_DIR, 'latest');
    try { fs.unlinkSync(latest); } catch {}
    fs.symlinkSync(dir, latest);
    return { path: dir };
  }

  throw new Error(`unknown message type: ${msg.type}`);
}

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break;
    const raw = buffer.subarray(4, 4 + len).toString('utf8');
    buffer = buffer.subarray(4 + len);
    let reply;
    try { reply = handle(JSON.parse(raw)); } catch (err) { reply = { error: err.message }; }
    send(reply);
  }
});
process.stdin.on('end', () => process.exit(0));
