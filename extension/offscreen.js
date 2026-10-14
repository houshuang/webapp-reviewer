// Offscreen document — Soniox streaming transcription
// Handles getUserMedia + AudioContext + WebSocket in extension's secure context.

let mediaStream = null;
let audioCtx = null;
let sourceNode = null;
let scriptNode = null;
let recording = false;
let tabId = null;
let apiKey = null;

const MODEL = 'stt-rt-v5';
const FALLBACK_MODEL = 'stt-rt-preview';
let model = MODEL;
let context = null;  // { general, text, terms } built from the pages under review
let session = null;  // the connection audio currently goes to
let contextRejected = false;

function downsample(input, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const len = Math.floor(input.length / ratio);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return out;
}

function cleanToken(text) {
  return text.replace(/<\/?fin>/gi, '').replace(/<[^>]*>/g, '');
}

function sendToTab(type, data) {
  if (!tabId) return;
  chrome.runtime.sendMessage({ target: 'background', type, tabId, ...data });
}

// One Soniox connection. Its context (the vocabulary of the pages reviewed so far) is
// fixed when it opens, so new vocabulary opens a new connection: audio switches over
// at once, and the old connection is told the audio has ended and keeps delivering
// its last words until Soniox reports it finished.
//
// Soniox times tokens in milliseconds of audio received on the connection. Audio
// stops while paused and the keepalive adds silence, so audio time drifts from the
// clock; each chunk sent records where its audio starts and when it was captured.
function openSession() {
  if (!apiKey) { sendToTab('voice-error', { error: 'No Soniox API key' }); return null; }
  const s = {
    ws: new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket'),
    model, context,
    audioMs: 0,
    anchors: [],  // [audio ms at chunk start, wall-clock ms when it was captured]
    pending: [],  // audio captured while the connection opens
    open: false,
    ending: false,
    spoke: false, // has delivered a final word
    keepalive: null,
  };
  s.ws.onopen = () => {
    s.ws.send(JSON.stringify({
      api_key: apiKey,
      model: s.model,
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      language_hints: ['en', 'no'],
      ...(s.context ? { context: s.context } : {}),
    }));
    s.open = true;
    s.pending.forEach(([pcm, at]) => sendTo(s, pcm, at));
    s.pending = [];
    s.keepalive = setInterval(() => {
      if (s === session && !recording) sendTo(s, new Int16Array(160), Date.now());
    }, 10000);
    if (s === session) sendToTab('soniox-status', { connected: true });
  };
  s.ws.onmessage = (e) => onSonioxMessage(s, e);
  s.ws.onerror = (err) => console.error('Soniox error:', err);
  s.ws.onclose = () => {
    clearInterval(s.keepalive);
    if (s !== session) return;
    session = null;
    sendToTab('soniox-status', { connected: false });
    if (tabId) setTimeout(() => { if (tabId && !session) session = openSession(); }, s.retryNow ? 0 : 3000);
  };
  return s;
}

function sendTo(s, pcm16, capturedAt) {
  if (!s.open) {
    s.pending.push([pcm16, capturedAt]);
    if (s.pending.length > 400) s.pending.shift(); // about 30 s
    return;
  }
  if (s.ws.readyState !== WebSocket.OPEN) return;
  s.anchors.push([s.audioMs, capturedAt]);
  if (s.anchors.length > 2000) s.anchors = s.anchors.slice(-1000);
  s.audioMs += (pcm16.length / 16000) * 1000;
  s.ws.send(pcm16.buffer);
}

function sendAudio(pcm16, capturedAt) {
  if (session) sendTo(session, pcm16, capturedAt);
}

function endSession(s) {
  if (!s || s.ending) return;
  s.ending = true;
  if (s.open && s.ws.readyState === WebSocket.OPEN) {
    s.ws.send(''); // end of audio: Soniox finalises what it has and replies "finished"
    setTimeout(() => s.ws.close(), 8000);
  } else s.ws.close();
}

function spokenAt(s, ms) {
  const a = s.anchors;
  if (typeof ms !== 'number' || !a.length || ms < a[0][0]) return null;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (a[mid][0] <= ms) lo = mid; else hi = mid - 1;
  }
  return Math.round(a[lo][1] + (ms - a[lo][0]));
}

function onSonioxMessage(s, e) {
  let data;
  try { data = JSON.parse(e.data); } catch { return; }
  if (data.error_code != null) {
    console.warn('Soniox:', data.error_code, data.error_message);
    // A rejected request is most likely the context or the model name: retry without
    // the context, then with the older model, before giving up as before.
    if (s === session && (data.error_code === 400 || data.error_code === 'invalid_request')) {
      if (context) { context = null; contextRejected = true; }
      else if (model !== FALLBACK_MODEL) model = FALLBACK_MODEL;
      else return;
      s.retryNow = true;
      s.ws.close();
    }
    return;
  }
  if (data.tokens && data.tokens.length) {
    let finalText = '';
    let interimText = '';
    const finalWords = [];
    for (const tok of data.tokens) {
      let text = cleanToken(tok.text);
      if (!text) continue;
      if (tok.is_final) {
        // A connection's first word has no leading space; without one it would be read
        // as the end of the last word from the connection it replaced ("open.To").
        if (!s.spoke && !/^\s/.test(text)) text = ' ' + text;
        s.spoke = true;
        finalText += text;
        finalWords.push({ t: text, at: spokenAt(s, tok.start_ms), end: spokenAt(s, tok.end_ms) });
      } else if (s === session) interimText += text;
    }
    if (finalText || s === session) sendToTab('soniox-tokens', { finalText, interimText, finalWords, keepInterim: s !== session });
  }
  if (data.finished) s.ws.close();
}

function onAudio(e, nativeSR) {
  if (!recording) return;
  e.outputBuffer.getChannelData(0).fill(0);
  const input = e.inputBuffer.getChannelData(0);
  const capturedAt = Date.now() - (input.length / nativeSR) * 1000;
  sendAudio(downsample(input, nativeSR, 16000), capturedAt);
}

// New vocabulary from a reviewed page, added to that of earlier pages (newest first,
// within Soniox's limit of about 10,000 characters). Reconnecting loses no audio,
// but is only worth it when the page added terms the current connection lacks.
const MAX_TERMS_CHARS = 6000;

function setContext(ctx) {
  if (!ctx || !ctx.terms || contextRejected) return;
  const old = (context && context.terms) || [];
  const known = new Set(old);
  const added = ctx.terms.filter(t => !known.has(t)).length;
  let chars = 0;
  const terms = [...ctx.terms, ...old.filter(t => !ctx.terms.includes(t))]
    .filter(t => (chars += t.length + 4) <= MAX_TERMS_CHARS);
  context = { ...ctx, terms };
  if (!session || added < 5 || !tabId) return;
  const previous = session;
  session = openSession();
  endSession(previous);
}

async function startRecording(tid, key, ctx) {
  tabId = tid;
  apiKey = key;
  if (ctx) setContext(ctx);

  // Already streaming (the reviewer resumed after a page load): keep the same stream.
  if (mediaStream && audioCtx) {
    if (!recording) resumeRecording();
    else sendToTab('soniox-status', { recording: true });
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    sendToTab('voice-error', { error: 'Mic permission needed - click the extension icon first to grant access' });
    return;
  }

  audioCtx = new AudioContext();
  recording = true;

  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
  const nativeSR = audioCtx.sampleRate;

  scriptNode.onaudioprocess = (e) => onAudio(e, nativeSR);

  sourceNode.connect(scriptNode);
  scriptNode.connect(audioCtx.destination);

  if (!session) session = openSession();

  sendToTab('soniox-status', { recording: true });
}

function pauseRecording() {
  recording = false;
  if (scriptNode) { scriptNode.disconnect(); scriptNode = null; }
  if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
  sendToTab('soniox-status', { recording: false });
}

function resumeRecording() {
  if (!mediaStream || !audioCtx) return;
  recording = true;

  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
  const nativeSR = audioCtx.sampleRate;

  scriptNode.onaudioprocess = (e) => onAudio(e, nativeSR);

  sourceNode.connect(scriptNode);
  scriptNode.connect(audioCtx.destination);
  sendToTab('soniox-status', { recording: true });
}

function stopRecording() {
  recording = false;
  if (scriptNode) { scriptNode.disconnect(); scriptNode = null; }
  if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  tabId = null;
  const s = session;
  session = null;
  if (s) { clearInterval(s.keepalive); s.ws.close(); }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  switch (msg.type) {
    case 'start-soniox':
      startRecording(msg.tabId, msg.apiKey, msg.context);
      sendResponse({ ok: true });
      break;
    case 'pause-soniox':
      pauseRecording();
      sendResponse({ ok: true });
      break;
    case 'resume-soniox':
      resumeRecording();
      sendResponse({ ok: true });
      break;
    case 'set-context':
      setContext(msg.context);
      sendResponse({ ok: true });
      break;
    case 'stop-soniox':
      stopRecording();
      sendResponse({ ok: true });
      break;
  }
});
