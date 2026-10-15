// Chrome cannot show a permission prompt in an action popup or an offscreen document,
// so the microphone is granted here, in a normal tab of the extension's own origin.
// The offscreen document then uses that grant.
const result = document.getElementById('result');

async function allow() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    result.textContent = 'Granted. You can close this tab and start the review again.';
    result.className = 'ok';
    setTimeout(() => window.close(), 1500);
  } catch {
    result.textContent = 'Blocked. Click the icon at the left of the address bar, allow Microphone, then try again.';
    result.className = 'denied';
  }
}

document.getElementById('allow').addEventListener('click', allow);
allow();
