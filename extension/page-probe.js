// Webapp Reviewer — Page-world probe
// Runs in the page's own JS world (not the extension's isolated world) so it can see
// console calls, uncaught errors, fetch failures and framework internals on DOM nodes.
// Talks to content.js via window.postMessage, tagged with `__wr`.
(function () {
  'use strict';
  if (window.__wrProbe) return;
  window.__wrProbe = true;

  const MAX_BUFFER = 500;
  const buffer = [];
  let listening = false;

  function fmt(arg) {
    if (arg instanceof Error) return arg.stack || String(arg);
    if (typeof arg === 'string') return arg;
    if (arg instanceof Element) return '<' + arg.tagName.toLowerCase() + (arg.id ? '#' + arg.id : '') + '>';
    try {
      const s = JSON.stringify(arg);
      return s === undefined ? String(arg) : s.slice(0, 2000);
    } catch {
      return String(arg);
    }
  }

  function emit(entry) {
    entry.timestamp = new Date().toISOString();
    entry.url = location.href;
    if (listening) {
      window.postMessage({ __wr: 'console', entry }, '*');
    } else {
      buffer.push(entry);
      if (buffer.length > MAX_BUFFER) buffer.shift();
    }
  }

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level];
    console[level] = function (...args) {
      try { emit({ level, kind: 'console', text: args.map(fmt).join(' ').slice(0, 4000) }); } catch {}
      return original.apply(this, args);
    };
  }

  window.addEventListener('error', (e) => {
    if (e instanceof ErrorEvent) {
      const text = (e.error && e.error.stack) || `${e.message} (${e.filename}:${e.lineno}:${e.colno})`;
      emit({ level: 'error', kind: 'uncaught', text });
    } else if (e.target && e.target !== window && e.target.tagName) {
      const src = e.target.currentSrc || e.target.src || e.target.href || '';
      emit({ level: 'error', kind: 'resource', text: `Failed to load <${e.target.tagName.toLowerCase()}> ${src}` });
    }
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    emit({ level: 'error', kind: 'unhandledrejection', text: 'Unhandled rejection: ' + ((r && r.stack) || fmt(r)) });
  });

  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (input, init) {
      const method = (init && init.method) || (input && input.method) || 'GET';
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      return originalFetch.apply(this, arguments).then(
        (res) => {
          if (res.status >= 400) emit({ level: 'error', kind: 'network', text: `${method} ${url} → ${res.status} ${res.statusText}` });
          return res;
        },
        (err) => {
          if (!(err && err.name === 'AbortError')) emit({ level: 'error', kind: 'network', text: `${method} ${url} → failed: ${err && err.message}` });
          throw err;
        }
      );
    };
  }

  // ── Framework component lookup ─────────────────
  function reactComponents(el) {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (!key) return null;
    const components = [];
    let source = null;
    let fiber = el[key];
    while (fiber && components.length < 6) {
      const t = fiber.type;
      let name = null;
      if (typeof t === 'function') name = t.displayName || t.name;
      else if (t && typeof t === 'object') {
        const inner = t.render || t.type;
        name = t.displayName || (inner && (inner.displayName || inner.name));
      }
      if (name && name.length > 2 && !components.includes(name)) {
        components.push(name);
        if (!source && fiber._debugSource) {
          source = `${fiber._debugSource.fileName}:${fiber._debugSource.lineNumber}`;
        }
      }
      fiber = fiber.return;
    }
    return components.length ? { framework: 'react', components, source } : null;
  }

  function vueComponents(el) {
    let node = el;
    while (node && !node.__vueParentComponent) node = node.parentElement;
    if (!node) return null;
    const components = [];
    let source = null;
    let inst = node.__vueParentComponent;
    while (inst && components.length < 6) {
      const t = inst.type || {};
      const name = t.__name || t.name;
      if (name) components.push(name);
      if (!source && t.__file) source = t.__file;
      inst = inst.parent;
    }
    return components.length ? { framework: 'vue', components, source } : null;
  }

  function svelteComponents(el) {
    let node = el;
    while (node && !node.__svelte_meta) node = node.parentElement;
    const loc = node && node.__svelte_meta && node.__svelte_meta.loc;
    return loc ? { framework: 'svelte', components: [], source: `${loc.file}:${loc.line}` } : null;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.__wr) return;

    if (e.data.__wr === 'console-hello') {
      listening = true;
      buffer.splice(0).forEach(entry => window.postMessage({ __wr: 'console', entry }, '*'));
    } else if (e.data.__wr === 'console-bye') {
      listening = false;
    } else if (e.data.__wr === 'inspect') {
      const el = document.querySelector(`[data-wr-inspect="${e.data.id}"]`);
      let result = null;
      if (el) {
        try { result = reactComponents(el) || vueComponents(el) || svelteComponents(el); } catch {}
      }
      window.postMessage({ __wr: 'inspect-result', id: e.data.id, result }, '*');
    }
  });
})();
