const toggleBtn = document.getElementById('toggle');
const statusEl = document.getElementById('status');
const micStatus = document.getElementById('mic-status');

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Request microphone permission from the popup (has user gesture context).
// The offscreen document inherits this grant since it shares the extension origin.
async function ensureMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Immediately stop — we just needed the permission grant
    stream.getTracks().forEach(t => t.stop());
    micStatus.textContent = 'Microphone: granted';
    micStatus.className = 'mic-ok';
    return true;
  } catch (err) {
    micStatus.textContent = 'Microphone: denied - voice won\'t work';
    micStatus.className = 'mic-denied';
    return false;
  }
}

async function checkMicPermission() {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    if (result.state === 'granted') {
      micStatus.textContent = 'Microphone: granted';
      micStatus.className = 'mic-ok';
      return true;
    } else if (result.state === 'denied') {
      micStatus.textContent = 'Microphone: denied - check site settings';
      micStatus.className = 'mic-denied';
      return false;
    } else {
      micStatus.textContent = 'Microphone: click Start to grant';
      micStatus.className = 'mic-prompt';
      return false;
    }
  } catch {
    micStatus.textContent = 'Microphone: click Start to grant';
    micStatus.className = 'mic-prompt';
    return false;
  }
}

async function checkStatus() {
  const tab = await getTab();
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
    if (response && response.active) {
      toggleBtn.textContent = 'Stop Review';
      toggleBtn.className = 'danger';
      statusEl.textContent = response.eventCount
        ? `Active - ${response.eventCount} event${response.eventCount > 1 ? 's' : ''}`
        : 'Active - no events yet';
    }
  } catch {}
}

toggleBtn.addEventListener('click', async () => {
  // Ensure mic permission before starting (popup has user gesture)
  await ensureMicPermission();

  const tab = await getTab();
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'toggle' });
    if (response && !response.active) {
      window.close();
      return;
    }
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  }
  window.close();
});

// chrome:// pages can't be opened by a plain link from an extension popup.
document.getElementById('customize').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

checkMicPermission();
checkStatus();
