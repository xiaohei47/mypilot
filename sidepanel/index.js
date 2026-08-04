const messages = document.body.querySelector('#messages');
const chatForm = document.body.querySelector('#chat-form');
const input = document.body.querySelector('#input');
const sendButton = document.body.querySelector('#send');
const stopButton = document.body.querySelector('#stop');
const statusEl = document.body.querySelector('#status');

let running = false;

input.addEventListener('input', () => {
  sendButton.disabled = !input.value.trim();
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || running) {
    return;
  }
  input.value = '';
  sendButton.disabled = true;
  addMessage('user', text);
  running = true;
  stopButton.hidden = false;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'agent-run', text });
    if (!response || !response.ok) {
      addMessage('system', `错误：${response ? response.error : '无法连接到 service worker'}`);
    }
  } catch (error) {
    addMessage('system', `错误：${error.message}`);
  }
});

stopButton.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'agent-stop' });
});

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'connection-status':
      updateStatus(message.connected);
      break;
    case 'agent-message':
      addMessage(message.role, message.text);
      break;
    case 'agent-done':
      running = false;
      stopButton.hidden = true;
      sendButton.disabled = !input.value.trim();
      break;
    case 'agent-error':
      addMessage('system', `错误：${message.text}`);
      running = false;
      stopButton.hidden = true;
      sendButton.disabled = !input.value.trim();
      break;
  }
});

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = new Date().toLocaleTimeString();
  const body = document.createElement('div');
  body.textContent = text;
  el.appendChild(meta);
  el.appendChild(body);
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

function updateStatus(connected) {
  statusEl.textContent = connected ? '已连接' : '未连接';
  statusEl.className = `status ${connected ? 'connected' : ''}`;
}

void chrome.runtime.sendMessage({ type: 'connection-status' }).then((response) => {
  if (response) {
    updateStatus(response.connected);
  }
});
