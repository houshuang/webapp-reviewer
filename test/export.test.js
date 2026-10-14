const test = require('node:test');
const assert = require('node:assert');
const { renderReview } = require('./export-harness');
const timeline = require('./fixtures/timeline.json');

const md = renderReview(timeline);
const section = (heading) => {
  const start = md.indexOf(heading);
  assert.ok(start >= 0, `missing "${heading}"`);
  const next = md.indexOf('\n### ', start + 1);
  return md.slice(start, next < 0 ? undefined : next);
};

test('a slow page is credited to the link that points to it, not to the last click', () => {
  const page = section("Page 02 · Holberg's letters");
  assert.match(page, /Arrived by clicking\*\* `<a>` "Holberg's letters"/);
  assert.match(page, /the page appeared 6\.0 s after the click/);
});

test('a new-tab link stays a click with its target', () => {
  assert.match(md, /Clicked link `<a>` "library\.example" \(opens in a new tab\)\n\n- \*\*Link to:\*\* `https:\/\/library\.example\/item\/1`/);
});

test('a link that loaded nothing says so and shows where it points', () => {
  assert.match(md, /Clicked link `<a>` "Epistler, vol\. 2" \(no page load followed in this tab\)[^\n]*\n\n- \*\*Link to:\*\* `\/books\/2`/);
});

test('load timing, form changes and time on another tab are written out', () => {
  assert.match(section("Page 02 · Holberg's letters"), /\*\*Load:\*\* first byte 5\.8 s · page ready 6\.0 s · fully loaded 6\.1 s/);
  assert.match(md, /Set `<select>` "Subject" to "History"/);
  assert.match(md, /\+0:13–0:20 — On another tab or window/);
});

test('the transcript keeps a remark whole across the box drawn in the middle of it', () => {
  const transcript = md.slice(md.indexOf('## Transcript'), md.indexOf('## Timeline'));
  assert.match(transcript, /The search should put the person first, \[\+0:06 box under "Search results"\] not a list of his letters\./);
  assert.match(transcript, /\[\+0:13–0:20 on another tab\] That opens the scan at the title page/);
});

test('repeated clicks on one link are one entry with a count', () => {
  assert.match(md, /Clicked link `<a>` "Epistler, vol\. 2" \(no page load followed in this tab\) · clicked 3 times in 2\.0 s/);
});

test('the site build is in the header', () => {
  assert.match(md, /\*\*Site build:\*\* generator: Folio 2\.3 · commit: 6875fd92\n/);
});

test('a sentence cut by a page change stays in one transcript paragraph', () => {
  const transcript = md.slice(md.indexOf('## Transcript'), md.indexOf('## Timeline'));
  assert.match(transcript, /at the title page, \[\+0:16 · Page 02 `\/books\/1`\] \[\+0:22 clicked link/);
});
