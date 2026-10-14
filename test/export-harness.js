// Runs the export half of extension/content.js outside the browser: the functions that
// turn a recorded timeline into review.md. Used by the tests and by bin/rebuild-review.
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'extension', 'content.js');

function loadExport(timelineJson) {
  const code = fs.readFileSync(SOURCE, 'utf8');
  const grab = (from, to) => {
    const a = code.indexOf(from), b = code.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`content.js no longer has "${from.trim()}"`);
    return code.slice(a, b);
  };
  const body = [
    grab('  function elapsed(iso)', '  function elementHeadline'),
    grab('  function serializeEvent', '  function persist()'),
    grab('  function trunc(text', '  async function exportReview'),
  ].join('\n');
  const state = {
    startedAt: timelineJson.startedAt,
    pageUrl: timelineJson.startedOn,
    pageTitle: timelineJson.title,
    consoleLog: [],
    timeline: [],
  };
  const fns = new Function('state', body + '\nreturn { voiceBySpokenTime, buildVisits, assignFiles, buildPages, generateMarkdown };')(state);
  return { state, ...fns };
}

// review.md for a timeline.json (screenshots keep the names they were saved under).
function renderReview(timelineJson) {
  const x = loadExport(timelineJson);
  const events = timelineJson.events.map(e => ({ ...e, ...(e.screenshot && !e.sameAs ? { dataUrl: 'data:image/jpeg;base64,' } : {}) }));
  x.state.timeline = events;
  const now = timelineJson.exportedAt || new Date().toISOString();
  const timeline = x.voiceBySpokenTime(events);
  const visits = x.buildVisits(timeline);
  const files = x.assignFiles(visits);
  const pages = x.buildPages(visits, files, now);
  return x.generateMarkdown(timeline, visits, files, pages, now);
}

module.exports = { renderReview };
