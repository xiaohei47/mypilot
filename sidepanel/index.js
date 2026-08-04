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
const modelListEl = document.body.querySelector('#model-list');
const providerInput = document.body.querySelector('#provider');
const maxIterationsInput = document.body.querySelector('#max-iterations');
const maxStateCharsInput = document.body.querySelector('#max-state-chars');
const showThinkingInput = document.body.querySelector('#show-thinking');
const historyPanel = document.body.querySelector('#history');
const historyListEl = document.body.querySelector('#history-list');
const historyNew = document.body.querySelector('#history-new');
const menuWrap = document.body.querySelector('#menu-wrap');
const menuToggle = document.body.querySelector('#menu-toggle');
const menu = document.body.querySelector('#menu');
const menuSettings = document.body.querySelector('#menu-settings');
const menuHistory = document.body.querySelector('#menu-history');
const headerNew = document.body.querySelector('#header-new');
const thinkingEl = document.body.querySelector('#thinking');
const chatTitleEl = document.body.querySelector('#chat-title');
const tokensCurrentEl = document.body.querySelector('#tokens-current');
const tokensKEl = document.body.querySelector('#tokens-k');
const balanceEl = document.body.querySelector('#balance');

let running = false;
let configured = false;
let streamBody = null;
let reasoningBody = null;
let currentProviderName = '';

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
  await startNewConversation();
});

headerNew.addEventListener('click', async () => {
  await startNewConversation();
});

async function startNewConversation() {
  const response = await chrome.runtime.sendMessage({ type: 'history-new' });
  if (response && response.ok) {
    messages.replaceChildren();
    streamBody = null;
    reasoningBody = null;
    historyPanel.hidden = true;
  }
}

async function refreshHistory() {
  const response = await chrome.runtime.sendMessage({ type: 'history-list' });
  if (!response || !response.list) {
    return;
  }
  historyListEl.replaceChildren();
  for (const c of response.list) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'history-close';
    closeBtn.textContent = '×';
    closeBtn.title = '删除';
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      void deleteHistory(c.id);
    });
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
    item.appendChild(closeBtn);
    item.appendChild(info);
    item.appendChild(exportBtn);
    item.addEventListener('click', () => void loadHistory(c.id));
    historyListEl.appendChild(item);
  }
}

async function deleteHistory(id) {
  if (!confirm('确定删除这条对话吗？')) {
    return;
  }
  await chrome.runtime.sendMessage({ type: 'history-delete', id });
  await refreshHistory();
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
  const roleNames = { user: '用户', agent: 'Agent', tool: '操作', system: '系统', reasoning: '思考' };
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
  reasoningBody = null;
  for (const m of response.log) {
    addMessage(m.role, m.text);
  }
  historyPanel.hidden = true;
}

let providers = {};

providerInput.addEventListener('change', () => {
  currentProviderName = providers[providerInput.value]?.name || '';
  updateStatus();
  const p = providers[providerInput.value];
  if (p) {
    baseUrlInput.value = p.baseUrl || '';
    populateModelList(p.models);
    if (p.models && p.models.length) {
      modelInput.value = p.models[0];
    }
  }
});

function populateModelList(models) {
  modelListEl.replaceChildren();
  for (const m of models || []) {
    const opt = document.createElement('option');
    opt.value = m;
    modelListEl.appendChild(opt);
  }
}

settingsSave.addEventListener('click', async () => {
  const settings = {
    provider: providerInput.value,
    apiKey: apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim(),
    model: modelInput.value.trim(),
    maxIterations: Number(maxIterationsInput.value) || 20,
    maxStateChars: Number(maxStateCharsInput.value) || 6000,
    showThinking: showThinkingInput.value === 'true'
  };
  const response = await chrome.runtime.sendMessage({ type: 'save-settings', settings });
  if (response && response.ok) {
    configured = Boolean(settings.apiKey);
    settingsMsg.hidden = true;
    settingsPanel.hidden = true;
  } else {
    settingsMsg.textContent = '保存失败';
    settingsMsg.hidden = false;
  }
  updateStatus();
});

function applySettings(response) {
  if (!response || !response.settings) {
    return;
  }
  providers = response.providers || {};
  providerInput.replaceChildren();
  for (const [id, p] of Object.entries(providers)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = p.name;
    providerInput.appendChild(opt);
  }
  providerInput.value = response.settings.provider || 'custom';
  currentProviderName = providers[providerInput.value]?.name || '';
  populateModelList(providers[providerInput.value]?.models);
  apiKeyInput.value = response.settings.apiKey || '';
  baseUrlInput.value = response.settings.baseUrl || '';
  modelInput.value = response.settings.model || '';
  maxIterationsInput.value = response.settings.maxIterations || '';
  maxStateCharsInput.value = response.settings.maxStateChars || '';
  showThinkingInput.value = response.settings.showThinking ? 'true' : 'false';
}

settingsCancel.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'get-settings' });
  applySettings(response);
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
    case 'agent-reasoning-start':
      if (!reasoningBody) {
        reasoningBody = createReasoningBlock();
      }
      break;
    case 'agent-reasoning-delta':
      if (!reasoningBody) {
        reasoningBody = createReasoningBlock();
      }
      reasoningBody.textContent += message.delta;
      messages.scrollTop = messages.scrollHeight;
      break;
    case 'agent-reasoning-end':
      if (!reasoningBody) {
        reasoningBody = createReasoningBlock();
      }
      reasoningBody.textContent = message.text;
      reasoningBody.parentElement.querySelector('.reasoning-toggle').textContent = '▸';
      reasoningBody.parentElement.classList.remove('reasoning-open');
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
      reasoningBody = null;
      running = false;
      stopButton.hidden = true;
      sendButton.disabled = !input.value.trim();
      updateStatus();
      break;
    case 'agent-error':
      thinkingEl.hidden = true;
      addMessage('system', `错误：${message.text}`);
      streamBody = null;
      reasoningBody = null;
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
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'message-copy';
  copyBtn.textContent = '⧉';
  copyBtn.title = '复制';
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(body.textContent).then(() => {
      copyBtn.textContent = '✓';
      setTimeout(() => {
        copyBtn.textContent = '⧉';
      }, 1200);
    });
  });
  el.appendChild(copyBtn);
  messages.appendChild(el);
  return { el, body };
}

function addMessage(role, text) {
  if (role === 'reasoning') {
    const body = createReasoningBlock();
    body.textContent = text;
    body.parentElement.classList.remove('reasoning-open');
    messages.scrollTop = messages.scrollHeight;
    return;
  }
  const { body } = createMessage(role);
  body.textContent = text;
  messages.scrollTop = messages.scrollHeight;
}

function createReasoningBlock() {
  const el = document.createElement('div');
  el.className = 'message reasoning';
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'reasoning-header';
  const toggle = document.createElement('span');
  toggle.className = 'reasoning-toggle';
  toggle.textContent = '▸';
  const label = document.createElement('span');
  label.className = 'reasoning-label';
  label.textContent = '思考过程';
  header.appendChild(toggle);
  header.appendChild(label);
  const body = document.createElement('div');
  body.className = 'reasoning-body';
  header.addEventListener('click', () => {
    const open = el.classList.toggle('reasoning-open');
    toggle.textContent = open ? '▾' : '▸';
  });
  el.appendChild(header);
  el.appendChild(body);
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'message-copy';
  copyBtn.textContent = '⧉';
  copyBtn.title = '复制';
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(body.textContent).then(() => {
      copyBtn.textContent = '✓';
      setTimeout(() => {
        copyBtn.textContent = '⧉';
      }, 1200);
    });
  });
  el.appendChild(copyBtn);
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return body;
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
    statusEl.textContent = currentProviderName ? `已就绪 · ${currentProviderName}` : '已就绪';
    statusEl.className = 'status ready';
  } else {
    statusEl.textContent = '未配置';
    statusEl.className = 'status missing';
  }
}

function updateTokens(tokens) {
  tokensCurrentEl.textContent = String(tokens);
  tokensKEl.textContent = `${(tokens / 1000).toFixed(1)}K`;
}

void chrome.runtime.sendMessage({ type: 'get-settings' }).then((response) => {
  applySettings(response);
  if (response && response.settings) {
    configured = Boolean(response.settings.apiKey);
    updateStatus();
  }
});

void chrome.runtime.sendMessage({ type: 'get-tokens' }).then((response) => {
  if (response) {
    updateTokens(response.tokens);
  }
});

async function refreshBalance() {
  const response = await chrome.runtime.sendMessage({ type: 'account-balance' });
  if (response && response.ok) {
    balanceEl.innerHTML = `剩余 <b>${response.balance}</b> ${response.currency}`;
    balanceEl.hidden = false;
  } else {
    balanceEl.hidden = true;
  }
}

void refreshBalance();

void chrome.runtime.sendMessage({ type: 'history-list' }).then((response) => {
  if (response && response.list && response.list.length) {
    void loadHistory(response.list[0].id);
  }
});

async function refreshPageTitle() {
  const response = await chrome.runtime.sendMessage({ type: 'page-title' });
  const title = response && response.title ? response.title.trim() : '';
  if (title) {
    chatTitleEl.textContent = title;
    chatTitleEl.hidden = false;
  } else {
    chatTitleEl.hidden = true;
  }
}

void refreshPageTitle();

chrome.tabs.onActivated.addListener(() => void refreshPageTitle());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.title) {
    void refreshPageTitle();
  }
});
