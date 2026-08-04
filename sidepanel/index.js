const messages = document.body.querySelector('#messages');
const chatForm = document.body.querySelector('#chat-form');
const input = document.body.querySelector('#input');
const sendButton = document.body.querySelector('#send');
const stopButton = document.body.querySelector('#stop');
const statusEl = document.body.querySelector('#status');
const settingsPanel = document.body.querySelector('#settings');
const settingsSave = document.body.querySelector('#settings-save');
const settingsCancel = document.body.querySelector('#settings-cancel');
const settingsMsg = document.body.querySelector('#settings-msg');
const apiKeyInput = document.body.querySelector('#api-key');
const baseUrlInput = document.body.querySelector('#base-url');
const modelInput = document.body.querySelector('#model');
const historyPanel = document.body.querySelector('#history');
const historyListEl = document.body.querySelector('#history-list');
const historyNew = document.body.querySelector('#history-new');
const menuWrap = document.body.querySelector('#menu-wrap');
const menuToggle = document.body.querySelector('#menu-toggle');
const menu = document.body.querySelector('#menu');
const menuSettings = document.body.querySelector('#menu-settings');
const menuHistory = document.body.querySelector('#menu-history');
const thinkingEl = document.body.querySelector('#thinking');
const tokensEl = document.body.querySelector('#tokens');

let running = false;
let configured = false;
let streamBody = null;

input.addEventListener('input', () => {
  sendButton.disabled = !input.value.trim();
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

menuToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  menu.hidden = !menu.hidden;
});

document.addEventListener('pointerdown', (event) => {
  const insideMenu = menuWrap.contains(event.target);
  if (!insideMenu) {
    menu.hidden = true;
  }
  if (!insideMenu && !settingsPanel.contains(event.target)) {
    settingsPanel.hidden = true;
  }
  if (!insideMenu && !historyPanel.contains(event.target)) {
    historyPanel.hidden = true;
  }
});

menuSettings.addEventListener('click', () => {
  menu.hidden = true;
  historyPanel.hidden = true;
  settingsPanel.hidden = !settingsPanel.hidden;
});

menuHistory.addEventListener('click', async () => {
  menu.hidden = true;
  settingsPanel.hidden = true;
  historyPanel.hidden = !historyPanel.hidden;
  if (!historyPanel.hidden) {
    await refreshHistory();
  }
});

historyNew.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'history-new' });
  if (response && response.ok) {
    messages.replaceChildren();
    streamBody = null;
    historyPanel.hidden = true;
  }
});

async function refreshHistory() {
  const response = await chrome.runtime.sendMessage({ type: 'history-list' });
  if (!response || !response.list) {
    return;
  }
  historyListEl.replaceChildren();
  for (const c of response.list) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const info = document.createElement('div');
    info.className = 'history-info';
    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = c.title || '(无标题)';
    const time = document.createElement('div');
    time.className = 'history-time';
    time.textContent = new Date(c.updatedAt).toLocaleString();
    info.appendChild(title);
    info.appendChild(time);
    const exportBtn = document.createElement('button');
    exportBtn.className = 'history-export';
    exportBtn.textContent = '导出';
    exportBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      void exportHistory(c.id);
    });
    item.appendChild(info);
    item.appendChild(exportBtn);
    item.addEventListener('click', () => void loadHistory(c.id));
    historyListEl.appendChild(item);
  }
}

async function exportHistory(id) {
  const response = await chrome.runtime.sendMessage({ type: 'history-export', id });
  if (!response || !response.ok) {
    addMessage('system', `导出失败：${response ? response.error : '未知错误'}`);
    return;
  }
  const filename = `mypilot-${new Date(response.updatedAt).toISOString().slice(0, 10)}.md`;
  downloadFile(filename, buildMarkdown(response.title, response.updatedAt, response.log));
}

function buildMarkdown(title, updatedAt, log) {
  const roleNames = { user: '用户', agent: 'Agent', tool: '操作', system: '系统' };
  const lines = [`# ${title || 'MyPilot 对话'}`, '', `时间：${new Date(updatedAt).toLocaleString()}`, '', '---', ''];
  for (const m of log) {
    lines.push(`**${roleNames[m.role] || m.role}**`, '', m.text, '', '---', '');
  }
  return lines.join('\n');
}

async function loadHistory(id) {
  const response = await chrome.runtime.sendMessage({ type: 'history-load', id });
  if (!response || !response.ok) {
    return;
  }
  messages.replaceChildren();
  streamBody = null;
  for (const m of response.log) {
    addMessage(m.role, m.text);
  }
  historyPanel.hidden = true;
}

settingsSave.addEventListener('click', async () => {
  const settings = {
    apiKey: apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim(),
    model: modelInput.value.trim()
  };
  const response = await chrome.runtime.sendMessage({ type: 'save-settings', settings });
  if (response && response.ok) {
    configured = Boolean(settings.apiKey);
    settingsMsg.textContent = '已保存';
  } else {
    settingsMsg.textContent = '保存失败';
  }
  settingsMsg.hidden = false;
  updateStatus();
});

settingsCancel.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'get-settings' });
  if (response && response.settings) {
    apiKeyInput.value = response.settings.apiKey || '';
    baseUrlInput.value = response.settings.baseUrl || '';
    modelInput.value = response.settings.model || '';
  }
  settingsMsg.hidden = true;
  settingsPanel.hidden = true;
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
  streamBody = null;
  running = true;
  stopButton.hidden = false;
  updateStatus();  try {
    const response = await chrome.runtime.sendMessage({ type: 'agent-run', text });
    if (!response || !response.ok) {
      addMessage('system', `错误：${response ? response.error : '无法连接到 service worker'}`);
    }
  } catch (error) {
    addMessage('system', `错误：${error.message}`);
  }
});

stopButton.addEventListener('click', () => {
  addMessage('system', '正在停止…');
  void chrome.runtime.sendMessage({ type: 'agent-stop' });
});

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'agent-message':
      addMessage(message.role, message.text);
      break;
    case 'agent-stream':
      if (!streamBody) {
        streamBody = createMessage('agent').body;
      }
      streamBody.textContent += message.delta;
      messages.scrollTop = messages.scrollHeight;
      break;
    case 'download-csv':
      downloadFile(message.filename, message.csv);
      break;
    case 'agent-thinking':
      thinkingEl.hidden = !message.on;
      break;
    case 'agent-tokens':
      updateTokens(message.tokens);
      break;
    case 'agent-done':
      thinkingEl.hidden = true;
      streamBody = null;
      running = false;
      stopButton.hidden = true;
      sendButton.disabled = !input.value.trim();
      updateStatus();
      break;
    case 'agent-error':
      thinkingEl.hidden = true;
      addMessage('system', `错误：${message.text}`);
      streamBody = null;
      running = false;
      stopButton.hidden = true;
      sendButton.disabled = !input.value.trim();
      updateStatus();
      break;
  }
});

function createMessage(role) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = new Date().toLocaleTimeString();
  const body = document.createElement('div');
  el.appendChild(meta);
  el.appendChild(body);
  messages.appendChild(el);
  return { el, body };
}

function addMessage(role, text) {
  const { body } = createMessage(role);
  body.textContent = text;
  messages.scrollTop = messages.scrollHeight;
}

function downloadFile(filename, content) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function updateStatus() {
  if (running) {
    statusEl.textContent = '运行中';
    statusEl.className = 'status running';
  } else if (configured) {
    statusEl.textContent = '已就绪';
    statusEl.className = 'status ready';
  } else {
    statusEl.textContent = '未配置';
    statusEl.className = 'status missing';
  }
}

function updateTokens(tokens) {
  tokensEl.textContent = `${(tokens / 1000).toFixed(1)}K`;
}

void chrome.runtime.sendMessage({ type: 'get-settings' }).then((response) => {
  if (response && response.settings) {
    apiKeyInput.value = response.settings.apiKey || '';
    baseUrlInput.value = response.settings.baseUrl || '';
    modelInput.value = response.settings.model || '';
    configured = Boolean(response.settings.apiKey);
    updateStatus();
  }
});

void chrome.runtime.sendMessage({ type: 'get-tokens' }).then((response) => {
  if (response) {
    updateTokens(response.tokens);
  }
});
