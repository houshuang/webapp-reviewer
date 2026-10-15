const toggleBtn = document.getElementById('toggle');
const statusEl = document.getElementById('status');
const micStatus = document.getElementById('mic-status');

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// A popup cannot show the permission prompt, so an ungranted microphone is asked for
// in a tab (mic.html); the offscreen document shares that grant.
async function ensureMicPermission() {
  if (await checkMicPermission()) return true;
  chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') });
  return false;
}

async function checkMicPermission() {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    if (result.state === 'granted') {
      micStatus.textContent = 'Microphone: granted';
      micStatus.className = 'mic-ok';
      return true;
    } else if (result.state === 'denied') {
      micStatus.textContent = 'Microphone: blocked - click Start to fix';
      micStatus.className = 'mic-denied';
      return false;
    } else {
      micStatus.textContent = 'Microphone: not yet allowed - click Start';
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
  if (!(await ensureMicPermission())) { window.close(); return; }

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
