// Webapp Reviewer — Background Service Worker

// ── Offscreen document management ───────────────
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Audio capture and Soniox streaming transcription',
    });
  }
}

// ── Native messaging host ───────────────────────
// Chrome starts assets/native-host.js on demand (registered by install.sh).
const NATIVE_HOST = 'webapp_reviewer';

function nativeRequest(message) {
  return new Promise(resolve => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, reply => {
      resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : reply);
    });
  });
}

// Sends messages in order over one port, resolving with the last reply or the first error.
function nativeSequence(messages) {
  return new Promise(resolve => {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    let i = 0;
    let done = false;
    const finish = (result) => { if (done) return; done = true; port.disconnect(); resolve(result); };
    port.onMessage.addListener(reply => {
      if (reply.error || ++i === messages.length) return finish(reply);
      port.postMessage(messages[i]);
    });
    port.onDisconnect.addListener(() => {
      finish({ error: chrome.runtime.lastError?.message || 'native host disconnected' });
    });
    port.postMessage(messages[0]);
  });
}

let cachedSonioxKey = null;

async function getSonioxKey() {
  if (cachedSonioxKey) return cachedSonioxKey;
  const reply = await nativeRequest({ type: 'get-key' });
  if (reply?.key) cachedSonioxKey = reply.key;
  return cachedSonioxKey;
}

async function saveReview({ session, markdown, screenshots, metadata, timeline, consoleLog }) {
  const names = Object.keys(screenshots || {});
  return nativeSequence([
    { type: 'begin', session, markdown, timeline, consoleLog, metadata: { ...metadata, screenshotCount: names.length } },
    ...names.map(name => ({ type: 'screenshot', session, name, dataUrl: screenshots[name] })),
    { type: 'finish', session },
  ]);
}

// ── Review sessions that survive navigation ─────
// A tab with an active review is remembered in session storage. When it loads a
// new document the background re-injects the page probe and the reviewer, which
// restores its timeline from chrome.storage.local.
const bufferedVoice = new Map(); // tabId -> final transcript received while no content script was listening

const activeKey = (tabId) => `wr:active:${tabId}`;

async function isActive(tabId) {
  const key = activeKey(tabId);
  const data = await chrome.storage.session.get(key);
  return !!data[key];
}

async function injectProbe(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['page-probe.js'],
    world: 'MAIN',
    injectImmediately: true,
  }).catch(() => {});
}

// While any review is active the probe is registered to run at document_start, so
// console output from the first scripts on a newly loaded page is not missed.
// It only buffers until a reviewer on that page asks for the entries.
const PROBE_ID = 'wr-page-probe';

async function syncProbeRegistration() {
  const all = await chrome.storage.session.get(null);
  const anyActive = Object.keys(all).some(k => k.startsWith('wr:active:'));
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [PROBE_ID] })).length > 0;
  if (anyActive && !registered) {
    await chrome.scripting.registerContentScripts([{
      id: PROBE_ID, js: ['page-probe.js'], matches: ['<all_urls>'],
      runAt: 'document_start', world: 'MAIN', persistAcrossSessions: false,
    }]).catch(() => {});
  } else if (!anyActive && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [PROBE_ID] }).catch(() => {});
  }
}

// DOMContentLoaded rather than load: a hanging image or ad would otherwise keep the
// reviewer away for as long as it hangs.
chrome.webNavigation.onDOMContentLoaded.addListener(async ({ tabId, frameId }) => {
  if (frameId !== 0 || !(await isActive(tabId))) return;
  // The flag stops a reviewer that is still alive (bfcache restore) from toggling off.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { window.__wrResume = true; },
  }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
});

function notifyNavigation({ tabId, frameId, url }) {
  if (frameId !== 0) return;
  chrome.tabs.sendMessage(tabId, { type: 'navigated', url }).catch(() => {});
}
chrome.webNavigation.onHistoryStateUpdated.addListener(notifyNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(notifyNavigation);

// Tab ids restart after a browser restart and onRemoved never fired for the old tabs,
// so stored timelines from the previous run would attach to unrelated new tabs.
chrome.runtime.onStartup.addListener(async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('wr:'));
  if (keys.length) await chrome.storage.local.remove(keys);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  bufferedVoice.delete(tabId);
  await chrome.storage.session.remove(activeKey(tabId));
  await syncProbeRegistration();
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(`wr:${tabId}:`));
  if (keys.length) await chrome.storage.local.remove(keys);
});

// ── Message handling ────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Reviewer startup: who am I, was a review running, any speech captured mid-load?
  if (msg.type === 'hello') {
    const tabId = sender.tab.id;
    isActive(tabId).then(active => {
      const voice = bufferedVoice.get(tabId) || { text: '', words: [] };
      bufferedVoice.delete(tabId);
      sendResponse({ tabId, active, bufferedVoice: voice.text, bufferedWords: voice.words });
    });
    return true;
  }

  if (msg.type === 'set-active') {
    const tabId = sender.tab.id;
    const op = msg.active
      ? chrome.storage.session.set({ [activeKey(tabId)]: true })
      : chrome.storage.session.remove(activeKey(tabId));
    op.then(syncProbeRegistration).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'inject-probe') {
    injectProbe(sender.tab.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  // Screenshots
  if (msg.type === 'capture-screenshot') {
    // captureVisibleTab is limited to two calls a second; a failed capture returns null.
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 85 }, (dataUrl) => {
      sendResponse({ dataUrl: chrome.runtime.lastError ? null : dataUrl });
    });
    return true;
  }

  if (msg.type === 'save-review') {
    saveReview(msg.data).then(sendResponse);
    return true;
  }

  if (msg.type === 'check-host') {
    nativeRequest({ type: 'get-key' }).then(reply => sendResponse({ ok: !reply?.error, error: reply?.error }));
    return true;
  }

  // Start Soniox streaming: content → background → offscreen
  if (msg.type === 'start-soniox') {
    (async () => {
      const apiKey = await getSonioxKey();
      if (!apiKey) {
        // Send error back to content script
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'voice-error',
          error: 'No Soniox API key. Add SONIOX_KEY=... to the .env file in the webapp-reviewer folder',
        });
        sendResponse({ ok: false });
        return;
      }
      await ensureOffscreen();
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'start-soniox',
        tabId: sender.tab.id,
        apiKey,
        context: msg.context,
      });
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Vocabulary of a newly visited page, for recognising its names and terms
  if (msg.type === 'soniox-context') {
    (async () => {
      await ensureOffscreen();
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'set-context', context: msg.context });
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Pause/resume/stop Soniox
  if (msg.type === 'pause-soniox' || msg.type === 'resume-soniox' || msg.type === 'stop-soniox') {
    (async () => {
      await ensureOffscreen();
      chrome.runtime.sendMessage({ target: 'offscreen', type: msg.type });
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Offscreen -> background -> content: forward Soniox tokens/status/errors
  if (msg.target === 'background' && msg.tabId) {
    const fwd = (payload) => chrome.tabs.sendMessage(msg.tabId, payload);
    if (msg.type === 'soniox-tokens') {
      // While the tab is loading a new page there is no content script to receive
      // final tokens; keep them so the resumed reviewer can pick them up.
      fwd({ type: 'soniox-tokens', finalText: msg.finalText, interimText: msg.interimText, finalWords: msg.finalWords, keepInterim: msg.keepInterim }).catch(() => {
        if (!msg.finalText) return;
        const b = bufferedVoice.get(msg.tabId) || { text: '', words: [] };
        b.text += msg.finalText;
        b.words.push(...(msg.finalWords || []));
        bufferedVoice.set(msg.tabId, b);
      });
      return;
    }
    if (msg.type === 'soniox-status') {
      fwd({ type: 'soniox-status', connected: msg.connected, recording: msg.recording }).catch(() => {});
    }
    if (msg.type === 'voice-error') {
      fwd({ type: 'voice-error', error: msg.error }).catch(() => {});
    }
  }
});

// ── Keyboard shortcut commands ──────────────────
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (command === 'toggle-reviewer') {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'toggle' });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
    }
  }

  if (command === 'take-screenshot') {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'take-screenshot' });
    } catch {}
  }
});
