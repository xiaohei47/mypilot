const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini'
};

const MAX_ITERATIONS = 15;
const MAX_STATE_CHARS = 6000;

const SYSTEM_PROMPT = `你是一个网页自动化 AI Agent，通过操作浏览器中的当前页面完成用户的任务。

你可以执行以下操作，每次回复只输出一个 JSON 对象，不要输出任何其他内容：

1. {"action":"goto","url":"https://..."} - 打开指定 URL
2. {"action":"click","text":"可见文本"} - 点击页面上包含该文本的元素
3. {"action":"click","selector":"CSS 选择器"} - 通过 CSS 选择器点击元素
4. {"action":"fill","value":"内容"} - 在聚焦的元素中输入内容（通常先 click 聚焦）
5. {"action":"fill","selector":"CSS 选择器","value":"内容"} - 在指定元素中填入内容
6. {"action":"press","key":"Enter"} - 按键盘按键（如 Enter、Tab、Escape）
7. {"action":"scroll","direction":"down"} - 向下滚动页面（direction 为 up 或 down）
8. {"action":"wait","ms":1000} - 等待页面加载
9. {"action":"ask","question":"问题"} - 当需要用户确认或任务不明确时询问用户
10. {"action":"done","answer":"最终答案"} - 任务完成，给出最终答复
11. {"action":"extract_table","index":0} - 提取页面上第 index 个表格的内容（index 从 0 开始，缺省为第 0 个）
12. {"action":"save_table","index":0,"filename":"表格.csv"} - 将第 index 个表格保存为 CSV 文件并触发下载（filename 不必带 .csv）

规则：
- 根据页面可见内容选择点击目标，优先使用精确的可见文本。
- 一次只执行一步操作，等待下一页状态后再继续。
- 任务模糊时使用 ask 询问用户，而不是猜测。
- 任务完成时使用 done 返回最终答案。
- 无法推进任务时使用 done 说明原因。
- 当用户要求"整理/输出/导出表格文件"时：先 extract_table 查看表格内容，需要整理则在回复中组织，再用 save_table 保存为文件，最后用 done 说明。
- 页面内容可能来自多个内嵌页面（frame 区域），注意阅读所有 frame 的内容，操作会自动在所有 frame 中查找目标。`;

let settings = { ...DEFAULTS };
let conversation = [];
let running = false;
let abortFlag = false;
let abortController = null;
let currentConversationId = null;
let currentTitle = '';
let uiLog = [];
let persistTimer = null;

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

void chrome.storage.local.get(DEFAULTS).then((saved) => {
  settings = { ...DEFAULTS, ...saved };
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'get-settings':
      sendResponse({ settings });
      return false;
    case 'save-settings':
      settings = { ...DEFAULTS, ...message.settings };
      void chrome.storage.local.set(settings);
      sendResponse({ ok: true });
      return false;
    case 'history-list':
      void (async () => {
        const { conversations = [] } = await chrome.storage.local.get('conversations');
        sendResponse({
          list: conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))
        });
      })();
      return true;
    case 'history-load':
      void (async () => {
        const { conversations = [] } = await chrome.storage.local.get('conversations');
        const found = conversations.find((c) => c.id === message.id);
        if (!found) {
          sendResponse({ ok: false, error: '对话不存在' });
          return;
        }
        currentConversationId = found.id;
        currentTitle = found.title;
        conversation = found.messages.slice();
        uiLog = found.log.slice();
        sendResponse({ ok: true, title: found.title, log: found.log });
      })();
      return true;
    case 'history-new':
      currentConversationId = null;
      conversation = [];
      uiLog = [];
      sendResponse({ ok: true });
      return false;
    case 'agent-run':
      void handleRun(message.text);
      sendResponse({ ok: true });
      return false;
    case 'agent-stop':
      abortFlag = true;
      if (abortController) {
        abortController.abort();
      }
      sendResponse({ ok: true });
      return false;
  }
});

function notify(message) {
  if (message.type === 'agent-message') {
    logMessage(message.role, message.text);
  }
  void chrome.runtime.sendMessage(message).catch(() => {});
}

function logMessage(role, text) {
  uiLog.push({ role, text });
  schedulePersist();
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (currentConversationId) {
      void persistConversation();
    }
  }, 500);
}

async function persistConversation() {
  const { conversations = [] } = await chrome.storage.local.get('conversations');
  const entry = {
    id: currentConversationId,
    title: currentTitle,
    messages: conversation.slice(),
    log: uiLog.slice(),
    updatedAt: Date.now()
  };
  const next = [entry, ...conversations.filter((c) => c.id !== currentConversationId)].slice(0, 20);
  await chrome.storage.local.set({ conversations: next });
}

function sleep(ms) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (abortFlag || Date.now() - start >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function evalInPage(tabId, fn, args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: fn,
    args: args || []
  });
  return results[0].result;
}

async function evalInAllFrames(tabId, fn, args) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: fn,
      args: args || []
    });
    return results.map((r) => ({ frameId: r.frameId, result: r.result }));
  } catch (error) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: fn,
      args: args || []
    });
    return results.map((r) => ({ frameId: r.frameId, result: r.result }));
  }
}

async function handleRun(userText) {
  if (running) {
    notify({ type: 'agent-message', role: 'system', text: '已有任务正在执行，请等待完成或点击「停止」' });
    return;
  }
  running = true;
  abortFlag = false;
  abortController = new AbortController();
  if (!currentConversationId) {
    currentConversationId = String(Date.now());
    currentTitle = userText.slice(0, 20);
    conversation = [];
    uiLog = [];
  }
  conversation.push({ role: 'user', content: userText });
  logMessage('user', userText);

  try {
    if (!settings.apiKey) {
      throw new Error('请先点击右上角 ⚙ 配置 API Key');
    }
    const tab = await getActiveTab();
    if (!tab || !/^https?:$/.test(new URL(tab.url).protocol)) {
      throw new Error('请在 http/https 页面中使用');
    }
    await runAgentLoop(tab.id);
  } catch (error) {
    if (abortFlag) {
      notify({ type: 'agent-message', role: 'system', text: '已停止' });
    } else {
      console.error(error);
      logMessage('system', `错误：${error.message}`);
      notify({ type: 'agent-error', text: error.message });
    }
  } finally {
    abortController = null;
    running = false;
    schedulePersist();
    notify({ type: 'agent-done' });
  }
}

async function runAgentLoop(tabId) {
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (abortFlag) {
      notify({ type: 'agent-message', role: 'system', text: '已停止' });
      return;
    }

    const state = await collectState(tabId);
    const model = await askModel(state);
    const text = model.content || '';

    if (!text.trim()) {
      notify({ type: 'agent-message', role: 'agent', text: '（模型没有给出响应）' });
      return;
    }

    if (isFinalResponse(model)) {
      if (!model.streamed) {
        notify({ type: 'agent-message', role: 'agent', text });
      } else {
        logMessage('agent', text);
      }
      return;
    }

    const action = parseAction(text);
    if (!action) {
      notify({ type: 'agent-message', role: 'agent', text });
      notify({ type: 'agent-message', role: 'system', text: '无法解析操作，请换个说法重试。' });
      return;
    }

    notify({ type: 'agent-message', role: 'tool', text: `[动作] ${describeAction(action)}` });
    const result = await executeAction(tabId, action);
    if (!result.ok) {
      notify({ type: 'agent-message', role: 'system', text: `执行失败：${result.error}` });
    } else if (result.stop) {
      return;
    }
  }
  notify({ type: 'agent-message', role: 'system', text: `已达到最大迭代次数（${MAX_ITERATIONS}）` });
}

async function collectState(tabId) {
  try {
    const frames = await evalInAllFrames(tabId, getStateScript, [MAX_STATE_CHARS]);
    const sections = frames
      .map((f) => {
        const s = f.result;
        if (!s || !s.text) {
          return null;
        }
        return `--- 页面内容 (frame ${f.frameId}) ---\nURL: ${s.url}\n标题: ${s.title}\n内容:\n${s.text}`;
      })
      .filter(Boolean);
    return sections.join('\n\n');
  } catch (error) {
    return `页面状态获取失败: ${error.message}`;
  }
}

async function askModel(state) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversation,
    { role: 'user', content: `--- 页面状态 ---\n${state}\n\n请根据页面状态决定下一步操作。` }
  ];

  let fullContent = '';
  let visible = true;

  const handleDelta = (delta) => {
    fullContent += delta;
    const trimmed = fullContent.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('```')) {
      visible = false;
    } else if (visible) {
      notify({ type: 'agent-stream', delta });
    }
  };

  const processLine = (line) => {
    const t = line.trim();
    if (!t.startsWith('data:')) {
      return;
    }
    const data = t.slice(5).trim();
    if (!data || data === '[DONE]') {
      return;
    }
    try {
      const parsed = JSON.parse(data);
      const delta =
        parsed.choices && parsed.choices[0] && parsed.choices[0].delta
          ? parsed.choices[0].delta.content
          : null;
      if (delta) {
        handleDelta(delta);
      }
    } catch {
      /* 忽略无法解析的事件 */
    }
  };

  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({ model: settings.model, messages, temperature: 0.1, stream: true }),
      signal: abortController.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!response.body) {
      const data = await response.json();
      fullContent = data.choices && data.choices[0] ? data.choices[0].message.content : '';
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let rawAll = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        rawAll += chunk;
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          processLine(line);
        }
      }
      if (buffer.trim()) {
        processLine(buffer);
      }
      if (!fullContent && rawAll.trim()) {
        try {
          const data = JSON.parse(rawAll.trim());
          const content = data.choices && data.choices[0] ? data.choices[0].message.content : '';
          if (content) {
            fullContent = content;
            const trimmed = content.trimStart();
            if (!trimmed.startsWith('{') && !trimmed.startsWith('```')) {
              notify({ type: 'agent-stream', delta: content });
            }
          }
        } catch {
          /* 非 SSE 格式且无法解析 */
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    throw new Error(`LLM 调用失败: ${error.message}`);
  }

  conversation.push({ role: 'assistant', content: fullContent });
  return { content: fullContent, streamed: visible && fullContent.trim() !== '' };
}

function isFinalResponse(model) {
  return !model.content.trim().startsWith('{');
}

function parseAction(text) {
  let raw = text.trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && obj.action) {
      return obj;
    }
  } catch {
    /* 继续尝试提取 */
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && typeof obj === 'object' && obj.action) {
        return obj;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function describeAction(action) {
  switch (action.action) {
    case 'goto':
      return `打开 ${action.url}`;
    case 'click':
      return `点击 ${action.text || action.selector}`;
    case 'fill':
      return `输入 "${action.value}"` + (action.selector ? ` 到 ${action.selector}` : '');
    case 'press':
      return `按 ${action.key}`;
    case 'scroll':
      return `滚动页面 ${action.direction}`;
    case 'wait':
      return `等待 ${action.ms}ms`;
    case 'ask':
      return `询问用户：${action.question}`;
    case 'done':
      return `任务完成：${action.answer}`;
    case 'extract_table':
      return `提取表格内容（第 ${action.index ?? 0} 个）`;
    case 'save_table':
      return `保存表格为文件 ${action.filename || 'table.csv'}`;
    default:
      return JSON.stringify(action);
  }
}

async function executeAction(tabId, action) {
  try {
    switch (action.action) {
      case 'goto':
        await evalInPage(tabId, gotoScript, [action.url]);
        await sleep(1500);
        return { ok: true };

      case 'click': {
        const frames = action.text
          ? await evalInAllFrames(tabId, clickByTextScript, [action.text])
          : await evalInAllFrames(tabId, clickBySelectorScript, [action.selector]);
        const done = frames.some((r) => r.result === true);
        return done ? { ok: true } : { ok: false, error: '未找到可点击的元素' };
      }

      case 'fill':
        if (action.selector) {
          const selFrames = await evalInAllFrames(tabId, fillSelectorScript, [
            action.selector,
            action.value
          ]);
          return selFrames.some((r) => r.result === true)
            ? { ok: true }
            : { ok: false, error: '未找到输入框' };
        }
        {
          const focusedFrames = await evalInAllFrames(tabId, fillFocusedScript, [action.value]);
          return focusedFrames.some((r) => r.result === true)
            ? { ok: true }
            : { ok: false, error: '没有可输入的聚焦元素' };
        }

      case 'press':
        await evalInAllFrames(tabId, pressKeyScript, [action.key]);
        return { ok: true };

      case 'scroll':
        await evalInPage(tabId, scrollScript, [action.direction]);
        return { ok: true };

      case 'wait':
        await sleep(action.ms || 1000);
        return { ok: true };

      case 'ask':
        notify({ type: 'agent-message', role: 'agent', text: action.question });
        return { ok: true, stop: true };

      case 'done':
        notify({ type: 'agent-message', role: 'agent', text: action.answer });
        conversation.push({ role: 'assistant', content: `任务完成：${action.answer}` });
        return { ok: true, stop: true };

      case 'extract_table': {
        const frames = await evalInAllFrames(tabId, extractTableScript, [action.index]);
        const hit = frames.find((r) => r.result && r.result.rows && r.result.rows.length);
        const data = hit ? hit.result : null;
        if (!data) {
          return { ok: false, error: '页面上没有找到表格' };
        }
        const preview = data.rows
          .slice(0, 50)
          .map((row) => row.join(' | '))
          .join('\n');
        const summary = `页面共有 ${data.tableCount} 个表格，第 ${action.index ?? 0} 个表格共 ${data.rows.length} 行。\n表格内容：\n${preview}`;
        notify({ type: 'agent-message', role: 'tool', text: `[表格内容]\n${summary}` });
        conversation.push({ role: 'user', content: `已提取表格内容：\n${summary}` });
        return { ok: true };
      }

      case 'save_table': {
        const frames = await evalInAllFrames(tabId, extractTableScript, [action.index]);
        const hit = frames.find((r) => r.result && r.result.rows && r.result.rows.length);
        const data = hit ? hit.result : null;
        if (!data) {
          return { ok: false, error: '页面上没有找到表格' };
        }
        const filename = (action.filename || 'table.csv').replace(/\.csv$/i, '') + '.csv';
        const csv = toCsv(data.rows);
        conversation.push({ role: 'user', content: `已保存表格为文件：${filename}` });
        notify({ type: 'download-csv', filename, csv });
        notify({ type: 'agent-message', role: 'tool', text: `已生成文件：${filename}` });
        return { ok: true };
      }

      default:
        return { ok: false, error: `未知操作: ${action.action}` };
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function getStateScript(limit) {
  const text = document.body && document.body.innerText ? document.body.innerText : '';
  return { url: location.href, title: document.title, text: text.slice(0, limit) };
}

function gotoScript(url) {
  location.href = url;
  return true;
}

function clickByTextScript(text) {
  const targetText = String(text);
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => el.getClientRects && el.getClientRects().length > 0;
  const all = [
    ...document.querySelectorAll(
      'a,button,input,textarea,[role=button],[role=link],[role=menuitem],label,span,div,li'
    )
  ].filter((el) => visible(el) && norm(el.innerText));
  const exact = all.find((el) => norm(el.innerText) === norm(targetText));
  const target = exact || all.find((el) => norm(el.innerText).includes(norm(targetText)));
  if (!target) {
    return false;
  }
  target.click();
  return true;
}

function clickBySelectorScript(sel) {
  const el = document.querySelector(sel);
  if (!el) {
    return false;
  }
  el.click();
  return true;
}

function setInputValue(el, value) {
  const proto =
    el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : el.tagName === 'INPUT'
        ? window.HTMLInputElement.prototype
        : null;
  if (proto) {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
  } else if (el.isContentEditable) {
    el.textContent = String(value);
  } else {
    el.value = String(value);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillSelectorScript(sel, value) {
  const el = document.querySelector(sel);
  if (!el) {
    return false;
  }
  if (el.focus) {
    el.focus();
  }
  setInputValue(el, value);
  return true;
}

function fillFocusedScript(value) {
  if (!document.hasFocus()) {
    return false;
  }
  const el = document.activeElement;
  if (!el || (!el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) {
    return false;
  }
  setInputValue(el, value);
  return true;
}

function pressKeyScript(key) {
  if (!document.hasFocus()) {
    return false;
  }
  const keyCodes = {
    Enter: 13,
    Tab: 9,
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34
  };
  const code = keyCodes[key];
  const target = document.activeElement || document.body;
  if (code) {
    const init = {
      key,
      code,
      keyCode: code,
      which: code,
      bubbles: true,
      cancelable: true
    };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    if (key === 'Enter' && target.form && target.form.requestSubmit) {
      target.form.requestSubmit();
    }
  }
  return true;
}

function scrollScript(direction) {
  window.scrollBy(0, direction === 'down' ? 800 : -800);
  return true;
}

function extractTableScript(index) {
  const tables = Array.from(document.querySelectorAll('table'));
  const table = index != null ? tables[index] : tables[0];
  if (!table) {
    return null;
  }
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const rows = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cells = Array.from(tr.querySelectorAll('th,td')).map((cell) => norm(cell.textContent));
    if (cells.length) {
      rows.push(cells);
    }
  }
  return { rows, tableCount: tables.length };
}

function toCsv(rows) {
  const escape = (cell) => {
    const s = String(cell == null ? '' : cell);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((row) => row.map(escape).join(',')).join('\r\n');
}
