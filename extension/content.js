// Webapp Reviewer — Content Script (Timeline Architecture)
// Every action (voice, click, box, page change, screenshot) becomes a timestamped event in one stream.
(function () {
  'use strict';

  if (window.__webappReviewer) {
    // Re-injected by the background after a page load, but this document's reviewer
    // survived (bfcache restore): leave it running instead of toggling it off.
    if (window.__wrResume) { window.__wrResume = false; return; }
    window.__webappReviewer.toggle();
    return;
  }
  window.__wrResume = false;

  // ═══════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════
  const state = {
    active: false,
    mode: null, // 'box' | null
    timeline: [], // { id, type, timestamp, ... }
    pageUrl: window.location.href, // where the review started
    pageTitle: document.title,
    startedAt: null,
    lastUrl: window.location.href,
    consoleLog: [], // every console entry; errors are also timeline events
    tabId: null,
    recording: false,
  };

  // ═══════════════════════════════════════════════
  // SVG Icons
  // ═══════════════════════════════════════════════
  const ICONS = {
    crosshair: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>',
    box: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 3"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
    note: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V4h16v3"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    pencil: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    camera: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    mic: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    list: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    globe: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    alert: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  };

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ═══════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════
  // Generated class names (react-native-web `r-13awgt0`, emotion `css-g5y9jx`,
  // styled-components `sc-…`, CSS modules `Card_title__x7Hq2`) say nothing about
  // the source and change between builds, so they are left out of selectors.
  function isHashedClass(c) {
    if (/^sc-/.test(c) || /__[A-Za-z0-9_-]{5}$/.test(c)) return true;
    const m = c.match(/^[a-z]{1,4}-([a-z0-9]{5,})$/i);
    return !!m && /\d/.test(m[1]) && /[a-z]/i.test(m[1]);
  }

  function meaningfulClasses(el) {
    if (!el.className || typeof el.className !== 'string') return [];
    return el.className.trim().split(/\s+/).filter(c => c && !c.startsWith('wr-') && !isHashedClass(c));
  }

  const TEST_ID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];

  function getTestId(el) {
    for (const a of TEST_ID_ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) return { attr: a, value: v };
    }
    return null;
  }

  function getSelector(el) {
    if (!el || el === document.documentElement || el === document.body) return 'body';
    if (el.id) return '#' + CSS.escape(el.id);
    const path = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      if (current.id) { path.unshift('#' + CSS.escape(current.id)); break; }
      const testId = getTestId(current);
      if (testId) { path.unshift(`[${testId.attr}="${CSS.escape(testId.value)}"]`); break; }
      const classes = meaningfulClasses(current).slice(0, 3);
      if (classes.length) selector += '.' + classes.map(CSS.escape).join('.');
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  function getElementInfo(el) {
    const testId = getTestId(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: meaningfulClasses(el).join(' '),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 120),
      name: accessibleName(el),
      role: el.getAttribute('role') || null,
      testId: testId ? testId.value : null,
      landmark: landmarkOf(el),
      heading: nearestHeading(el),
      width: Math.round(el.offsetWidth),
      height: Math.round(el.offsetHeight),
    };
  }

  function accessibleName(el) {
    const label = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder');
    if (label) return label.trim().substring(0, 80);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ref = document.getElementById(labelledBy.split(/\s+/)[0]);
      if (ref) return ref.textContent.trim().substring(0, 80);
    }
    return (el.innerText || '').trim().replace(/\s+/g, ' ').substring(0, 80);
  }

  function landmarkOf(el) {
    const lm = el.closest('nav, header, footer, aside, main, dialog, form, [role="dialog"], [role="navigation"], [role="banner"], [role="complementary"], [role="main"]');
    if (!lm) return null;
    const label = lm.getAttribute('aria-label');
    return (lm.getAttribute('role') || lm.tagName.toLowerCase()) + (label ? ` "${label}"` : '');
  }

  // The last heading before the element in document order: usually the section it belongs to.
  function nearestHeading(el) {
    let found = null;
    for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
      if (h === el || h.contains(el)) { found = h; break; }
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) found = h;
      else break;
    }
    return found ? found.textContent.trim().replace(/\s+/g, ' ').substring(0, 80) : null;
  }

  // Component names and source location come from the page-world probe, which can
  // read framework internals (React fibers, Vue instances) the isolated world cannot.
  function inspectComponents(el) {
    return new Promise(resolve => {
      const id = Math.random().toString(36).slice(2, 10);
      const done = (result) => {
        window.removeEventListener('message', onMsg);
        el.removeAttribute('data-wr-inspect');
        resolve(result);
      };
      const onMsg = (e) => {
        if (e.source === window && e.data && e.data.__wr === 'inspect-result' && e.data.id === id) done(cleanComponents(e.data.result));
      };
      window.addEventListener('message', onMsg);
      el.setAttribute('data-wr-inspect', id);
      window.postMessage({ __wr: 'inspect', id }, '*');
      setTimeout(() => done(null), 200);
    });
  }

  // Probe results arrive over a channel the page can also write to.
  function cleanComponents(r) {
    if (!r || typeof r !== 'object') return null;
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
    const components = Array.isArray(r.components) ? r.components.map(c => str(c, 80)).filter(Boolean).slice(0, 6) : [];
    const source = str(r.source, 300);
    if (!components.length && !source) return null;
    return { framework: str(r.framework, 20), components, source };
  }

  async function describeElement(el) {
    const info = getElementInfo(el);
    const components = await inspectComponents(el);
    if (components) info.components = components;
    return info;
  }

  // ═══════════════════════════════════════════════
  // Perceptual Hash (dHash)
  // ═══════════════════════════════════════════════
  let lastScreenshotHash = null;

  function computeDHash(dataUrl, size = 8) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = size + 1; c.height = size;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, size + 1, size);
        const px = ctx.getImageData(0, 0, size + 1, size).data;
        let hash = 0n;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const i1 = (y * (size + 1) + x) * 4;
            const i2 = (y * (size + 1) + x + 1) * 4;
            const g1 = px[i1] * 0.299 + px[i1+1] * 0.587 + px[i1+2] * 0.114;
            const g2 = px[i2] * 0.299 + px[i2+1] * 0.587 + px[i2+2] * 0.114;
            if (g1 > g2) hash |= 1n << BigInt(y * size + x);
          }
        }
        resolve(hash);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function hammingDistance(a, b) {
    let xor = a ^ b, count = 0;
    while (xor > 0n) { count += Number(xor & 1n); xor >>= 1n; }
    return count;
  }

  function isOurElement(el) {
    if (!el) return false;
    let current = el;
    while (current) {
      if (current === host || current === boxLayer || current === boxRect) return true;
      if (current.classList && current.classList.contains('wr-burn-in')) return true;
      current = current.parentElement;
    }
    return false;
  }

  // ═══════════════════════════════════════════════
  // Box layer — captures the drag while a box is drawn, so the page never sees it
  // ═══════════════════════════════════════════════
  const boxLayer = document.createElement('div');
  boxLayer.style.cssText = 'position:fixed;inset:0;z-index:2147483643;cursor:crosshair;display:none;';
  const boxRect = document.createElement('div');
  boxRect.style.cssText = 'position:fixed;pointer-events:none;border:2px dashed #ef4444;background:rgba(239,68,68,0.06);z-index:2147483644;display:none;';

  // ═══════════════════════════════════════════════
  // Shadow DOM
  // ═══════════════════════════════════════════════
  const host = document.createElement('div');
  host.id = 'webapp-reviewer-host';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;';
  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  .wr-root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #f9fafb; }

  /* Toolbar */
  .toolbar {
    position: fixed; bottom: 20px; right: 20px;
    display: flex; gap: 4px; padding: 6px;
    background: rgba(17, 24, 39, 0.92); backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4); user-select: none;
  }
  .toolbar button {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border: none; border-radius: 8px;
    background: transparent; color: #9ca3af; cursor: pointer; transition: all .15s;
    position: relative;
  }
  .toolbar button:hover { background: rgba(255,255,255,0.1); color: #f9fafb; }
  .toolbar button.active { background: #3b82f6; color: #fff; }
  .toolbar button.recording { background: #ef4444; color: #fff; animation: pulse 1s infinite; }
  .toolbar .sep { width: 1px; background: rgba(255,255,255,0.1); margin: 4px 2px; }
  .badge-count {
    position: absolute; top: -4px; right: -4px;
    background: #3b82f6; color: #fff; font-size: 10px; font-weight: 700;
    min-width: 18px; height: 18px; border-radius: 9px; padding: 0 4px;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

  /* Typed note */
  .note-form {
    position: fixed; bottom: 72px; right: 20px; width: 340px; padding: 12px;
    background: rgba(17, 24, 39, 0.95); backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5); z-index: 1;
  }
  .note-form textarea {
    width: 100%; height: 80px; resize: vertical;
    background: #1f2937; border: 1px solid #374151; border-radius: 6px;
    color: #f9fafb; padding: 8px; font: 13px/1.4 -apple-system, sans-serif; outline: none;
  }
  .note-form textarea:focus { border-color: #3b82f6; }
  .note-form textarea::placeholder { color: #6b7280; }
  .form-actions { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
  .form-actions button { padding: 6px 14px; border: none; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; }
  .form-hint { margin-left: auto; font-size: 11px; color: #6b7280; }
  .btn-save { background: #3b82f6; color: #fff; }
  .btn-save:hover { background: #2563eb; }
  .btn-cancel { background: #374151; color: #d1d5db; }
  .btn-cancel:hover { background: #4b5563; }

  /* Timeline Panel */
  .timeline-panel {
    position: fixed; bottom: 72px; right: 20px; width: 380px; max-height: 60vh;
    background: rgba(17, 24, 39, 0.95); backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .tl-header {
    padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.1);
    display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
  }
  .tl-header h3 { font-size: 13px; font-weight: 600; color: #d1d5db; }
  .tl-count { font-size: 11px; color: #6b7280; }
  .tl-list { flex: 1; overflow-y: auto; padding: 6px; min-height: 60px; }
  .tl-empty { text-align: center; color: #6b7280; font-size: 12px; padding: 20px 0; }
  .tl-item { display: flex; gap: 8px; padding: 8px; border-radius: 6px; margin-bottom: 2px; }
  .tl-item:hover { background: rgba(255,255,255,0.04); }
  .tl-icon-wrap {
    flex-shrink: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    border-radius: 6px;
  }
  .tl-icon-wrap.voice { background: rgba(239,68,68,0.15); color: #ef4444; }
  .tl-icon-wrap.annotation { background: rgba(59,130,246,0.15); color: #3b82f6; }
  .tl-shot { color: #10b981; }
  .tl-noshot { color: #6b7280; }
  .tl-icon-wrap.screenshot { background: rgba(16,185,129,0.15); color: #10b981; }
  .tl-icon-wrap.nav { background: rgba(168,85,247,0.15); color: #a855f7; }
  .tl-icon-wrap.console { background: rgba(245,158,11,0.15); color: #f59e0b; }
  .tl-body { flex: 1; min-width: 0; }
  .tl-text { font-size: 12px; color: #e5e7eb; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
  .tl-selector {
    font: 11px/1.3 'SF Mono', 'JetBrains Mono', monospace;
    color: #60a5fa; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tl-time { font-size: 10px; color: #6b7280; margin-top: 3px; }
  .tl-thumb { max-width: 100%; max-height: 80px; border-radius: 4px; margin-top: 4px; display: block; }
  .tl-del {
    flex-shrink: 0; width: 20px; height: 20px; background: none; border: none;
    color: #6b7280; cursor: pointer; padding: 0; opacity: 0; transition: opacity .15s;
    display: flex; align-items: center; justify-content: center;
  }
  .tl-item:hover .tl-del { opacity: 1; }
  .tl-del:hover { color: #ef4444; }

  /* Pending voice (live transcription) */
  .tl-pending {
    padding: 8px 12px; border-top: 1px solid rgba(239,68,68,0.3);
    display: flex; gap: 8px; align-items: flex-start;
    background: rgba(239,68,68,0.05); flex-shrink: 0;
  }
  .tl-pending-dot { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; margin-top: 3px; flex-shrink: 0; animation: pulse 1s infinite; }
  .tl-pending-text { font-size: 12px; color: #fca5a5; font-style: italic; flex: 1; min-height: 16px; }

  /* Mini Feed (always visible, bottom-left) */
  .mini-feed {
    position: fixed; bottom: 20px; left: 20px; width: 280px;
    display: flex; flex-direction: column; gap: 4px;
    pointer-events: none; z-index: 1;
  }
  .mini-feed-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; border-radius: 8px;
    background: rgba(17, 24, 39, 0.88); backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.08);
    pointer-events: auto; cursor: pointer;
    animation: feedSlideIn 0.3s ease-out;
    transition: opacity 0.3s, transform 0.3s;
  }
  .mini-feed-item:hover { background: rgba(17, 24, 39, 0.95); border-color: rgba(255,255,255,0.15); }
  .mini-feed-item.gone { opacity: 0; transform: translateY(6px); pointer-events: none; }
  .mf-icon { flex-shrink: 0; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 4px; }
  .mf-icon.voice { background: rgba(239,68,68,0.2); color: #ef4444; }
  .mf-icon.annotation { background: rgba(59,130,246,0.2); color: #3b82f6; }
  .mf-icon.screenshot { background: rgba(16,185,129,0.2); color: #10b981; }
  .mf-icon.nav { background: rgba(168,85,247,0.2); color: #a855f7; }
  .mf-icon.console { background: rgba(245,158,11,0.2); color: #f59e0b; }
  .mf-icon svg { width: 14px; height: 14px; }
  .mf-text { flex: 1; font-size: 11px; color: #d1d5db; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3; }
  .mf-time { font-size: 10px; color: #6b7280; flex-shrink: 0; }
  @keyframes feedSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

  /* Voice indicator (top of screen) */
  .voice-indicator {
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background: rgba(239, 68, 68, 0.95); color: #fff;
    padding: 8px 20px; border-radius: 24px;
    font-size: 14px; font-weight: 600;
    display: flex; align-items: center; gap: 8px;
    box-shadow: 0 4px 16px rgba(239, 68, 68, 0.4);
    animation: pulse 1s infinite; pointer-events: none;
  }
  .voice-indicator .dot { width: 10px; height: 10px; border-radius: 50%; background: #fff; }

  /* Toast */
  .toast {
    position: fixed; bottom: 72px; left: 50%; transform: translateX(-50%);
    background: #065f46; color: #a7f3d0; padding: 8px 16px;
    border-radius: 8px; font-size: 13px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    opacity: 0; transition: opacity .3s; pointer-events: none;
  }
  .toast.show { opacity: 1; }

  /* Help */
  .help-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center; z-index: 2;
  }
  .help-card {
    background: #1f2937; border: 1px solid #374151; border-radius: 12px;
    padding: 24px; max-width: 420px; width: 90%;
  }
  .help-card h3 { font-size: 16px; margin-bottom: 16px; }
  .help-card table { width: 100%; }
  .help-card td { padding: 4px 0; font-size: 13px; }
  .help-card td:first-child { color: #9ca3af; width: 130px; vertical-align: top; }
  .help-card p { font-size: 13px; color: #d1d5db; line-height: 1.5; }
  .help-card kbd {
    background: #374151; padding: 2px 6px; border-radius: 3px;
    border: 1px solid #4b5563; font-size: 11px; font-family: inherit;
  }
</style>

<div class="wr-root" style="display:none">
  <div class="toolbar">
    <button class="btn-box" title="Box an area (or hold Option and drag)">${ICONS.box}</button>
    <button class="btn-note" title="Type a note (Alt+T)">${ICONS.note}</button>
    <div class="sep"></div>
    <button class="btn-screenshot" title="Screenshot (Alt+S)">${ICONS.camera}</button>
    <button class="btn-voice" title="Pause / resume voice">${ICONS.mic}</button>
    <button class="btn-timeline" title="Timeline (Alt+N)">${ICONS.list}</button>
    <div class="sep"></div>
    <button class="btn-export" title="Export (Alt+X)">${ICONS.download}</button>
    <div class="sep"></div>
    <button class="btn-help" title="Help (?)" style="font-size:16px;font-weight:bold;">?</button>
    <button class="btn-close" title="Close">${ICONS.x}</button>
  </div>

  <div class="note-form" style="display:none">
    <textarea placeholder="Type instead of talking. It goes into the timeline here, like speech."></textarea>
    <div class="form-actions">
      <button class="btn-save">Add</button>
      <button class="btn-cancel">Cancel</button>
      <span class="form-hint">⌘↵ to add</span>
    </div>
  </div>

  <div class="timeline-panel" style="display:none">
    <div class="tl-header">
      <h3>Review Timeline</h3>
      <span class="tl-count">0 events</span>
    </div>
    <div class="tl-list">
      <div class="tl-empty">Talk, click, box...</div>
    </div>
    <div class="tl-pending" style="display:none">
      <div class="tl-pending-dot"></div>
      <div class="tl-pending-text">Listening...</div>
    </div>
  </div>

  <div class="mini-feed"></div>

  <div class="voice-indicator" style="display:none">
    <div class="dot"></div>
    <span>Voice active</span>
  </div>

  <div class="toast"></div>

  <div class="help-overlay" style="display:none">
    <div class="help-card">
      <h3>How to review</h3>
      <p>Just talk while you use the page. Everything you say is recorded, and each page you open is screenshotted.</p>
      <table style="margin-top:12px">
        <tr><td>Click</td><td>Point at one element. The agent gets it boxed in a screenshot.</td></tr>
        <tr><td><kbd>⌥</kbd> + drag</td><td>Box an area. The agent gets a cropped screenshot and what is inside it.</td></tr>
        <tr><td>Select text</td><td>Quote exact wording, such as a typo</td></tr>
        <tr><td><kbd>Alt+S</kbd></td><td>Screenshot the whole screen</td></tr>
        <tr><td><kbd>Alt+T</kbd></td><td>Type a note instead of talking</td></tr>
        <tr><td><kbd>Alt+N</kbd></td><td>Show what has been recorded</td></tr>
        <tr><td><kbd>Alt+X</kbd></td><td>Export (copies the path)</td></tr>
        <tr><td><kbd>Alt+R</kbd></td><td>Start / stop the review</td></tr>
      </table>
      <p style="margin-top:16px;font-size:12px;color:#6b7280">Click anywhere to close</p>
    </div>
  </div>
</div>
`;

  // ═══════════════════════════════════════════════
  // DOM Refs
  // ═══════════════════════════════════════════════
  const root = shadow.querySelector('.wr-root');
  const toolbar = shadow.querySelector('.toolbar');
  const btnBox = shadow.querySelector('.btn-box');
  const btnNote = shadow.querySelector('.btn-note');
  const btnScreenshot = shadow.querySelector('.btn-screenshot');
  const btnVoice = shadow.querySelector('.btn-voice');
  const btnTimeline = shadow.querySelector('.btn-timeline');
  const btnExport = shadow.querySelector('.btn-export');
  const btnHelp = shadow.querySelector('.btn-help');
  const btnClose = shadow.querySelector('.btn-close');

  const noteForm = shadow.querySelector('.note-form');
  const noteTextarea = shadow.querySelector('.note-form textarea');
  const noteSave = shadow.querySelector('.note-form .btn-save');
  const noteCancel = shadow.querySelector('.note-form .btn-cancel');

  const timelinePanel = shadow.querySelector('.timeline-panel');
  const timelineList = shadow.querySelector('.tl-list');
  const timelineCount = shadow.querySelector('.tl-count');
  const tlPending = shadow.querySelector('.tl-pending');
  const tlPendingText = shadow.querySelector('.tl-pending-text');

  const miniFeed = shadow.querySelector('.mini-feed');
  const voiceIndicator = shadow.querySelector('.voice-indicator');
  const toastEl = shadow.querySelector('.toast');
  const helpOverlay = shadow.querySelector('.help-overlay');

  // ═══════════════════════════════════════════════
  // Toast
  // ═══════════════════════════════════════════════
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  // ═══════════════════════════════════════════════
  // Timeline
  // ═══════════════════════════════════════════════
  function addEvent(type, data) {
    // A debounced route change that already happened belongs before this event.
    if (type !== 'navigation' && navTimer && location.href !== state.lastUrl) {
      clearTimeout(navTimer);
      navTimer = null;
      onNavigated(location.href, 'in-page');
    }
    const now = new Date().toISOString();
    if (!state.timeline.length && type !== 'navigation') {
      // A review continuing after an export: it starts when the speech that is being
      // committed began, on this page.
      state.startedAt = voiceFrom && voiceFrom < now ? voiceFrom : now;
      const start = pushEvent('navigation', { url: location.href, kind: 'start', title: document.title, shotPending: true }, state.startedAt);
      setTimeout(() => capturePage(start.id), 50);
    }
    if (!state.startedAt) state.startedAt = now;
    const evt = pushEvent(type, data, now);
    renderTimeline();
    renderMiniFeed();
    persist();
    return evt;
  }

  function pushEvent(type, data, timestamp) {
    const evt = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type,
      timestamp,
      url: location.href,
      ...data,
    };
    state.timeline.push(evt);
    return evt;
  }

  function removeEvent(id) {
    const idx = state.timeline.findIndex(e => e.id === id);
    if (idx < 0) return;
    const evt = state.timeline[idx];
    state.timeline.splice(idx, 1);
    if (evt.dataUrl && state.tabId) chrome.storage.local.remove(shotKey(evt.id));
    renderTimeline();
    renderMiniFeed();
    persist();
  }

  function elapsed(iso) {
    if (!state.startedAt) return '+0:00';
    const sec = Math.max(0, Math.round((new Date(iso) - new Date(state.startedAt)) / 1000));
    return `+${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function elementHeadline(info) {
    const name = info.name || info.text;
    return `<${info.tag}>` + (name ? ` "${name.length > 50 ? name.substring(0, 50) + '…' : name}"` : '');
  }

  // ═══════════════════════════════════════════════
  // Persistence — the timeline survives full page loads
  // Stored per tab in chrome.storage.local; screenshots under separate keys so the
  // frequent state writes stay small.
  // ═══════════════════════════════════════════════
  const stateKey = () => `wr:${state.tabId}:state`;
  const shotKey = (id) => `wr:${state.tabId}:shot:${id}`;
  const storedShots = new Set();
  let persistTimer = null;

  function serializeEvent(evt) {
    const { element, dataUrl, ...rest } = evt;
    return { ...rest, hasShot: !!dataUrl };
  }

  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(flushPersist, 250);
  }

  function flushPersist() {
    clearTimeout(persistTimer);
    if (!state.tabId) return;
    const writes = {
      [stateKey()]: {
        pageUrl: state.pageUrl,
        pageTitle: state.pageTitle,
        startedAt: state.startedAt,
        lastUrl: state.lastUrl,
        timeline: state.timeline.map(serializeEvent),
        consoleLog: state.consoleLog,
      },
    };
    state.timeline.forEach(evt => {
      if (evt.dataUrl && !storedShots.has(evt.id)) {
        writes[shotKey(evt.id)] = evt.dataUrl;
        storedShots.add(evt.id);
      }
    });
    chrome.storage.local.set(writes).catch(() => {});
  }

  async function restore() {
    if (!state.tabId) return false;
    const data = await chrome.storage.local.get(stateKey());
    const saved = data[stateKey()];
    if (!saved || !saved.timeline) return false;
    const shotIds = saved.timeline.filter(e => e.hasShot).map(e => shotKey(e.id));
    const shots = shotIds.length ? await chrome.storage.local.get(shotIds) : {};
    state.timeline = saved.timeline.map(({ hasShot, ...e }) => {
      const dataUrl = shots[shotKey(e.id)];
      if (dataUrl) storedShots.add(e.id);
      return dataUrl ? { ...e, dataUrl } : e;
    });
    state.pageUrl = saved.pageUrl;
    state.pageTitle = saved.pageTitle;
    state.startedAt = saved.startedAt;
    state.lastUrl = saved.lastUrl;
    state.consoleLog = saved.consoleLog || [];
    renderTimeline();
    renderMiniFeed();
    return true;
  }

  async function clearStorage() {
    if (!state.tabId) return;
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith(`wr:${state.tabId}:`));
    if (keys.length) await chrome.storage.local.remove(keys);
    storedShots.clear();
  }

  // How an event will read in review.md, for the panel and the feed. `shot` is true
  // when the agent gets a screenshot with it, false when it gets none, null when n/a.
  function describeForAgent(evt) {
    const shot = evt.dataUrl ? true : null;
    switch (evt.type) {
      case 'voice': return { icon: ICONS.mic, cls: 'voice', text: evt.text, shot: null };
      case 'note': return { icon: ICONS.note, cls: 'voice', text: 'Typed: ' + evt.text, shot: null };
      case 'reference':
        if (evt.isLink) return { icon: ICONS.crosshair, cls: 'annotation', text: 'Clicked link ' + elementHeadline(evt.info), shot: null };
        return { icon: ICONS.crosshair, cls: 'annotation', text: 'Pointed at ' + elementHeadline(evt.info), shot: !!evt.dataUrl };
      case 'box': return {
        icon: ICONS.box, cls: 'annotation',
        text: 'Box' + (evt.info && evt.info.heading ? ` under "${evt.info.heading}"` : '') + ` · ${evt.outline.length} items inside`,
        shot: !!evt.dataUrl,
      };
      case 'selection': return { icon: '\u201C', cls: 'voice', text: '"' + evt.text.replace(/\s+/g, ' ') + '"', shot: null };
      case 'navigation': {
        const path = evt.url.replace(/^https?:\/\/[^/]+/, '') || '/';
        return { icon: ICONS.globe, cls: 'nav', text: `Page ${path}` + (evt.title ? ' · ' + evt.title : ''), shot: evt.sameAs ? true : (evt.dataUrl ? true : (evt.shotPending ? null : false)) };
      }
      case 'screenshot': return { icon: ICONS.camera, cls: 'screenshot', text: 'Whole screen', shot: true };
      case 'console': return { icon: ICONS.alert, cls: 'console', text: evt.text + (evt.count > 1 ? ' ×' + evt.count : ''), shot: null };
      case 'change': return { icon: ICONS.crosshair, cls: 'annotation', text: `Set ${elementHeadline(evt.info)} to "${evt.value}"`, shot: null };
      case 'away': return { icon: ICONS.globe, cls: 'nav', text: evt.until ? `On another tab for ${Math.round((Date.parse(evt.until) - Date.parse(evt.timestamp)) / 1000)} s` : 'Switched to another tab', shot: null };
      case 'annotation': return { icon: ICONS.crosshair, cls: 'annotation', text: evt.notes, shot };
      case 'drawing': return { icon: ICONS.pencil, cls: 'annotation', text: 'Drawing', shot };
      default: return { icon: ICONS.camera, cls: 'screenshot', text: evt.type, shot };
    }
  }

  function shotMark(shot) {
    if (shot === true) return '<span class="tl-shot"> · screenshot</span>';
    if (shot === false) return '<span class="tl-noshot"> · no screenshot</span>';
    return '';
  }

  function renderTimeline() {
    timelineList.innerHTML = '';
    timelineCount.textContent = state.timeline.length + ' event' + (state.timeline.length !== 1 ? 's' : '');
    updateEventBadge();

    if (state.timeline.length === 0) {
      timelineList.innerHTML = '<div class="tl-empty">Talk, click, box...</div>';
      return;
    }

    state.timeline.forEach(evt => {
      const d = describeForAgent(evt);
      const item = document.createElement('div');
      item.className = 'tl-item';
      const range = evt.from ? `${elapsed(evt.from)}–${elapsed(evt.timestamp).slice(1)}` : elapsed(evt.timestamp);
      item.innerHTML = `
        <div class="tl-icon-wrap ${d.cls}">${d.icon}</div>
        <div class="tl-body">
          <div class="tl-text">${escapeHtml(d.text.length > 300 ? d.text.substring(0, 300) + '…' : d.text)}</div>
          ${evt.dataUrl ? `<img class="tl-thumb" src="${evt.dataUrl}" />` : ''}
          <div class="tl-time">${range}${shotMark(d.shot)}</div>
        </div>
        <button class="tl-del">${ICONS.trash}</button>`;
      item.querySelector('.tl-del').addEventListener('click', () => removeEvent(evt.id));
      timelineList.appendChild(item);
    });

    timelineList.scrollTop = timelineList.scrollHeight;
  }

  function updateEventBadge() {
    let badge = btnTimeline.querySelector('.badge-count');
    if (state.timeline.length > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge-count';
        btnTimeline.appendChild(badge);
      }
      badge.textContent = state.timeline.length;
    } else if (badge) {
      badge.remove();
    }
  }

  function toggleTimeline() {
    if (timelinePanel.style.display === 'block') {
      timelinePanel.style.display = 'none';
    } else {
      timelinePanel.style.display = 'block';
      renderTimeline();
      timelineList.scrollTop = timelineList.scrollHeight;
    }
  }

  // ═══════════════════════════════════════════════
  // Mini Feed: the reviewer's latest action, bottom-left, fading after a few seconds
  // ═══════════════════════════════════════════════
  const FEED_SHOW_MS = 3500;
  const FEED_SKIP = ['navigation', 'voice', 'away'];
  let feedId = null;
  let feedTimer = null;

  function renderMiniFeed() {
    const evt = state.timeline.findLast(e => !FEED_SKIP.includes(e.type));
    if (!evt) { miniFeed.innerHTML = ''; feedId = null; return; }
    const d = describeForAgent(evt);
    const text = d.text.length > 60 ? d.text.substring(0, 60) + '…' : d.text;
    const html = `<div class="mf-icon ${d.cls}">${d.icon}</div><div class="mf-text">${escapeHtml(text)}</div><div class="mf-time">${shotMark(d.shot)}</div>`;
    // The same event again (its screenshot arrived, a repeat counted): update in place.
    if (evt.id === feedId) {
      const item = miniFeed.querySelector('.mini-feed-item');
      if (item && item.innerHTML !== html) item.innerHTML = html;
      return;
    }
    if (feedId === null && Date.now() - Date.parse(evt.timestamp) > FEED_SHOW_MS) { feedId = evt.id; return; } // restored on page load
    feedId = evt.id;
    miniFeed.innerHTML = '';
    const item = document.createElement('div');
    item.className = 'mini-feed-item';
    item.innerHTML = html;
    item.addEventListener('click', () => {
      timelinePanel.style.display = 'block';
      renderTimeline();
      timelineList.scrollTop = timelineList.scrollHeight;
    });
    miniFeed.appendChild(item);
    clearTimeout(feedTimer);
    feedTimer = setTimeout(() => item.classList.add('gone'), FEED_SHOW_MS);
  }

  // ═══════════════════════════════════════════════
  // Toolbar
  // ═══════════════════════════════════════════════
  btnBox.addEventListener('click', () => toggleMode('box'));
  btnNote.addEventListener('click', toggleNoteForm);
  btnScreenshot.addEventListener('click', () => captureScreenshot());
  btnVoice.addEventListener('click', () => toggleVoice());
  btnTimeline.addEventListener('click', toggleTimeline);
  btnExport.addEventListener('click', () => exportReview());
  btnHelp.addEventListener('click', () => {
    helpOverlay.style.display = helpOverlay.style.display === 'none' ? 'flex' : 'none';
  });
  btnClose.addEventListener('click', () => deactivate());

  function toggleMode(mode) {
    if (state.mode === mode) { exitMode(); return; }
    exitMode();
    state.mode = mode;
    if (mode === 'box') { btnBox.classList.add('active'); boxLayer.style.display = 'block'; }
  }

  function exitMode() {
    if (state.mode === 'box') { btnBox.classList.remove('active'); if (!boxStart) boxLayer.style.display = 'none'; }
    state.mode = null;
  }

  // ═══════════════════════════════════════════════
  // Typed note — the same as speech, for when talking is not an option
  // ═══════════════════════════════════════════════
  function toggleNoteForm() {
    if (noteForm.style.display === 'block') { hideNoteForm(); return; }
    noteTextarea.value = '';
    noteForm.style.display = 'block';
    setTimeout(() => noteTextarea.focus(), 50);
  }

  function hideNoteForm() {
    noteForm.style.display = 'none';
  }

  function saveNote() {
    const text = noteTextarea.value.trim();
    if (!text) { hideNoteForm(); return; }
    commitVoiceSegment();
    addEvent('note', { text });
    hideNoteForm();
  }

  noteSave.addEventListener('click', saveNote);
  noteCancel.addEventListener('click', hideNoteForm);
  noteTextarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNote(); }
    e.stopPropagation();
  });

  // ═══════════════════════════════════════════════
  // Box — Option+drag (or the toolbar button, then drag) marks an area. The agent
  // gets a cropped screenshot, the smallest element that contains the area, and an
  // outline of the headings, links, controls and text inside it.
  // ═══════════════════════════════════════════════
  let boxStart = null;
  let suppressClick = false;
  const MIN_BOX = 12;
  const MAX_OUTLINE = 30;

  function rectFrom(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  }

  function showBoxRect(r) {
    Object.assign(boxRect.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  function onBoxDown(e) {
    if (!state.active || e.button !== 0) return;
    const viaMode = state.mode === 'box' && e.target === boxLayer;
    if (!viaMode && !(e.altKey && !isOurElement(e.target))) return;
    e.preventDefault(); e.stopPropagation();
    boxStart = { x: e.clientX, y: e.clientY };
    boxLayer.style.display = 'block'; // takes the rest of the drag away from the page
    showBoxRect(rectFrom(boxStart, boxStart));
  }

  function onBoxMove(e) {
    if (!boxStart) return;
    e.preventDefault();
    showBoxRect(rectFrom(boxStart, { x: e.clientX, y: e.clientY }));
  }

  async function onBoxUp(e) {
    if (!boxStart) return;
    e.preventDefault(); e.stopPropagation();
    const r = rectFrom(boxStart, { x: e.clientX, y: e.clientY });
    boxStart = null;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    boxRect.style.display = 'none';
    if (state.mode === 'box') exitMode();
    boxLayer.style.display = 'none';
    if (r.width < MIN_BOX || r.height < MIN_BOX) return;
    await recordBox(r);
  }

  document.addEventListener('mousedown', onBoxDown, true);
  document.addEventListener('mousemove', onBoxMove, true);
  document.addEventListener('mouseup', onBoxUp, true);

  function intersection(a, b) {
    const w = Math.min(a.x + a.width, b.right) - Math.max(a.x, b.left);
    const h = Math.min(a.y + a.height, b.bottom) - Math.max(a.y, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }

  // The smallest element containing the corners and centre of the box.
  function boxContainer(r) {
    const points = [
      [r.x + 2, r.y + 2], [r.x + r.width - 2, r.y + 2], [r.x + 2, r.y + r.height - 2],
      [r.x + r.width - 2, r.y + r.height - 2], [r.x + r.width / 2, r.y + r.height / 2],
    ];
    const hits = points
      .map(([x, y]) => document.elementsFromPoint(x, y).find(n => !isOurElement(n)))
      .filter(Boolean);
    if (!hits.length) return document.body;
    let common = hits[0];
    while (common && !hits.every(h => common.contains(h))) common = common.parentElement;
    return common || document.body;
  }

  function oneLine(text, n = 120) {
    const t = (text || '').trim().replace(/\s+/g, ' ');
    return t.length > n ? t.substring(0, n) + '…' : t;
  }

  function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) return true;
    return false;
  }

  // What is inside the box, in reading order. Each emitted element stands for its
  // whole subtree, so a paragraph with inline links reads as one line.
  function boxContents(r) {
    const boxArea = r.width * r.height;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) {
        if (isOurElement(el)) return NodeFilter.FILTER_REJECT;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return NodeFilter.FILTER_SKIP;
        const inter = intersection(r, b);
        if (!inter) return NodeFilter.FILTER_REJECT;
        return inter >= 0.5 * b.width * b.height || inter >= 0.5 * boxArea ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const items = [];
    let covered = null;
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (covered && covered.contains(el)) continue;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role');
      let line = null, label = null;
      if (/^h[1-6]$/.test(tag) || role === 'heading') line = `heading: ${oneLine(el.textContent)}`;
      else if (tag === 'a' && el.getAttribute('href')) {
        const href = el.getAttribute('href');
        label = `link: ${oneLine(accessibleName(el) || el.textContent, 80)}`;
        line = `${label} → ${href.length > 80 ? href.slice(0, 80) + '…' : href}`;
      } else if (tag === 'button' || role === 'button' || tag === 'summary') {
        const open = tag === 'summary' && el.parentElement && el.parentElement.tagName === 'DETAILS' ? (el.parentElement.open ? ' (open)' : ' (closed)') : '';
        line = `${tag === 'summary' ? 'disclosure' : 'button'}: ${oneLine(accessibleName(el) || el.textContent, 80)}${open}`;
      }
      else if (tag === 'input' || tag === 'select' || tag === 'textarea') line = `${tag}${el.type ? `[${el.type}]` : ''}: ${oneLine(accessibleName(el) || el.value, 80)}`;
      else if (tag === 'img' || tag === 'svg' && el.getAttribute('aria-label')) line = `image: ${oneLine(accessibleName(el), 80) || '(no alt text)'}`;
      else if (hasOwnText(el) && getComputedStyle(el).display !== 'inline') line = oneLine(el.innerText || el.textContent);
      if (!line) continue;
      covered = el;
      items.push({ el, line, label });
    }
    return items;
  }

  // The closest common parent of everything in the box. The box's corners often
  // land in page margins, which would make that <body>.
  function commonParent(els) {
    let common = els[0];
    while (common && !els.every(el => common.contains(el))) common = common.parentElement;
    return common;
  }

  const NESTING = 'details, ul, ol, dl, table, section, article, nav, aside, fieldset, [role="group"], [role="tree"], [role="list"]';

  // One line per item, indented by how deeply it is nested inside the container, so
  // an item sitting inside the wrong section shows up as indented under it. A link
  // label repeated on every item ("Read more") is listed once.
  function outlineBox(items, container) {
    const depth = (el) => {
      let d = 0;
      for (let n = el.parentElement; n && n !== container; n = n.parentElement) if (n.matches(NESTING)) d++;
      return d;
    };
    const counts = new Map();
    items.forEach(it => { if (it.label) counts.set(it.label, (counts.get(it.label) || 0) + 1); });
    const seen = new Set();
    const kept = items.filter(it => {
      if (!it.label || counts.get(it.label) < 3) return true;
      if (seen.has(it.label)) return false;
      seen.add(it.label);
      return true;
    });
    const depths = kept.map(it => depth(it.el));
    const min = Math.min(...depths);
    const lines = kept.slice(0, MAX_OUTLINE).map((it, i) => '  '.repeat(Math.min(depths[i] - min, 6)) + it.line);
    if (kept.length > MAX_OUTLINE) lines.push(`… ${kept.length - MAX_OUTLINE} more`);
    counts.forEach((n, label) => { if (n >= 3) lines.push(`(${label} appears ${n} times, once per item; listed once)`); });
    return lines;
  }

  function cropImage(dataUrl, r, margin = 32) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width / window.innerWidth;
        const x = Math.max(0, (r.x - margin) * scale);
        const y = Math.max(0, (r.y - margin) * scale);
        const w = Math.min(img.width - x, (r.width + 2 * margin) * scale);
        const h = Math.min(img.height - y, (r.height + 2 * margin) * scale);
        const c = document.createElement('canvas');
        c.width = Math.round(w); c.height = Math.round(h);
        c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function recordBox(r) {
    commitVoiceSegment();
    const items = boxContents(r);
    const container = (items.length && commonParent(items.map(it => it.el))) || boxContainer(r);
    const outline = outlineBox(items, container);
    const data = {
      box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      selector: getSelector(container),
      info: await describeElement(container),
      outline,
    };
    const full = await grabViewport([], [r], { sharp: true });
    if (full) data.dataUrl = (await cropImage(full, r)) || full;
    addEvent('box', data);
  }

  // ═══════════════════════════════════════════════
  // Voice — Continuous Soniox streaming via offscreen document
  // Voice runs continuously when reviewer is active.
  // Clicks, boxes, page changes and notes commit the current voice segment, so speech
  // and actions interleave in the order they happened.
  // ═══════════════════════════════════════════════
  let voiceAccumulated = ''; // final tokens since last commit
  let voiceInterim = '';     // current tentative tokens
  let voiceFrom = null;      // when the uncommitted speech began
  let voiceWords = [];       // final tokens with the time they were spoken: { t, at, end }
  const WORD_JOIN_MS = 15000;

  // Words arrive one to three seconds after they are spoken, often after the click or
  // page change that followed them. Words spoken before the latest event go back in
  // front of it, so the live panel matches the export. A token without a leading space
  // finishes the word the previous segment was cut off in ("con" + "text").
  function placeEarlyWords(words) {
    let idx = state.timeline.findLastIndex(e => e.type !== 'voice');
    if (idx < 0 || voiceAccumulated) return '';
    const pageChange = state.timeline[idx].type === 'navigation';
    // A link click and the page load it caused act as one boundary.
    const link = state.timeline[idx - 1];
    if (explains(link, state.timeline[idx])) idx--;
    const boundary = Date.parse(state.timeline[idx].timestamp);
    const before = state.timeline[idx - 1];
    const early = [];
    // A sentence cut off by a page change finishes on the page where it began.
    let carry = pageChange && before && before.type === 'voice' && !SENTENCE_END.test(before.text.trim());
    while (words.length) {
      const w = words[0];
      const spokenBefore = w.at && w.at < boundary;
      const continuesWord = !/^\s/.test(w.t) && (early.length || (before && before.type === 'voice'));
      const finishesSentence = carry && w.at && w.at <= boundary + SENTENCE_CARRY_MS;
      if (!spokenBefore && !continuesWord && !finishesSentence) break;
      early.push(words.shift());
      if (!spokenBefore && SENTENCE_END.test(w.t.trim())) carry = false;
    }
    if (!early.length) return '';
    const text = early.map(w => w.t).join('');
    if (before && before.type === 'voice') {
      before.text = (before.text + text).trim();
      before.words = [...(before.words || []), ...early];
    } else {
      const at = early[0].at || boundary;
      const evt = state.timeline[idx];
      state.timeline.splice(idx, 0, {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'voice',
        text: text.trim(),
        from: new Date(at).toISOString(),
        timestamp: new Date(Math.min(boundary, early[early.length - 1].end || at)).toISOString(),
        url: evt.type === 'navigation' ? ((before && before.url) || state.pageUrl) : evt.url,
        words: early,
      });
    }
    renderTimeline(); renderMiniFeed(); persist();
    return text;
  }

  function receiveSpeech(finalText, interimText = '', words = []) {
    if (words.length && words.every(w => w.at)) {
      const moved = placeEarlyWords(words);
      finalText = finalText.slice(moved.length);
    } else if (finalText && !voiceAccumulated) {
      const frag = finalText.match(/^[^\s]+/);
      const last = state.timeline.findLast(e => e.type === 'voice');
      if (frag && last && Date.now() - new Date(last.timestamp) < WORD_JOIN_MS) {
        last.text += frag[0];
        finalText = finalText.slice(frag[0].length);
        renderTimeline(); renderMiniFeed(); persist();
      }
    }
    if (!voiceFrom && (finalText + interimText).trim()) voiceFrom = new Date(words[0] && words[0].at ? Math.min(words[0].at, Date.now()) : Date.now()).toISOString();
    voiceAccumulated += finalText;
    voiceWords.push(...words);
    voiceInterim = interimText;
    updatePendingDisplay();
  }

  // Names and labels on the page (headings, menus, disclosures, table headers, links),
  // given to Soniox so it recognises them when the reviewer reads them out. The
  // offscreen document keeps them for the whole review.

  function pageTerms() {
    const out = [];
    const add = (t) => {
      t = (t || '').replace(/\s+/g, ' ').replace(/\s+\d+(\s+\p{L}+)?$/u, '').trim(); // drop counts like "9 planer"
      if (t.length >= 3 && t.length <= 60 && /\p{L}/u.test(t) && !out.includes(t)) out.push(t);
    };
    document.title.split(/\s[·|–—-]\s/).forEach(add);
    document.querySelectorAll('h1, h2, h3, h4, nav a, summary, th, button, [role="tab"], label, dt, caption, a').forEach(el => {
      if (out.length < 200 && !isOurElement(el)) add(el.innerText || el.textContent);
    });
    return out;
  }

  function sonioxContext() {
    const terms = pageTerms();
    const site = document.title.split(/\s[·|–—-]\s/).pop() || location.hostname;
    return {
      general: [{ key: 'domain', value: 'Website review' }, { key: 'topic', value: site }],
      text: `Someone reviews the website "${site}" out loud, in English or Norwegian, reading out names, headings and labels from its pages.`,
      terms,
    };
  }

  function startVoice() {
    state.recording = true;
    btnVoice.classList.add('recording');
    tlPending.style.display = 'flex';
    tlPendingText.textContent = 'Listening...';
    // Not cleared: after a page load, words may already have arrived from the running stream.
    voiceInterim = '';
    updatePendingDisplay();
    chrome.runtime.sendMessage({ type: 'start-soniox', context: sonioxContext() });
  }

  function stopVoice() {
    commitVoiceSegment();
    state.recording = false;
    btnVoice.classList.remove('recording');
    tlPending.style.display = 'none';
    chrome.runtime.sendMessage({ type: 'stop-soniox' });
  }

  function toggleVoice() {
    if (state.recording) stopVoice();
    else startVoice();
  }

  // Commit current accumulated voice text as a timeline event
  // Called automatically before annotations/screenshots to interleave events
  function commitVoiceSegment() {
    const text = voiceAccumulated.trim();
    if (text) addEvent('voice', { text, from: voiceFrom, words: voiceWords });
    voiceAccumulated = '';
    voiceWords = [];
    voiceInterim = '';
    // Words still being recognised belong to the next segment, which starts now.
    voiceFrom = null;
    updatePendingDisplay();
  }

  function updatePendingDisplay() {
    if (!state.recording) { tlPending.style.display = 'none'; return; }
    tlPending.style.display = 'flex';
    const display = (voiceAccumulated + voiceInterim).trim();
    tlPendingText.textContent = display || 'Listening...';
  }

  // ═══════════════════════════════════════════════
  // Screenshots
  // ═══════════════════════════════════════════════
  // Hides the reviewer UI, outlines the given elements and rectangles, captures the
  // visible tab and puts everything back the way it was.
  // Full-screen shots are scaled to CSS pixels, so their coordinates match the box and
  // element sizes in the review and an agent reads a quarter of the pixels of a Retina
  // capture. Box crops keep the full resolution.
  async function grabViewport(outlineEls = [], outlineRects = [], { sharp = false } = {}) {
    const hidden = [toolbar, noteForm, timelinePanel, miniFeed, toastEl, helpOverlay, boxRect].map(el => [el, el.style.display]);
    hidden.forEach(([el]) => (el.style.display = 'none'));
    const rects = [
      ...outlineEls.filter(el => el && el.isConnected).map(el => {
        const b = el.getBoundingClientRect();
        return { x: b.left, y: b.top, width: b.width, height: b.height };
      }),
      ...outlineRects,
    ];
    const burnIns = rects.map(r => {
      const box = document.createElement('div');
      box.className = 'wr-burn-in';
      box.style.cssText = `position:fixed;z-index:2147483644;pointer-events:none;top:${r.y}px;left:${r.x}px;width:${r.width}px;height:${r.height}px;border:2px solid #ef4444;background:rgba(239,68,68,0.04);border-radius:2px;`;
      document.body.appendChild(box);
      return box;
    });

    // On a busy page the hidden UI is not painted for a while, and the capture would show
    // the last painted frame with the toolbar in it: wait for two frames, then a little.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))));
    let dataUrl = null;
    // captureVisibleTab allows two calls a second, so a page shot right after a click can fail once.
    for (let attempt = 0; attempt < 2 && !dataUrl; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 600));
      try {
        const response = await chrome.runtime.sendMessage({ type: 'capture-screenshot' });
        dataUrl = (response && response.dataUrl) || null;
      } catch {}
    }

    burnIns.forEach(b => b.remove());
    hidden.forEach(([el, display]) => (el.style.display = display));
    return dataUrl && !sharp ? toCssPixels(dataUrl) : dataUrl;
  }

  function toCssPixels(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        if (img.width <= window.innerWidth * 1.1) { resolve(dataUrl); return; }
        const c = document.createElement('canvas');
        c.width = window.innerWidth;
        c.height = Math.round(img.height * window.innerWidth / img.width);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function captureScreenshot() {
    commitVoiceSegment();
    const dataUrl = await grabViewport();
    if (!dataUrl) { showToast('Screenshot failed'); return; }

    const hash = await computeDHash(dataUrl);
    if (hash !== null && lastScreenshotHash !== null && hammingDistance(hash, lastScreenshotHash) <= 4) {
      showToast('Skipped - nearly identical to previous screenshot');
      return;
    }
    lastScreenshotHash = hash;

    addEvent('screenshot', {
      dataUrl,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      devicePixelRatio: window.devicePixelRatio,
    });
    timelinePanel.style.display = 'block';
    showToast('Screenshot added to timeline');
  }

  // ═══════════════════════════════════════════════
  // Export
  // ═══════════════════════════════════════════════
  function trunc(text, n) {
    return text.length > n ? text.substring(0, n) + '…' : text;
  }

  const SLOW_ARRIVAL_MS = 3000;
  const mdTimes = (evt) => evt.count > 1 ? ` · clicked ${evt.count} times in ${secs(Date.parse(evt.lastAt) - Date.parse(evt.timestamp))}` : '';
  const secs = (ms) => (ms / 1000).toFixed(1) + ' s';

  // Milliseconds from the start of the navigation, i.e. from the click or Enter.
  function mdLoad(load) {
    return [`first byte ${secs(load.firstByte)}`, `page ready ${secs(load.ready)}`, load.loaded && `fully loaded ${secs(load.loaded)}`]
      .filter(Boolean).join(' · ');
  }

  // Clicks and boxes cut the speech into pieces in the timeline; here a remark reads as
  // one sentence again, with each action as a marker where it happened.
  function mdTranscript(visits) {
    const q = (t) => `"${trunc(String(t || '').replace(/\s+/g, ' ').trim(), 50)}"`;
    const name = (info) => info ? `<${info.tag}>${info.name || info.text ? ' ' + q(info.name || info.text) : ''}` : '';
    const marker = (evt) => {
      const t = elapsed(evt.timestamp);
      switch (evt.type) {
        case 'reference': return `[${t} ${evt.isLink ? 'clicked link' : 'pointed at'} ${name(evt.info)}${evt.toggled ? ', ' + evt.toggled : ''}${evt.count > 1 ? `, ×${evt.count}` : ''}${evt.isLink ? (evt.newTab ? ', new tab' : ', no page load') : ''}]`;
        case 'box': return `[${t} box${evt.info && evt.info.heading ? ` under ${q(evt.info.heading)}` : ''}]`;
        case 'selection': return `[${t} selected ${q(evt.text)}]`;
        case 'change': return `[${t} set ${name(evt.info)} to ${q(evt.value)}]`;
        case 'note': return `[${t} typed note: ${evt.text}]`;
        case 'away': return `[${t}${evt.until ? '–' + elapsed(evt.until).slice(1) : ''} on another tab]`;
        case 'console': return `[${t} console ${evt.kind}]`;
        case 'screenshot': return `[${t} screenshot]`;
        default: return `[${t} ${evt.type}]`;
      }
    };
    // A remark that runs on across a page change stays in one paragraph, with the new page
    // marked where it opened.
    let md = '';
    let open = false; // the last paragraph ended mid-sentence
    visits.forEach(v => {
      if (!v.events.some(e => e.type === 'voice' || REMARK_TYPES.includes(e.type) || e.type === 'change')) return;
      const start = v.nav ? v.nav.timestamp : state.startedAt;
      const head = `${elapsed(start)} · Page ${pad(v.page, 2)}`;
      const text = v.events.map(e => e.type === 'voice' ? e.text.trim() : marker(e)).join(' ');
      if (open) md = md.replace(/\n\n$/, '') + ` [${head} \`${shortUrl(v.url)}\`] ${text}\n\n`;
      else md += `**${head}** \`${shortUrl(v.url)}\`\n\n${text}\n\n`;
      const last = v.events[v.events.length - 1];
      open = !!last && last.type === 'voice' && !SENTENCE_END.test(last.text.trim());
    });
    return md;
  }

  function mdHeadline(info) {
    const name = info.name || info.text;
    return '`<' + info.tag + '>`' + (name ? ` "${trunc(name, 60)}"` : '');
  }

  function mdElement(info, selector) {
    let md = '';
    const c = info.components;
    if (c && c.components.length) {
      md += `- **Component:** ${c.components.map(n => '`' + n + '`').join(' ← ')}${c.source ? ` · \`${c.source}\`` : ''}\n`;
    } else if (c && c.source) {
      md += `- **Source:** \`${c.source}\`\n`;
    }
    const ident = [];
    if (info.testId) ident.push(`testid=\`${info.testId}\``);
    if (info.id) ident.push(`id=\`${info.id}\``);
    if (info.role) ident.push(`role=${info.role}`);
    if (info.classes) ident.push(`classes=\`${trunc(info.classes, 80)}\``);
    ident.push(`${info.width}×${info.height}px`);
    md += `- **Element:** ${ident.join(' · ')}\n`;
    const where = [info.landmark, info.heading && `under heading "${info.heading}"`].filter(Boolean);
    if (where.length) md += `- **Where:** ${where.join(' · ')}\n`;
    const squash = (t) => (t || '').replace(/\s+/g, '');
    if (info.text && info.name && squash(info.text) !== squash(info.name)) md += `- **Contains:** "${trunc(info.text, 100)}"\n`;
    md += `- **Selector:** \`${selector}\`\n`;
    return md;
  }

  function visitedPages() {
    return [...new Set([state.pageUrl, ...state.timeline.map(e => e.url)])];
  }

  const REMARK_TYPES = ['voice', 'note', 'reference', 'box', 'selection', 'screenshot', 'annotation', 'drawing'];
  const LINK_TO_PAGE_MS = 5000;
  const SLOW_LINK_MS = 30000; // a link to the very page that loaded can be this slow
  const pad = (n, w) => String(n).padStart(w, '0');

  function sameOrigin(a, b) {
    try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
  }

  // A link click directly followed by the page load it caused.
  function explains(link, nav) {
    if (!link || !nav || link.type !== 'reference' || !link.isLink || nav.type !== 'navigation' || nav.kind === 'back/forward') return false;
    return leadsTo(link, nav) || (!link.newTab && sameOrigin(link.href, nav.url) &&
      Date.parse(nav.timestamp) - Date.parse(link.timestamp) < LINK_TO_PAGE_MS);
  }

  // Whether a link click explains a page load: same address (ignoring the fragment and a
  // trailing slash), not in a new tab, and recent enough.
  function leadsTo(link, nav) {
    if (!link.href || link.newTab) return false;
    const key = (u) => { const x = new URL(u); return x.origin + x.pathname.replace(/\/$/, '') + x.search; };
    let same = false;
    try { same = key(link.href) === key(nav.url); } catch {}
    const ms = Date.parse(nav.timestamp) - Date.parse(link.timestamp);
    return same && ms >= 0 && ms < SLOW_LINK_MS;
  }

  // A voice entry is committed when the next click or page change happens, but Soniox
  // finalises words one to three seconds after they are spoken. So the entry after a
  // click can open with words said before it, and the first entry on a new page with
  // the end of a remark about the previous one. At export every word is placed by the
  // time it was spoken, and a sentence cut off by a page change finishes on the page
  // where it began.
  const SENTENCE_CARRY_MS = 4000;
  const SENTENCE_END = /[.?!…]["»”)]?$/;

  function voiceBySpokenTime(timeline) {
    const voices = timeline.filter(e => e.type === 'voice');
    if (!voices.length || voices.some(v => !v.words || !v.words.length)) return timeline;
    const others = timeline.filter(e => e.type !== 'voice');

    // Tokens without a leading space continue the previous word.
    const words = [];
    let lastAt = null;
    const toks = voices.flatMap(v => v.words.map(w => ({ ...w, at: w.at || null, fallback: Date.parse(v.from || v.timestamp) })));
    toks.forEach(tok => { tok.at = tok.at || lastAt || tok.fallback; lastAt = tok.at; });
    // When the connection is replaced for new vocabulary, the old one's last words can
    // arrive after the new one's first.
    toks.sort((a, b) => a.at - b.at);
    toks.forEach(tok => {
      const last = words[words.length - 1];
      if (last && !/^\s/.test(tok.t)) { last.t += tok.t; last.end = tok.end || last.end; }
      else words.push({ t: tok.t, at: tok.at, end: tok.end || tok.at });
    });

    // A link click and the page load it caused act as one boundary.
    const isVia = (i) => explains(others[i], others[i + 1]);
    const runs = others.map(() => []).concat([[]]); // runs[i]: speech before others[i]
    let slot = 0;
    words.forEach(w => {
      while (slot < others.length && new Date(others[slot].timestamp).getTime() <= w.at) slot++;
      runs[slot > 0 && isVia(slot - 1) ? slot - 1 : slot].push(w);
    });

    others.forEach((evt, n) => {
      if (evt.type !== 'navigation') return;
      const b = n > 0 && isVia(n - 1) ? n - 1 : n;
      const before = runs[b], after = runs[n + 1];
      if (!before.length || !after.length || SENTENCE_END.test(before[before.length - 1].t.trim())) return;
      const limit = new Date(others[b].timestamp).getTime() + SENTENCE_CARRY_MS;
      while (after.length && after[0].at <= limit) {
        const w = after.shift();
        before.push(w);
        if (SENTENCE_END.test(w.t.trim())) break;
      }
    });

    const out = [];
    const iso = (ms) => new Date(ms).toISOString();
    runs.forEach((run, i) => {
      if (run.length) {
        const prev = out[out.length - 1];
        out.push({
          id: 'voice-' + run[0].at,
          type: 'voice',
          text: run.map(w => w.t).join('').trim(),
          from: iso(run[0].at),
          timestamp: iso(Math.max(run[run.length - 1].end, run[0].at)),
          url: prev ? prev.url : state.pageUrl,
        });
      }
      if (others[i]) out.push(others[i]);
    });
    return out;
  }

  // Splits the timeline into page visits. A visit opens with its navigation event;
  // a link click just before it becomes the way the reviewer got there.
  function buildVisits(timeline) {
    const visits = [];
    const pageNums = new Map();
    const open = (nav, url) => {
      if (!pageNums.has(url)) pageNums.set(url, pageNums.size + 1);
      const v = { nav, url, page: pageNums.get(url), events: [], via: null };
      visits.push(v);
      return v;
    };
    let cur = null;
    timeline.forEach(evt => {
      if (evt.type === 'navigation') {
        const prevEvents = cur ? cur.events : [];
        cur = open(evt, evt.url);
        if (evt.kind === 'back/forward') return;
        // The latest link to this address, even with other clicks after it while the page
        // was loading. Without a match, a same-site link clicked just before (a redirect).
        let i = prevEvents.findLastIndex(e => e.type === 'reference' && e.isLink && leadsTo(e, evt));
        if (i < 0 && explains(prevEvents[prevEvents.length - 1], evt)) i = prevEvents.length - 1;
        if (i >= 0) cur.via = prevEvents.splice(i, 1)[0];
        return;
      }
      if (!cur) cur = open(null, state.pageUrl); // timelines from before page visits were recorded
      cur.events.push(evt);
    });
    return visits;
  }

  // File names for every screenshot: page shots by page number, the rest in order.
  function assignFiles(visits) {
    const files = {};
    const perPage = {};
    let n = 0;
    visits.forEach(v => {
      if (v.nav && v.nav.dataUrl) {
        perPage[v.page] = (perPage[v.page] || 0) + 1;
        const k = perPage[v.page];
        files[v.nav.id] = `pages/${pad(v.page, 2)}${k > 1 ? '-' + k : ''}.jpg`;
      }
      v.events.forEach(evt => {
        if (!evt.dataUrl) return;
        n++;
        files[evt.id] = `screenshots/${pad(n, 3)}.${evt.dataUrl.startsWith('data:image/png') ? 'png' : 'jpg'}`;
      });
    });
    visits.forEach(v => { if (v.nav && v.nav.sameAs && files[v.nav.sameAs]) files[v.nav.id] = files[v.nav.sameAs]; });
    return files;
  }

  function buildPages(visits, files, endIso) {
    const pages = new Map();
    visits.forEach((v, i) => {
      const start = v.nav ? v.nav.timestamp : state.startedAt;
      const end = visits[i + 1] ? (visits[i + 1].via || visits[i + 1].nav).timestamp : endIso;
      if (!pages.has(v.page)) pages.set(v.page, { page: v.page, url: v.url, title: '', visits: [], remarks: 0, screenshots: [] });
      const p = pages.get(v.page);
      if (!p.title && v.nav && v.nav.title) p.title = v.nav.title;
      p.visits.push(`${elapsed(start)}–${elapsed(end).slice(1)}`);
      p.remarks += v.events.filter(e => REMARK_TYPES.includes(e.type)).length;
      const f = v.nav && files[v.nav.id];
      if (f && !p.screenshots.includes(f)) p.screenshots.push(f);
    });
    return [...pages.values()];
  }

  function shortUrl(url) {
    try {
      const u = new URL(url);
      return u.origin === new URL(state.pageUrl).origin ? (u.pathname + u.search + u.hash) : url;
    } catch { return url; }
  }

  function mdQuote(text) {
    return text.split('\n').map(l => '> ' + l.trim()).join('\n');
  }

  function generateMarkdown(timeline, visits, files, pages, now) {
    const errors = state.consoleLog.filter(c => c.level === 'error').length;
    const warnings = state.consoleLog.filter(c => c.level === 'warn').length;

    // The first page visit, not where the extension was switched on: nothing may have been said there.
    const first = visits.find(v => v.nav) || null;
    const firstUrl = first ? first.url : state.pageUrl;
    const firstTitle = (first && first.nav.title) || state.pageTitle;
    let md = `# Webapp Review: ${firstTitle}\n\n`;
    md += `**Started on:** ${firstUrl}\n`;
    md += `**Date:** ${state.startedAt || now}\n`;
    md += `**Duration:** ${elapsed(now).slice(1)}\n`;
    md += `**Pages:** ${pages.length} (${visits.length} visits)\n`;
    const builds = [...new Set(visits.map(v => v.nav && v.nav.build).filter(Boolean))];
    if (builds.length) md += `**Site build:** ${builds.join('; then ')}\n`;
    md += `**Console:** ${state.consoleLog.length ? `${errors} errors, ${warnings} warnings, ${state.consoleLog.length} entries in \`console.log\`` : 'no entries captured'}\n\n`;
    md += `How to read this: the timeline is grouped by page visit. Speech is the main feedback; each voice entry is placed by when it was spoken, between the clicks and page changes around it. It is live speech recognition: expect thinking aloud, half sentences and misheard words (read a word that makes no sense as the similar-sounding word that fits the page). A click ("Pointed at"), box or text selection marks what the reviewer meant by the speech just before and after it. A remark often trails onto the next page or comes a moment after the click it refers to. Voice headings show when the speech started and ended. Every page has a screenshot taken about a second after it loaded, at the top of the page, in \`pages/\`: open one when a remark is about the page as a whole or you need its layout, and skip pages with no remarks, which the reviewer only passed through. Clicks and boxes carry their own screenshots in \`screenshots/\`, taken at the moment of the click or box. A link click that led to a page is folded into that page's "Arrived by clicking" (with a warning when the page took 3 s or more to appear); a "Clicked link" entry shows the link's target and that no page load followed, which is what a complaint that a link \"doesn't work\" usually refers to. Page visits from a click or address bar show how long the load took. "On another tab" spans mean the reviewer was looking at another tab (often a link that opened in a new tab), and remarks made then are about that. \`timeline.json\` has the same events as data.\n\n`;

    md += `## Pages\n\n| Page | Title | URL | Time | Remarks | Screenshot |\n|---|---|---|---|---|---|\n`;
    pages.forEach(p => {
      const cell = (t) => String(t || '').replace(/\|/g, '\\|');
      md += `| ${pad(p.page, 2)} | ${cell(p.title)} | ${cell(shortUrl(p.url))} | ${p.visits.join(', ')} | ${p.remarks || '—'} | ${p.screenshots.map(f => '`' + f + '`').join(' ') || '—'} |\n`;
    });
    md += `\n## Transcript\n\nThe speech page by page, unbroken, with what the reviewer did in brackets. Read this first for the feedback, then look an item up in the Timeline by its time for the element, link target and screenshot.\n\n`;
    md += mdTranscript(visits);
    md += `\n## Timeline\n\n`;

    let shotIdx = 0;
    const image = (evt) => {
      if (!files[evt.id]) return '';
      shotIdx++;
      return `![Screenshot ${shotIdx}](${files[evt.id]})\n\n`;
    };
    const seenPages = new Set();

    visits.forEach(v => {
      const again = seenPages.has(v.page);
      seenPages.add(v.page);
      const start = v.nav ? v.nav.timestamp : state.startedAt;
      const title = (v.nav && v.nav.title) || '';
      md += `### ${elapsed(start)} · Page ${pad(v.page, 2)}${again ? ' again' : ''}${title ? ' · ' + title : ''}\n\n`;
      md += `\`${v.url}\`\n\n`;
      if (v.via) {
        const where = [v.via.info.landmark, v.via.info.heading && `under heading "${v.via.info.heading}"`].filter(Boolean).join(' · ');
        const wait = v.nav ? Date.parse(v.nav.timestamp) - Date.parse(v.via.timestamp) : 0;
        md += `- **Arrived by clicking** ${mdHeadline(v.via.info)}${where ? ' in ' + where : ''} · \`${v.via.selector}\`` +
          mdTimes(v.via) + (wait >= SLOW_ARRIVAL_MS ? ` · **the page appeared ${secs(wait)} after the click**` : '') + '\n';
      } else if (v.nav) {
        md += `- **Arrived by:** ${{ start: 'start of review', 'page load': 'page load (address bar, reload or form)', 'in-page': 'in-page route change', 'back/forward': 'back/forward' }[v.nav.kind] || v.nav.kind}\n`;
      }
      if (v.nav) {
        const f = files[v.nav.id];
        if (f && v.nav.sameAs) md += `- **Page screenshot:** \`${f}\` (unchanged since the earlier visit)\n`;
        else if (f) md += `- **Page screenshot:** \`${f}\`\n`;
        else md += `- **Page screenshot:** none (left the page or switched tab before it was taken)\n`;
        if (v.nav.load) md += `- **Load:** ${mdLoad(v.nav.load)}\n`;
        if (builds.length > 1 && v.nav.build) md += `- **Build:** ${v.nav.build}\n`;
      }
      md += '\n';

      v.events.forEach(evt => {
        const t = elapsed(evt.timestamp);
        if (evt.type === 'voice') {
          const from = evt.from ? elapsed(evt.from) : null;
          md += `#### ${from && from !== t ? `${from}–${t.slice(1)}` : t} — Voice\n\n${evt.text}\n\n`;
        } else if (evt.type === 'note') {
          md += `#### ${t} — Typed note\n\n${evt.text}\n\n`;
        } else if (evt.type === 'reference') {
          const did = evt.toggled ? ` (the click ${evt.toggled} it)` : '';
          const went = evt.isLink ? (evt.newTab ? ' (opens in a new tab)' : ' (no page load followed in this tab)') : '';
          md += `#### ${t} — ${evt.isLink ? 'Clicked link' : 'Pointed at'} ${mdHeadline(evt.info)}${did}${went}${mdTimes(evt)}\n\n`;
          if (evt.href) md += `- **Link to:** \`${shortUrl(evt.href)}\`\n`;
          md += mdElement(evt.info, evt.selector) + '\n';
          md += image(evt);
        } else if (evt.type === 'box') {
          md += `#### ${t} — Box${evt.info && evt.info.heading ? ` under heading "${evt.info.heading}"` : ''}\n\n`;
          md += `- **Area:** ${evt.box.width}×${evt.box.height}px at ${evt.box.x},${evt.box.y} in a ${evt.viewport.width}×${evt.viewport.height} viewport${evt.scroll && evt.scroll.y ? `, scrolled ${evt.scroll.y}px` : ''}\n`;
          md += `- **Container** (closest parent of everything in the box): ${mdHeadline(evt.info)}\n`;
          md += mdElement({ ...evt.info, text: null }, evt.selector);
          if (evt.outline.length) md += `- **Inside** (indented by nesting):\n` + evt.outline.map(l => {
            const indent = l.match(/^ */)[0];
            return `  ${indent}- ${l.trim()}`;
          }).join('\n') + '\n';
          md += '\n' + image(evt);
        } else if (evt.type === 'change') {
          md += `#### ${t} — Set ${mdHeadline(evt.info)} to "${evt.value}"\n\n` + mdElement(evt.info, evt.selector) + '\n';
        } else if (evt.type === 'away') {
          md += `#### ${evt.until ? `${t}–${elapsed(evt.until).slice(1)}` : t} — On another tab or window\n\n` +
            `The reviewer looked at something outside this page${evt.until ? ` for ${Math.round((Date.parse(evt.until) - Date.parse(evt.timestamp)) / 1000)} s` : ''}; speech in this span is probably about it (often a link that opened in a new tab).\n\n`;
        } else if (evt.type === 'selection') {
          md += `#### ${t} — Selected text in \`${evt.selector}\`\n\n${mdQuote(evt.text)}\n\n`;
        } else if (evt.type === 'console') {
          const label = { console: 'console.error', uncaught: 'uncaught error', unhandledrejection: 'unhandled promise rejection', network: 'network failure', resource: 'failed resource' }[evt.kind] || evt.kind;
          md += `#### ${t} — Console: ${label}${evt.count > 1 ? ` (×${evt.count})` : ''}\n\n`;
          md += '```\n' + trunc(evt.text, 1500) + '\n```\n\n';
        } else if (evt.type === 'screenshot') {
          md += `#### ${t} — Screenshot of the whole screen\n\n`;
          md += image(evt);
          const meta = [`Viewport: ${evt.viewport.width}x${evt.viewport.height}`];
          if (evt.scroll && (evt.scroll.x || evt.scroll.y)) meta.push(`Scroll: ${evt.scroll.x},${evt.scroll.y}`);
          md += `*${meta.join(' · ')}*\n\n`;
        } else if (evt.type === 'annotation') {
          md += `#### ${t} — Note on ${mdHeadline(evt.info)}\n\n${evt.notes}\n\n` + mdElement(evt.info, evt.selector) + '\n';
        } else if (evt.type === 'drawing') {
          md += `#### ${t} — Drawing${evt.info ? ' around ' + mdHeadline(evt.info) : ''}\n\n`;
          if (evt.info) md += mdElement(evt.info, evt.selector);
          md += '\n' + image(evt);
        }
      });
    });

    if (timeline.length === 0) md += `*No events recorded.*\n`;
    return md;
  }

  function buildTimelineJson(timeline, visits, files, pages, now) {
    const pageOf = new Map();
    visits.forEach(v => {
      if (v.nav) pageOf.set(v.nav.id, v.page);
      if (v.via) pageOf.set(v.via.id, v.page);
      v.events.forEach(e => pageOf.set(e.id, v.page));
    });
    return {
      startedOn: (visits.find(v => v.nav) || { url: state.pageUrl }).url,
      title: ((visits.find(v => v.nav) || {}).nav || {}).title || state.pageTitle,
      startedAt: state.startedAt,
      exportedAt: now,
      pages,
      events: timeline.map(evt => {
        const { hasShot, shotPending, shotHash, words, ...rest } = serializeEvent(evt);
        return {
          elapsed: elapsed(evt.timestamp),
          page: pageOf.get(evt.id),
          ...rest,
          ...(files[evt.id] ? { screenshot: files[evt.id] } : {}),
        };
      }),
    };
  }

  function buildConsoleLog() {
    return state.consoleLog.map(c =>
      `[${elapsed(c.timestamp)}] ${c.level.toUpperCase()} ${c.kind} ${c.url}\n${c.text}\n`
    ).join('\n');
  }

  async function exportReview() {
    commitVoiceSegment();
    const now = new Date().toISOString();
    const timeline = voiceBySpokenTime(state.timeline);
    const visits = buildVisits(timeline);
    const files = assignFiles(visits);
    const pages = buildPages(visits, files, now);
    const screenshots = {};
    state.timeline.forEach(evt => { if (evt.dataUrl && files[evt.id]) screenshots[files[evt.id]] = evt.dataUrl; });

    const markdown = generateMarkdown(timeline, visits, files, pages, now);
    const session = `review-${now.replace(/[:.]/g, '-').substring(0, 19)}`;
    const firstVisit = visits.find(v => v.nav);
    const metadata = {
      url: firstVisit ? firstVisit.url : state.pageUrl,
      title: (firstVisit && firstVisit.nav.title) || state.pageTitle,
      date: state.startedAt || now,
      eventCount: state.timeline.length,
      pages: pages.map(p => p.url),
    };

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'save-review',
        data: { session, markdown, screenshots, metadata, timeline: buildTimelineJson(timeline, visits, files, pages, now), consoleLog: buildConsoleLog() },
      });
      if (response && response.path) {
        const mdPath = response.path + '/review.md';
        try { await navigator.clipboard.writeText(mdPath); } catch {}
        await clearTimeline();
        showToast(`Saved, path copied: ${mdPath}`);
        return;
      }
    } catch {}

    // If saving failed the screenshots would be lost, so the timeline is kept.
    try { await navigator.clipboard.writeText(markdown); } catch {}
    showToast('Could not save - markdown copied, timeline kept. Run install.sh and export again.');
  }

  async function clearTimeline() {
    commitVoiceSegment();
    state.timeline = [];
    state.consoleLog = [];
    state.startedAt = null;
    state.pageUrl = state.lastUrl = location.href;
    state.pageTitle = document.title;
    await clearStorage();
    renderTimeline();
    renderMiniFeed();
  }

  // ═══════════════════════════════════════════════
  // Help
  // ═══════════════════════════════════════════════
  helpOverlay.addEventListener('click', () => (helpOverlay.style.display = 'none'));

  // ═══════════════════════════════════════════════
  // Keyboard Shortcuts
  // ═══════════════════════════════════════════════
  function handleKeydown(e) {
    if (!state.active) return;

    const tag = e.target.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
    // Keys typed in the note box reach this listener with the shadow host as target.
    const isOurInput = e.target === host && shadow.activeElement === noteTextarea;

    if (isInput && !isOurInput) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (helpOverlay.style.display !== 'none') helpOverlay.style.display = 'none';
      else if (noteForm.style.display !== 'none') hideNoteForm();
      else if (timelinePanel.style.display === 'block') timelinePanel.style.display = 'none';
      else if (state.mode) exitMode();
      return;
    }

    if (isOurInput) return;

    if (e.key === '?' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      helpOverlay.style.display = helpOverlay.style.display === 'none' ? 'flex' : 'none';
      return;
    }

    // e.code, not e.key: on macOS Option+letter produces characters like ∂ and ≈.
    if (e.altKey) {
      switch (e.code) {
        case 'KeyT': e.preventDefault(); toggleNoteForm(); break;
        case 'KeyS': e.preventDefault(); captureScreenshot(); break;
        case 'KeyN': e.preventDefault(); toggleTimeline(); break;
        case 'KeyX': e.preventDefault(); exportReview(); break;
      }
    }
  }

  document.addEventListener('keydown', handleKeydown, true);


  // ═══════════════════════════════════════════════
  // Click-to-reference & text selection capture
  // Clicking a page element inserts a "reference" event; selecting text a "selection".
  // ═══════════════════════════════════════════════
  document.addEventListener('click', (e) => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    // Not gated on voice: it starts a second or two after the review does, and a click
    // in that gap (often the link to the first page discussed) would be lost.
    if (!state.active || state.mode) return;
    if (isOurElement(e.target)) return;
    const el = e.target;
    if (el === document.body || el === document.documentElement) return;
    commitVoiceSegment();
    recordReference(el);
  }, true);

  async function recordReference(el) {
    // A link may unload the page, so record and save before any async work.
    const link = el.closest('a[href]');
    const isLink = !!link;
    const selector = getSelector(el);
    // Opening and closing a native dropdown are both clicks; the choice is recorded as a change.
    if (el.closest('select')) {
      const prev = state.timeline.findLast(e => e.type === 'reference' || e.type === 'change');
      if (prev && prev.selector === selector && Date.now() - Date.parse(prev.timestamp) < SELECT_REPEAT_MS) return;
    }
    // Clicking the same thing again and again (a link that seems dead) is one entry with a count.
    const prev = state.timeline.findLast(e => e.type !== 'voice');
    if (prev && prev.type === 'reference' && prev.selector === selector && !prev.toggled && !el.closest('summary, [aria-expanded]') &&
        Date.now() - Date.parse(prev.lastAt || prev.timestamp) < REPEAT_CLICK_MS) {
      prev.count = (prev.count || 1) + 1;
      prev.lastAt = new Date().toISOString();
      renderTimeline(); renderMiniFeed();
      if (isLink) flushPersist(); else persist();
      return;
    }
    const newTab = isLink && link.target === '_blank';
    const evt = addEvent('reference', { selector, info: getElementInfo(el), ...(isLink ? { isLink, href: link.href, ...(newTab ? { newTab } : {}) } : {}) });
    if (isLink) flushPersist();

    const components = await inspectComponents(el);
    if (components) evt.info.components = components;
    // By now the click's default action has run, so a disclosure shows its new state.
    const summary = el.closest('summary');
    const expander = el.closest('[aria-expanded]');
    if (summary && summary.parentElement && summary.parentElement.tagName === 'DETAILS') evt.toggled = summary.parentElement.open ? 'opened' : 'closed';
    else if (expander) evt.toggled = expander.getAttribute('aria-expanded') === 'true' ? 'opened' : 'closed';
    if (!isLink) {
      const dataUrl = await grabViewport([el]);
      if (dataUrl) evt.dataUrl = dataUrl;
    }
    renderTimeline();
    renderMiniFeed();
    persist();
  }

  // ═══════════════════════════════════════════════
  // Navigation & console (console entries come from page-probe.js)
  // ═══════════════════════════════════════════════
  let navTimer = null;
  function onNavigatedSoon(url) {
    clearTimeout(navTimer);
    navTimer = setTimeout(() => { navTimer = null; onNavigated(url, 'in-page'); }, 1000);
  }

  function onNavigated(url, kind) {
    if (!state.active || url === state.lastUrl) return;
    state.lastUrl = url;
    addNavigation(url, kind);
  }

  // Every page visit is a navigation event that also gets a screenshot of the page
  // once it has settled, so remarks about a whole page have something to point at.
  function addNavigation(url, kind) {
    commitVoiceSegment();
    const evt = addEvent('navigation', { url, kind, title: document.title, shotPending: true });
    setTimeout(() => capturePage(evt.id), PAGE_SHOT_DELAY);
  }

  // A version the page states about itself, so a review can be tied to a build.
  function siteBuild() {
    const names = ['generator', 'version', 'app-version', 'build', 'build-id', 'commit', 'revision'];
    const found = names.map(n => {
      const m = document.querySelector(`meta[name="${n}" i]`);
      return m && m.content ? `${n}: ${m.content.trim().slice(0, 80)}` : null;
    }).filter(Boolean);
    const d = document.documentElement.dataset;
    ['build', 'version', 'commit'].forEach(k => { if (d[k]) found.push(`data-${k}: ${d[k].slice(0, 80)}`); });
    return found.join(' · ');
  }

  const PAGE_SHOT_DELAY = 600; // the content script runs once the page has loaded

  async function capturePage(id) {
    const find = () => state.timeline.find(e => e.id === id); // restore() replaces event objects
    let evt = find();
    if (!evt || !state.active) return;
    // SPAs usually update the title after the route change.
    if (document.title && document.title !== evt.title) evt.title = document.title;
    // Remarks about speed need numbers. Only a full load has its own timing entry; a page
    // restored by back/forward or changed in place would report an older load.
    const build = siteBuild();
    if (build) evt.build = build;
    const timing = performance.getEntriesByType('navigation')[0];
    if (timing && (evt.kind === 'page load' || evt.kind === 'start') && evt.url === location.href) {
      evt.load = {
        firstByte: Math.round(timing.responseStart),
        ready: Math.round(timing.domContentLoadedEventEnd),
        ...(timing.loadEventEnd ? { loaded: Math.round(timing.loadEventEnd) } : {}),
      };
    }
    if (state.recording) chrome.runtime.sendMessage({ type: 'soniox-context', context: sonioxContext() }).catch(() => {});
    if (location.href !== evt.url || document.visibilityState !== 'visible') {
      delete evt.shotPending; renderTimeline(); renderMiniFeed(); persist();
      return;
    }
    const dataUrl = await grabViewport();
    evt = find();
    if (!evt) return;
    delete evt.shotPending;
    if (dataUrl) {
      const hash = await computeDHash(dataUrl);
      // A revisit that looks the same reuses the earlier screenshot.
      const earlier = hash === null ? null : state.timeline.find(e =>
        e.type === 'navigation' && e.id !== id && e.url === evt.url && e.shotHash &&
        hammingDistance(hash, BigInt('0x' + e.shotHash)) <= 4);
      if (earlier) evt.sameAs = earlier.id;
      else {
        evt.dataUrl = dataUrl;
        if (hash !== null) evt.shotHash = hash.toString(16);
      }
    }
    renderTimeline();
    renderMiniFeed();
    persist();
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__wr !== 'console' || !state.active) return;
    // The page can post anything on this channel, so only well-formed entries get in.
    const raw = e.data.entry;
    if (!raw || typeof raw.text !== 'string' || !CONSOLE_LEVELS.includes(raw.level)) return;
    const entry = {
      level: raw.level,
      kind: CONSOLE_KINDS.includes(raw.kind) ? raw.kind : 'console',
      text: raw.text.slice(0, 4000),
      url: location.href,
      timestamp: new Date().toISOString(),
    };
    state.consoleLog.push(entry);
    if (state.consoleLog.length > 2000) state.consoleLog.shift();
    if (entry.level !== 'error') { persist(); return; }

    // Repeated identical errors (render loops, polling) collapse into one event.
    const last = state.timeline.findLast(ev => ev.type === 'console');
    if (last && last.text === entry.text && Date.now() - new Date(last.lastAt || last.timestamp) < 10000) {
      last.count++;
      last.lastAt = entry.timestamp;
      renderTimeline();
      persist();
    } else if (state.timeline.filter(ev => ev.type === 'console').length < MAX_CONSOLE_EVENTS) {
      addEvent('console', { level: entry.level, kind: entry.kind, text: entry.text, count: 1 });
    } else {
      persist(); // still in console.log
    }
  });

  const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
  const CONSOLE_KINDS = ['console', 'uncaught', 'unhandledrejection', 'network', 'resource'];
  const MAX_CONSOLE_EVENTS = 100;
  let voiceLost = false;

  window.addEventListener('pagehide', () => {
    if (state.active) commitVoiceSegment();
    flushPersist();
  });
  // Back/forward cache: this reviewer was frozen while another page updated the stored timeline.
  window.addEventListener('pageshow', async (e) => {
    if (!e.persisted || !state.active) return;
    let hello = null;
    try { hello = await chrome.runtime.sendMessage({ type: 'hello' }); } catch {}
    if (!hello || !hello.active) {
      // Stopped on another page: this frozen copy must not overwrite the stored timeline.
      state.tabId = null;
      deactivate();
      return;
    }
    await restore();
    if (location.href !== state.lastUrl) {
      state.lastUrl = location.href;
      addNavigation(location.href, 'back/forward');
    }
  });

  // A selection stays in place across later clicks (and comes back with the page on
  // back/forward), so it is recorded only when it differs from the last one recorded.
  let lastSelection = null;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) lastSelection = null;
  });

  document.addEventListener('mouseup', () => {
    if (!state.active || boxStart) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().trim();
    if (text.length < 3 || text === lastSelection) return;

    const common = sel.getRangeAt(0).commonAncestorContainer;
    const el = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
    if (!el || isOurElement(el)) return;

    lastSelection = text;
    commitVoiceSegment();
    addEvent('selection', { text, selector: getSelector(el) });
  });

  // What the reviewer chose or typed in a form: filters that apply without changing the
  // URL, and search terms, would otherwise only show in the next screenshot.
  const SELECT_REPEAT_MS = 5000;
  const REPEAT_CLICK_MS = 8000;
  document.addEventListener('change', (e) => {
    if (!state.active || state.mode) return;
    const el = e.target;
    if (!el || isOurElement(el) || !['SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName)) return;
    if (el.type === 'password' || el.type === 'hidden' || el.type === 'file') return;
    let value;
    if (el.tagName === 'SELECT') value = [...el.selectedOptions].map(o => o.text.trim()).join(', ');
    else if (el.type === 'checkbox' || el.type === 'radio') value = el.checked ? 'checked' : 'unchecked';
    else value = el.value;
    commitVoiceSegment();
    addEvent('change', { selector: getSelector(el), info: getElementInfo(el), value: String(value).slice(0, 500) });
  }, true);

  // Time on another tab or window: remarks made then are about what was in front, often
  // a link that opened in a new tab. Hiding for a page load is not recorded, because the
  // page is gone before the check runs.
  let hiddenAt = null;
  let hiddenTimer = null;
  document.addEventListener('visibilitychange', () => {
    if (!state.active) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = new Date().toISOString();
      hiddenTimer = setTimeout(() => {
        hiddenTimer = null;
        commitVoiceSegment();
        addEvent('away', { timestamp: hiddenAt });
      }, 1000);
    } else if (hiddenAt) {
      clearTimeout(hiddenTimer);
      const away = !hiddenTimer && state.timeline.findLast(e => e.type === 'away' && !e.until);
      if (away) { away.until = new Date().toISOString(); renderTimeline(); renderMiniFeed(); persist(); }
      // A page left for another tab before its screenshot gets one now.
      const nav = state.timeline.findLast(e => e.type === 'navigation');
      if (nav && nav.url === location.href && !nav.dataUrl && !nav.sameAs && !nav.shotPending) setTimeout(() => capturePage(nav.id), PAGE_SHOT_DELAY);
      hiddenTimer = null;
      hiddenAt = null;
    }
  });
  window.addEventListener('pagehide', () => { clearTimeout(hiddenTimer); hiddenTimer = null; hiddenAt = null; });

  // ═══════════════════════════════════════════════
  // Extension Messages
  // ═══════════════════════════════════════════════
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'toggle':
        if (state.active) deactivate(); else activate();
        sendResponse({ active: state.active });
        break;
      case 'status':
        sendResponse({ active: state.active, eventCount: state.timeline.length });
        break;
      case 'take-screenshot':
        captureScreenshot();
        sendResponse({ ok: true });
        break;
      case 'export':
        exportReview();
        sendResponse({ ok: true });
        break;
      case 'navigated':
        // Apps that sync state into the URL fire this on every keystroke; record where it settles.
        onNavigatedSoon(msg.url);
        break;
      case 'soniox-tokens':
        // Late words from a connection being replaced carry no interim text of their own.
        receiveSpeech(msg.finalText, msg.keepInterim ? voiceInterim : msg.interimText, msg.finalWords || []);
        break;
      case 'soniox-status':
        // Connections are replaced on most page loads; only a lost one is worth saying.
        if (msg.connected === false && state.recording) { voiceLost = true; showToast('Voice reconnecting...'); }
        if (msg.connected === true && voiceLost) { voiceLost = false; showToast('Voice back'); }
        break;
      case 'voice-error':
        showToast('Voice: ' + msg.error);
        state.recording = false;
        btnVoice.classList.remove('recording');
        tlPending.style.display = 'none';
        break;
    }
  });

  // ═══════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════
  async function checkHost() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'check-host' });
      return !!(r && r.ok);
    } catch {}
    return false;
  }

  async function activate({ bufferedVoice = '', bufferedWords = [], resumed = false } = {}) {
    state.active = true;
    document.body.appendChild(host);
    document.body.appendChild(boxLayer);
    document.body.appendChild(boxRect);
    root.style.display = 'block';
    if (!state.startedAt) {
      state.pageUrl = state.lastUrl = location.href;
      state.pageTitle = document.title;
    }
    // The review starts now, on this page: it is the first page visit.
    if (!state.timeline.length) addNavigation(location.href, 'start');

    chrome.runtime.sendMessage({ type: 'set-active', active: true }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'inject-probe' })
      .then(() => window.postMessage({ __wr: 'console-hello' }, '*'))
      .catch(() => {});

    const hostReady = await checkHost();
    if (hostReady) {
      if (!resumed) showToast('Reviewing: talk, click, ⌥-drag to box an area. ? for help');
      // Auto-start continuous voice
      startVoice();
      // Speech captured while the new page was loading came before anything received since
      if (bufferedVoice) {
        if (voiceAccumulated) { voiceAccumulated = bufferedVoice + voiceAccumulated; voiceWords = [...bufferedWords, ...voiceWords]; updatePendingDisplay(); }
        else receiveSpeech(bufferedVoice, '', bufferedWords);
      }
    } else {
      showToast('Active, but saving is not set up. Run install.sh from the webapp-reviewer folder');
    }
  }

  function deactivate() {
    state.active = false;
    exitMode();
    hideNoteForm();
    timelinePanel.style.display = 'none';
    helpOverlay.style.display = 'none';
    voiceIndicator.style.display = 'none';
    if (state.recording) stopVoice();
    chrome.runtime.sendMessage({ type: 'set-active', active: false }).catch(() => {});
    window.postMessage({ __wr: 'console-bye' }, '*');
    flushPersist();

    root.style.display = 'none';
    host.remove();
    boxStart = null;
    boxLayer.style.display = 'none';
    boxRect.style.display = 'none';
    boxLayer.remove();
    boxRect.remove();
  }

  window.__webappReviewer = { toggle: () => (state.active ? deactivate() : activate()) };

  const STALE_MS = 2 * 60 * 60 * 1000;

  (async () => {
    let hello = null;
    try { hello = await chrome.runtime.sendMessage({ type: 'hello' }); } catch {}
    if (!hello) { activate(); return; }

    state.tabId = hello.tabId;
    const restored = await restore();
    if (restored) {
      const lastAt = state.timeline.length ? state.timeline[state.timeline.length - 1].timestamp : state.startedAt;
      if (!hello.active && lastAt && Date.now() - new Date(lastAt) > STALE_MS) {
        // Leftovers from an old, never-exported review in this tab
        await clearTimeline();
      } else if (location.href !== state.lastUrl) {
        state.lastUrl = location.href;
        addNavigation(location.href, 'page load');
      }
    }
    activate({ bufferedVoice: hello.bufferedVoice, bufferedWords: hello.bufferedWords || [], resumed: restored && hello.active });
  })();
})();
