const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini'
};

const MAX_ITERATIONS = 20;
const MAX_STATE_CHARS = 6000;

const SYSTEM_PROMPT = `你是一个网页自动化 AI Agent，通过操作浏览器中的当前页面完成用户的任务。

每次回复只输出一个 JSON 对象作为下一步操作，不要输出任何其他内容。可选操作：

导航:
1. {"action":"goto","url":"https://..."} - 打开 URL
2. {"action":"back"} - 返回上一页
3. {"action":"reload"} - 刷新页面

鼠标:
4. {"action":"click","text":"可见文本"} 或 {"action":"click","selector":"CSS选择器"} - 点击
5. {"action":"dblclick","text":"..."} 或 {"action":"dblclick","selector":"..."} - 双击
6. {"action":"hover","text":"..."} 或 {"action":"hover","selector":"..."} - 悬停（展开下拉菜单等）

输入:
7. {"action":"fill","selector":"...","value":"..."} 或 {"action":"fill","value":"..."} - 在指定或聚焦元素填入文本
8. {"action":"type","text":"..."} - 在聚焦元素逐字输入（用于需要逐字触发的输入框）
9. {"action":"clear","selector":"..."} 或 {"action":"clear"} - 清空输入框
10. {"action":"select","selector":"...","value":"..."} 或 {"action":"select","selector":"...","label":"..."} - 选择下拉选项
11. {"action":"check","text":"..."} 或 {"action":"check","selector":"..."} - 勾选复选框（默认取反，可加 "checked":true/false 指定）
12. {"action":"press","key":"Enter"} - 按键，支持组合键如 "Ctrl+A"、"Alt+Enter"
13. {"action":"submit"} - 提交当前聚焦的表单

滚动/等待:
14. {"action":"scroll","direction":"down"} - 滚动页面（up 或 down）
15. {"action":"scroll_to","text":"..."} 或 {"action":"scroll_to","selector":"..."} - 滚动到指定元素
16. {"action":"wait","ms":1000} - 等待指定毫秒
17. {"action":"wait_for","text":"..."} 或 {"action":"wait_for","selector":"..."} - 等待元素出现（默认 10 秒，可加 "timeout":毫秒）

读取/导出:
18. {"action":"extract","text":"..."} 或 {"action":"extract","selector":"..."} - 提取元素文本内容供分析
19. {"action":"extract_table","index":0} - 提取第 index 个表格内容
20. {"action":"save_table","index":0,"filename":"表格.csv"} - 将表格保存为 CSV 文件并触发下载

其它:
21. {"action":"ask","question":"..."} - 任务不明确时询问用户

规则：
- 页面状态中包含"可交互元素"列表（输入框/按钮/下拉等），优先据此选择操作目标。
- 点击目标优先使用精确的可见文本。
- 一次只执行一步操作，等待下一页状态后再继续。
- 任务模糊时使用 ask 询问用户，而不是猜测。
- 任务完成时，直接用自然语言输出最终答复（不要输出 JSON）。
- 无法推进任务时，也用自然语言说明原因并结束。
- 当用户要求"整理/输出/导出表格文件"时：先 extract_table 查看内容，再用 save_table 保存为文件，最后用自然语言总结。
- 页面内容可能来自多个内嵌页面（frame），注意阅读所有 frame 的内容，操作会自动在所有 frame 中查找目标。

任务纪律（非常重要）：
- 每次执行动作后，系统会用 <tool_result name="动作名" status="success|error|skipped">结果</tool_result> 反馈给你。看到 status="success" 就表示该动作已经成功完成，不要重复执行。
- 点击"查询/搜索/确定/提交"后，等待结果出现，立即读取结果并给出最终答复，不要继续点击其他按钮。
- 除非用户明确要求，不要点击"返回/后退/重置/取消/退出"类按钮，这类按钮会撤销进度。
- 同样内容的操作执行过一次后不要再执行；一旦开始重复操作，说明很可能已经完成，直接给出最终答复。
- 每一步操作都必须让任务更接近完成；想不出该做什么时，直接基于已有信息给出最终答复。`;

let settings = { ...DEFAULTS };
let conversation = [];
let running = false;
let abortFlag = false;
let abortController = null;
let currentConversationId = null;
let currentTitle = '';
let uiLog = [];
let persistTimer = null;
let totalTokens = 0;

function estimateTokens(text) {
  const s = String(text || '');
  let tokens = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    tokens += code >= 0x2e80 ? 1 : 0.25;
  }
  return Math.max(1, Math.ceil(tokens));
}

function broadcastTokens(tokens) {
  void chrome.runtime.sendMessage({ type: 'agent-tokens', tokens }).catch(() => {});
}

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
    case 'history-export':
      void (async () => {
        const { conversations = [] } = await chrome.storage.local.get('conversations');
        const found = conversations.find((c) => c.id === message.id);
        if (!found) {
          sendResponse({ ok: false, error: '对话不存在' });
          return;
        }
        sendResponse({ ok: true, title: found.title, updatedAt: found.updatedAt, log: found.log });
      })();
      return true;
    case 'get-tokens':
      sendResponse({ tokens: totalTokens });
      return false;
    case 'history-new':
      currentConversationId = null;
      conversation = [];
      uiLog = [];
      totalTokens = 0;
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
    totalTokens = 0;
    broadcastTokens(0);
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
  let lastActionKey = null;
  let lastActionOk = false;
  let repeatCount = 0;
  let cycleKey1 = null;
  let cycleKey2 = null;
  let cycleCount = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (abortFlag) {
      notify({ type: 'agent-message', role: 'system', text: '已停止' });
      return;
    }

    const state = await collectState(tabId);
    let model;
    notify({ type: 'agent-thinking', on: true });
    try {
      model = await askModel(state, i === MAX_ITERATIONS - 1);
    } finally {
      notify({ type: 'agent-thinking', on: false });
    }
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

    if (i === MAX_ITERATIONS - 1) {
      notify({ type: 'agent-message', role: 'system', text: '已达最后一步，结束任务。' });
      return;
    }

    const actionKey = JSON.stringify(action);
    if (actionKey === lastActionKey && lastActionOk) {
      repeatCount++;
      if (repeatCount >= 3) {
        notify({
          type: 'agent-message',
          role: 'system',
          text: `动作「${describeAction(action)}」被多次重复，可能已生效但模型未感知，已停止。`
        });
        return;
      }
      conversation.push({
        role: 'user',
        content: `<tool_result name="${action.action}" status="skipped">动作「${describeAction(action)}」上次已执行成功，请勿重复。</tool_result>`
      });
      notify({
        type: 'agent-message',
        role: 'system',
        text: `跳过重复动作（${describeAction(action)}），已提醒模型换一种方式继续。`
      });
      continue;
    }

    if (actionKey === cycleKey2 && cycleKey1 !== null && actionKey !== cycleKey1) {
      cycleCount++;
      if (cycleCount >= 2) {
        notify({
          type: 'agent-message',
          role: 'system',
          text: `检测到循环操作（${describeAction(action)} 与之前的动作反复交替），已停止。`
        });
        return;
      }
    } else {
      cycleCount = 0;
    }
    cycleKey2 = cycleKey1;
    cycleKey1 = actionKey;

    notify({ type: 'agent-message', role: 'tool', text: `[动作] ${describeAction(action)}` });
    const result = await executeAction(tabId, action);
    if (!result.ok) {
      lastActionKey = null;
      lastActionOk = false;
      repeatCount = 0;
      conversation.push({
        role: 'user',
        content: `<tool_result name="${action.action}" status="error">${result.error}</tool_result>`
      });
      notify({ type: 'agent-message', role: 'system', text: `执行失败：${result.error}` });
    } else if (result.stop) {
      return;
    } else {
      lastActionKey = actionKey;
      lastActionOk = true;
      repeatCount = 0;
      conversation.push({
        role: 'user',
        content: `<tool_result name="${action.action}" status="success">${describeAction(action)}</tool_result>`
      });
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
        let block = `--- 页面内容 (frame ${f.frameId}) ---\nURL: ${s.url}\n标题: ${s.title}\n内容:\n${s.text}`;
        if (s.interactive && s.interactive.length) {
          block += `\n\n可交互元素:\n${s.interactive.join('\n')}`;
        }
        return block;
      })
      .filter(Boolean);
    return sections.join('\n\n');
  } catch (error) {
    return `页面状态获取失败: ${error.message}`;
  }
}

async function askModel(state, lastStep) {
  if (conversation.length > 40) {
    conversation = conversation.slice(-40);
  }
  const statePrompt = lastStep
    ? `--- 页面状态 ---\n${state}\n\n这是最后一步：不要再执行任何动作，请直接基于已有信息给出最终答复。`
    : `--- 页面状态 ---\n${state}\n\n请根据页面状态决定下一步操作。`;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversation,
    { role: 'user', content: statePrompt }
  ];

  let fullContent = '';
  let visible = true;
  const promptTokens = estimateTokens(JSON.stringify(messages));
  let completionTokens = 0;
  let lastTokenBroadcast = 0;

  const handleDelta = (delta) => {
    fullContent += delta;
    completionTokens += estimateTokens(delta);
    const now = Date.now();
    if (now - lastTokenBroadcast > 300) {
      lastTokenBroadcast = now;
      broadcastTokens(totalTokens + promptTokens + completionTokens);
    }
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
    const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let response = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (abortFlag) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiKey}`
          },
          body: JSON.stringify({ model: settings.model, messages, temperature: 0.1, stream: true }),
          signal: abortController.signal
        });
        if (response.ok) {
          break;
        }
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 2) {
            throw new Error(`HTTP ${response.status}`);
          }
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (error.name === 'AbortError') {
          throw error;
        }
        if (attempt === 2) {
          throw error;
        }
        await sleep(1500 * (attempt + 1));
      }
    }
    if (!response.body) {
      const data = await response.json();
      fullContent = data.choices && data.choices[0] ? data.choices[0].message.content : '';
      completionTokens += estimateTokens(fullContent);
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
            completionTokens += estimateTokens(content);
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
  } finally {
    totalTokens += promptTokens + completionTokens;
    broadcastTokens(totalTokens);
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
    case 'back':
      return `返回上一页`;
    case 'reload':
      return `刷新页面`;
    case 'click':
      return `点击 ${action.text || action.selector}`;
    case 'dblclick':
      return `双击 ${action.text || action.selector}`;
    case 'hover':
      return `悬停 ${action.text || action.selector}`;
    case 'focus':
      return `聚焦 ${action.text || action.selector}`;
    case 'scroll_to':
      return `滚动到 ${action.text || action.selector}`;
    case 'fill':
      return `输入 "${action.value}"` + (action.selector ? ` 到 ${action.selector}` : '');
    case 'type':
      return `逐字输入 "${action.text}"`;
    case 'clear':
      return `清空输入框`;
    case 'select':
      return `选择 ${action.selector} 的选项 ${action.value || action.label}`;
    case 'check':
      return `勾选 ${action.text || action.selector}`;
    case 'press':
      return `按 ${action.key}`;
    case 'submit':
      return `提交表单`;
    case 'scroll':
      return `滚动页面 ${action.direction}`;
    case 'wait':
      return `等待 ${action.ms}ms`;
    case 'wait_for':
      return `等待元素 ${action.text || action.selector}`;
    case 'extract':
      return `提取 ${action.text || action.selector}`;
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
    const target = action.text
      ? { text: action.text }
      : action.selector
        ? { selector: action.selector }
        : null;

    switch (action.action) {
      case 'goto':
        await evalInPage(tabId, gotoScript, [action.url]);
        await sleep(1500);
        return { ok: true };

      case 'back':
        await evalInPage(tabId, backScript, []);
        await sleep(1200);
        return { ok: true };

      case 'reload':
        await evalInPage(tabId, reloadScript, []);
        await sleep(1200);
        return { ok: true };

      case 'click':
      case 'dblclick':
      case 'hover':
      case 'focus':
      case 'scroll_to': {
        const frames = await evalInAllFrames(tabId, domOpScript, [action.action, target, null]);
        const done = frames.some((r) => r.result === true);
        if (!done) {
          return { ok: false, error: '未找到目标元素' };
        }
        if (action.action === 'click' || action.action === 'dblclick') {
          await sleep(600);
        }
        return { ok: true };
      }

      case 'fill':
        if (target) {
          const frames = await evalInAllFrames(tabId, domOpScript, [
            'fill_selector',
            target,
            action.value
          ]);
          return frames.some((r) => r.result === true)
            ? { ok: true }
            : { ok: false, error: '未找到输入框' };
        }
        {
          const frames = await evalInAllFrames(tabId, domOpScript, [
            'fill_focused',
            null,
            action.value
          ]);
          return frames.some((r) => r.result === true)
            ? { ok: true }
            : { ok: false, error: '没有可输入的聚焦元素' };
        }

      case 'type': {
        const frames = await evalInAllFrames(tabId, domOpScript, ['type', null, action.text]);
        return frames.some((r) => r.result === true)
          ? { ok: true }
          : { ok: false, error: '没有可输入的聚焦元素' };
      }

      case 'clear': {
        const frames = await evalInAllFrames(tabId, domOpScript, ['clear', target, null]);
        return frames.some((r) => r.result === true)
          ? { ok: true }
          : { ok: false, error: '未找到输入框' };
      }

      case 'select': {
        const frames = await evalInAllFrames(tabId, domOpScript, [
          'select',
          target,
          { value: action.value, label: action.label }
        ]);
        return frames.some((r) => r.result === true)
          ? { ok: true }
          : { ok: false, error: '未找到下拉选项' };
      }

      case 'check': {
        const frames = await evalInAllFrames(tabId, domOpScript, [
          'check',
          target,
          { checked: action.checked }
        ]);
        return frames.some((r) => r.result === true)
          ? { ok: true }
          : { ok: false, error: '未找到复选框' };
      }

      case 'submit': {
        const frames = await evalInAllFrames(tabId, domOpScript, ['submit', target, null]);
        const done = frames.some((r) => r.result === true);
        if (!done) {
          return { ok: false, error: '未找到表单' };
        }
        await sleep(800);
        return { ok: true };
      }

      case 'press':
        await evalInAllFrames(tabId, pressKeyScript, [action.key]);
        await sleep(400);
        return { ok: true };

      case 'scroll':
        await evalInPage(tabId, scrollScript, [action.direction]);
        return { ok: true };

      case 'wait':
        await sleep(action.ms || 1000);
        return { ok: true };

      case 'wait_for': {
        const deadline = Date.now() + (action.timeout || 10000);
        const probe = action.text ? [action.text, null] : [null, action.selector];
        while (Date.now() < deadline) {
          if (abortFlag) {
            return { ok: true };
          }
          const frames = await evalInAllFrames(tabId, waitForScript, probe);
          if (frames.some((r) => r.result === true)) {
            return { ok: true };
          }
          await sleep(500);
        }
        return { ok: false, error: '等待目标超时' };
      }

      case 'extract': {
        const frames = await evalInAllFrames(tabId, domOpScript, ['extract', target, null]);
        const hit = frames.find((r) => typeof r.result === 'string' && r.result.trim());
        const content = hit ? hit.result.trim() : '';
        if (!content) {
          return { ok: false, error: '未找到可提取的内容' };
        }
        const snippet = content.slice(0, 4000);
        conversation.push({ role: 'user', content: `<tool_result name="extract" status="success">${snippet}</tool_result>` });
        notify({ type: 'agent-message', role: 'tool', text: `[已提取]\n${snippet.slice(0, 500)}` });
        return { ok: true };
      }

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
        conversation.push({ role: 'user', content: `<tool_result name="extract_table" status="success">${summary}</tool_result>` });
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
        conversation.push({ role: 'user', content: `<tool_result name="save_table" status="success">已保存文件 ${filename}</tool_result>` });
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
  const interactive = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(
    'input,textarea,select,button,a,[role=button],[role=combobox],[role=textbox]'
  )) {
    if (!el.getClientRects || el.getClientRects().length === 0) {
      continue;
    }
    let desc;
    if (
      el.tagName === 'BUTTON' ||
      el.tagName === 'A' ||
      el.getAttribute('role') === 'button' ||
      el.getAttribute('role') === 'combobox'
    ) {
      desc =
        (el.innerText || '').replace(/\s+/g, ' ').trim() || el.getAttribute('href') || '';
    } else {
      const type = el.getAttribute('type');
      const ph = el.getAttribute('placeholder');
      const name = el.getAttribute('name');
      desc = [
        el.tagName.toLowerCase(),
        type ? `type=${type}` : '',
        ph ? `placeholder="${ph}"` : '',
        name ? `name="${name}"` : ''
      ]
        .filter(Boolean)
        .join(' ');
    }
    if (desc && !seen.has(desc)) {
      seen.add(desc);
      interactive.push(desc);
    }
  }
  return {
    url: location.href,
    title: document.title,
    text: text.slice(0, limit),
    interactive: interactive.slice(0, 60)
  };
}

function gotoScript(url) {
  location.href = url;
  return true;
}

function backScript() {
  history.back();
  return true;
}

function reloadScript() {
  location.reload();
  return true;
}

function domOpScript(kind, target, extra) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => el.getClientRects && el.getClientRects().length > 0;
  const findByText = (text) => {
    const t = String(text);
    const all = [
      ...document.querySelectorAll(
        'a,button,input,textarea,[role=button],[role=link],[role=menuitem],label,span,div,li'
      )
    ].filter((el) => visible(el) && norm(el.innerText));
    const exact = all.find((el) => norm(el.innerText) === norm(t));
    return exact || all.find((el) => norm(el.innerText).includes(norm(t))) || null;
  };
  const locate = () => {
    if (!target) {
      return null;
    }
    if (target.text) {
      return findByText(target.text);
    }
    if (target.selector) {
      return document.querySelector(target.selector);
    }
    return null;
  };
  const setValue = (el, value) => {
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
  };
  const isEditable = (el) =>
    !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  const mouse = (el, type) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));

  switch (kind) {
    case 'click': {
      const el = locate();
      if (!el) {
        return false;
      }
      el.click();
      return true;
    }
    case 'dblclick': {
      const el = locate();
      if (!el) {
        return false;
      }
      mouse(el, 'dblclick');
      return true;
    }
    case 'hover': {
      const el = locate();
      if (!el) {
        return false;
      }
      for (const t of ['pointerover', 'mouseover', 'mouseenter', 'mousemove']) {
        mouse(el, t);
      }
      return true;
    }
    case 'focus': {
      const el = locate();
      if (!el) {
        return false;
      }
      el.focus();
      return true;
    }
    case 'scroll_to': {
      const el = locate();
      if (!el) {
        return false;
      }
      el.scrollIntoView({ block: 'center' });
      return true;
    }
    case 'fill_selector': {
      const el = locate();
      if (!el) {
        return false;
      }
      if (el.focus) {
        el.focus();
      }
      setValue(el, extra);
      return true;
    }
    case 'fill_focused': {
      if (!document.hasFocus() || !isEditable(document.activeElement)) {
        return false;
      }
      setValue(document.activeElement, extra);
      return true;
    }
    case 'type': {
      if (!document.hasFocus() || !isEditable(document.activeElement)) {
        return false;
      }
      const el = document.activeElement;
      const value = String(extra);
      const proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : el.tagName === 'INPUT'
            ? window.HTMLInputElement.prototype
            : null;
      for (let i = 0; i < value.length; i++) {
        if (proto) {
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value.slice(0, i + 1));
        } else {
          el.textContent = value.slice(0, i + 1);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    case 'clear': {
      const el = target ? locate() : document.activeElement;
      if (!el || (target && !isEditable(el))) {
        return false;
      }
      setValue(el, '');
      return true;
    }
    case 'select': {
      const el = locate();
      if (!el || el.tagName !== 'SELECT') {
        return false;
      }
      if (extra && extra.value != null) {
        el.value = String(extra.value);
      } else if (extra && extra.label) {
        const opt = [...el.options].find((o) => norm(o.text) === norm(extra.label));
        if (!opt) {
          return false;
        }
        el.value = opt.value;
      } else {
        return false;
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    case 'check': {
      const el = locate();
      if (!el || el.tagName !== 'INPUT' || (el.type !== 'checkbox' && el.type !== 'radio')) {
        return false;
      }
      const checked = extra && extra.checked != null ? Boolean(extra.checked) : !el.checked;
      el.checked = checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      mouse(el, 'click');
      return true;
    }
    case 'submit': {
      const el = target ? locate() : document.activeElement;
      const form = el && (el.tagName === 'FORM' ? el : el.closest ? el.closest('form') : null);
      if (!form) {
        return false;
      }
      if (form.requestSubmit) {
        form.requestSubmit();
      } else {
        form.submit();
      }
      return true;
    }
    case 'extract': {
      if (target) {
        const el = locate();
        if (!el) {
          return '';
        }
        return norm(el.innerText || el.textContent);
      }
      const text = document.body ? document.body.innerText || document.body.textContent || '' : '';
      return text.slice(0, 4000);
    }
  }
  return false;
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
    PageDown: 34,
    ' ': 32
  };
  const parts = String(key)
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);
  const keyName = parts[parts.length - 1];
  const modifiers = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  for (const p of parts.slice(0, -1)) {
    if (/^(ctrl|control)$/i.test(p)) {
      modifiers.ctrlKey = true;
    } else if (/^alt$/i.test(p)) {
      modifiers.altKey = true;
    } else if (/^shift$/i.test(p)) {
      modifiers.shiftKey = true;
    } else if (/^(meta|win|command)$/i.test(p)) {
      modifiers.metaKey = true;
    }
  }
  const target = document.activeElement || document.body;
  const code = keyCodes[keyName] || keyName.charCodeAt(0);
  const init = {
    key: keyName,
    code: keyName,
    keyCode: code,
    which: code,
    bubbles: true,
    cancelable: true,
    ...modifiers
  };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  if (
    keyName === 'Enter' &&
    !modifiers.ctrlKey &&
    !modifiers.altKey &&
    target.form &&
    target.form.requestSubmit
  ) {
    target.form.requestSubmit();
  }
  return true;
}

function waitForScript(text, selector) {
  if (selector) {
    return !!document.querySelector(selector);
  }
  const t = String(text);
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  return !![...document.querySelectorAll('a,button,input,textarea,span,div,li,[role=button]')].find(
    (el) => el.getClientRects && el.getClientRects().length > 0 && norm(el.innerText).includes(norm(t))
  );
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
