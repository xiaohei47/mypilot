const DEFAULTS = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  maxIterations: 20,
  maxStateChars: 6000,
  showThinking: false
};

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro']
  },
  custom: {
    name: '自定义',
    baseUrl: '',
    models: []
  }
};

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
21. {"action":"collect_images"} - 抓取当前页面所有图片，打包为 zip 下载
22. {"action":"run_js","code":"..."} - 在页面直接执行一段 JavaScript 代码并返回结果。用于普通操作实现不了的效果：隐藏/显示元素、修改样式、绕过页面限制、点击 shadow DOM 内部元素、操作 canvas 等。代码是立即执行函数体，可用 return 返回结果（会被序列化为文本）；不要用 console.log 输出结果。代码会分别注入页面的每个 frame 执行，document 指向所在 frame，直接操作即可，无需访问 window.parent 或跨域 hack。

其它:
23. {"action":"ask","question":"..."} - 任务不明确时询问用户

规则：
- 使用 run_js 时，代码应当健壮：用 try/catch 包裹，对可能不存在的元素做判空；不要访问 window.parent/top 去操作别的 frame。
- run_js 执行成功即视为该步完成：只要返回 status="success" 且不是"未找到"，就不要再检查、不要重复执行相同代码，直接基于已有信息给出最终答复。
- 如果 run_js 返回"未找到"类结果，说明目标不在当前已注入的页面里，直接说明原因并结束，不要尝试跨 frame 访问，也不要乱点无关元素试探。
- 页面状态中包含"可交互元素"列表（输入框/按钮/下拉等），优先据此选择操作目标。
- 点击目标优先使用精确的可见文本。
- 如果可交互元素列表中找不到用户要操作的目标，说明该目标当前不在页面上或名称不对：不要原样重复操作，先 extract 查看页面实际内容，再决定是换个名称还是说明找不到。
- 一次只执行一步操作，等待下一页状态后再继续。
- 任务模糊时使用 ask 询问用户，而不是猜测。
- 当用户明确表示不需要操作网页（如"聊天""闲聊""不做网页操作"）时，忽略页面状态，直接用自然语言回复，不要输出任何 JSON 动作，也不要询问关于网页内容的问题。
- 任务完成时，直接用自然语言输出最终答复（不要输出 JSON）。
- 无法推进任务时，也用自然语言说明原因并结束。
- 当用户要求"整理/输出/导出表格文件"时：先 extract_table 查看内容，再用 save_table 保存为文件，最后用自然语言总结。
- 当用户要求"下载/抓取/保存页面图片"时：直接使用 collect_images 打包下载，完成后用自然语言总结。
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

function broadcastTitle(title) {
  void chrome.runtime.sendMessage({ type: 'agent-title', title }).catch(() => {});
}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// 侧边栏打开期间通过长连接保活 service worker,避免 agent 循环中途被回收
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') {
    port.onDisconnect.addListener(() => {});
  }
});

// 启动时恢复设置与上一次的活动对话(service worker 重启后内存状态会丢失)
// settingsReady 确保冷启动时 get-settings / handleRun 等到设置加载完成，避免首次打开误报"未配置"
const settingsReady = chrome.storage.local
  .get([...Object.keys(DEFAULTS), 'mypilot_state'])
  .then((saved) => {
    for (const key of Object.keys(DEFAULTS)) {
      if (saved[key] !== undefined) {
        settings[key] = saved[key];
      }
    }
    const state = saved.mypilot_state;
    if (state && state.conversationId) {
      currentConversationId = state.conversationId;
      currentTitle = state.title || '';
      conversation = Array.isArray(state.conversation) ? state.conversation : [];
      uiLog = Array.isArray(state.uiLog) ? state.uiLog : [];
      totalTokens = state.tokens || 0;
    }
  })
  .catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'get-settings':
      void settingsReady.then(() => sendResponse({ settings, providers: PROVIDERS }));
      return true;
    case 'save-settings':
      settings = { ...DEFAULTS, ...message.settings };
      void chrome.storage.local.set(settings);
      sendResponse({ ok: true });
      return false;
    case 'page-title':
      void (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        sendResponse({ title: tab && tab.title ? tab.title : '' });
      })();
      return true;
    case 'account-balance':
      void (async () => {
        if (settings.provider !== 'deepseek' || !settings.apiKey) {
          sendResponse({ ok: false, error: '当前提供商不支持余额查询' });
          return;
        }
        try {
          const response = await fetch('https://api.deepseek.com/user/balance', {
            headers: { Authorization: `Bearer ${settings.apiKey}` }
          });
          if (!response.ok) {
            sendResponse({ ok: false, error: `HTTP ${response.status}` });
            return;
          }
          const data = await response.json();
          const info = data.balance_infos && data.balance_infos[0];
          if (!info) {
            sendResponse({ ok: false, error: '未获取到余额信息' });
            return;
          }
          sendResponse({ ok: true, currency: info.currency, balance: info.total_balance });
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
      })();
      return true;
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
        totalTokens = found.tokens || 0;
        broadcastTokens(totalTokens);
        await persistConversation();
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
    case 'history-delete':
      void (async () => {
        const { conversations = [] } = await chrome.storage.local.get('conversations');
        await chrome.storage.local.set({ conversations: conversations.filter((c) => c.id !== message.id) });
        sendResponse({ ok: true });
      })();
      return true;
    case 'get-tokens':
      sendResponse({ tokens: totalTokens, title: currentTitle });
      return false;
    case 'history-new':
      void (async () => {
        if (currentConversationId && conversation.length) {
          await persistConversation();
        }
        currentConversationId = null;
        conversation = [];
        uiLog = [];
        totalTokens = 0;
        currentTitle = '';
        broadcastTitle(currentTitle);
        await chrome.storage.local.set({ mypilot_state: null });
        sendResponse({ ok: true });
      })();
      return true;
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

function pushConversation(role, content) {
  conversation.push({ role, content });
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
    tokens: totalTokens,
    updatedAt: Date.now()
  };
  const next = [entry, ...conversations.filter((c) => c.id !== currentConversationId)].slice(0, 20);
  await chrome.storage.local.set({
    conversations: next,
    mypilot_state: {
      conversationId: currentConversationId,
      title: currentTitle,
      conversation: conversation.slice(),
      uiLog: uiLog.slice(),
      tokens: totalTokens,
      updatedAt: Date.now()
    }
  });
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

// 按 frame 顺序执行动作：先探测所有 frameId，main frame（0）优先，逐 frame 执行，
// 找到第一个成功结果即停止。避免同名元素（如"确定"按钮）在多个 frame 中被重复点击。
async function evalInFramesSequential(tabId, fn, args, isSuccess) {
  let frameIds = [];
  try {
    const probe = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => true,
      args: []
    });
    frameIds = probe.map((r) => r.frameId);
  } catch {
    frameIds = [0];
  }
  frameIds.sort((a, b) => a - b);
  for (const frameId of frameIds) {
    if (abortFlag) {
      return { found: false };
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: 'MAIN',
        func: fn,
        args: args || []
      });
      const result = results && results[0] ? results[0].result : undefined;
      if (isSuccess(result)) {
        return { found: true, result };
      }
    } catch {
      // frame 已导航或不可访问，跳过
    }
  }
  return { found: false };
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
  pushConversation('user', userText);
  logMessage('user', userText);

  try {
    await settingsReady;
    if (!settings.apiKey) {
      throw new Error('请先点击右上角 ⚙ 配置 API Key');
    }
    const tab = await getActiveTab();
    let tabProtocol = '';
    if (tab && tab.url) {
      try {
        tabProtocol = new URL(tab.url).protocol;
      } catch {
        tabProtocol = '';
      }
    }
    if (!tab || !/^https?:$/.test(tabProtocol)) {
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
  let lastError = '';
  let repeatCount = 0;
  let cycleKey1 = null;
  let cycleKey2 = null;
  let cycleCount = 0;

  for (let i = 0; i < settings.maxIterations; i++) {
    if (abortFlag) {
      notify({ type: 'agent-message', role: 'system', text: '已停止' });
      return;
    }

    const chatOnly = isChatOnly();
    const state = chatOnly ? '' : await collectState(tabId);
    let model;
    notify({ type: 'agent-thinking', on: true });
    try {
      model = await askModel(state, i === settings.maxIterations - 1, chatOnly);
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

    if (i === settings.maxIterations - 1) {
      notify({ type: 'agent-message', role: 'system', text: '已达最后一步，结束任务。' });
      return;
    }

    const actionKey = JSON.stringify(action);
    if (actionKey === lastActionKey) {
      repeatCount++;
      if (lastActionOk && repeatCount >= 3) {
        notify({
          type: 'agent-message',
          role: 'system',
          text: `动作「${describeAction(action)}」被多次重复，可能已生效但模型未感知，已停止。`
        });
        return;
      }
      if (!lastActionOk && repeatCount >= 3) {
        notify({
          type: 'agent-message',
          role: 'system',
          text: `动作「${describeAction(action)}」已连续失败多次（${lastError}），目标可能不存在或无法操作，已停止。`
        });
        return;
      }
      const msg = lastActionOk
        ? `动作「${describeAction(action)}」上次已执行成功，请勿重复，直接基于已有信息给出最终答复。`
        : `动作「${describeAction(action)}」上次执行失败（${lastError}），请不要再原样重试。先用 extract 查看页面实际内容，确认目标名称后换一种方式操作，或直接说明原因结束。`;
      pushConversation(
        'user',
        `<tool_result name="${action.action}" status="skipped">${msg}</tool_result>`
      );
      notify({
        type: 'agent-message',
        role: 'system',
        text: `动作（${describeAction(action)}）重复，已提醒模型换一种方式。`
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

    if (action.action !== 'ask') {
      notify({ type: 'agent-message', role: 'tool', text: `[动作] ${describeAction(action)}` });
    }
    const result = await executeAction(tabId, action);
    if (!result.ok) {
      lastActionKey = actionKey;
      lastActionOk = false;
      lastError = result.error;
      repeatCount = 0;
      pushConversation(
        'user',
        `<tool_result name="${action.action}" status="error">${result.error}</tool_result>`
      );
      notify({ type: 'agent-message', role: 'system', text: `执行失败：${result.error}` });
    } else if (result.stop) {
      return;
    } else {
      lastActionKey = actionKey;
      lastActionOk = true;
      lastError = '';
      repeatCount = 0;
      pushConversation(
        'user',
        `<tool_result name="${action.action}" status="success">${describeAction(action)}</tool_result>`
      );
    }
  }
  notify({ type: 'agent-message', role: 'system', text: `已达到最大操作次数（${settings.maxIterations}）` });
}

// 检测用户最近指令是否纯聊天（不涉及网页操作），用于跳过页面状态采集。
// 只参考最近一条用户消息（排除 <tool_result> 系统反馈），命中"聊天/不操作网页"类信号即返回 true。
function isChatOnly() {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const m = conversation[i];
    if (m.role === 'user' && !String(m.content).startsWith('<tool_result')) {
      return /聊天|聊聊天|聊聊|聊一聊|闲聊|吹水|讨论|谈谈|问答|答疑|不操作网页|不做网页操作|别操作网页|不用操作网页|不需要操作网页|不.*操作(网页|网站)/.test(
        String(m.content)
      );
    }
  }
  return false;
}

async function collectState(tabId) {
  try {
    const frames = await evalInAllFrames(tabId, getStateScript, [settings.maxStateChars]);
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

async function askModel(state, lastStep, chatOnly) {
  if (conversation.length > 40) {
    conversation = conversation.slice(-40);
  }
  const statePrompt = lastStep
    ? `--- 页面状态 ---\n${state}\n\n这是最后一步：不要再执行任何动作，请直接基于已有信息给出最终答复。`
    : chatOnly
      ? `用户当前不需要操作网页（纯聊天/问答/讨论）。请忽略页面内容，直接以自然语言回复，不要输出任何 JSON 动作，也不要询问关于网页内容的问题。`
      : `--- 页面状态 ---\n${state}\n\n请根据页面状态决定下一步操作。`;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversation,
    { role: 'user', content: statePrompt }
  ];

  let fullContent = '';
  let visible = true;
  let shownLen = 0;
  let thinkingContent = '';
  let thinkingStarted = false;
  const promptTokens = estimateTokens(JSON.stringify(messages));
  let completionTokens = 0;
  let lastTokenBroadcast = 0;

  const startThinking = () => {
    if (!settings.showThinking || thinkingStarted) {
      return;
    }
    thinkingStarted = true;
    notify({ type: 'agent-reasoning-start' });
  };

  const broadcastThinking = (delta) => {
    if (!settings.showThinking) {
      return;
    }
    startThinking();
    thinkingContent += delta;
    notify({ type: 'agent-reasoning-delta', delta });
  };

  const endThinking = () => {
    if (!settings.showThinking || !thinkingStarted) {
      return;
    }
    thinkingStarted = false;
    notify({ type: 'agent-reasoning-end', text: thinkingContent });
    if (thinkingContent.trim()) {
      logMessage('reasoning', thinkingContent);
    }
  };

  const handleDelta = (delta) => {
    endThinking();
    fullContent += delta;
    completionTokens += estimateTokens(delta);
    const now = Date.now();
    if (now - lastTokenBroadcast > 300) {
      lastTokenBroadcast = now;
      broadcastTokens(totalTokens + promptTokens + completionTokens);
    }
    if (!visible) {
      return;
    }
    // 一旦出现 JSON 动作区（``` 开头的 code-fence 或第一个 {）就停止流式显示，
    // 只把动作区之前的内容（若有）显示出来，避免 JSON 原文泄露到界面上。
    const t = fullContent.trimStart();
    const start = t.startsWith('```') ? 0 : t.search(/\{/);
    if (start === -1) {
      notify({ type: 'agent-stream', delta });
      shownLen = t.length;
      return;
    }
    const before = t.slice(shownLen, start);
    if (before) {
      notify({ type: 'agent-stream', delta: before });
    }
    visible = false;
  };

  const readStream = async (response, onEvent) => {
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
        if (line.trim().startsWith('data:')) {
          onEvent(line.slice(5).trim());
        }
      }
    }
    if (buffer.trim().startsWith('data:')) {
      onEvent(buffer.slice(5).trim());
    }
    return rawAll;
  };

  const requestOpenAI = async () => {
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
      const rawAll = await readStream(response, (data) => {
        if (!data || data === '[DONE]') {
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices && parsed.choices[0];
          const deltaObj = choice && choice.delta ? choice.delta : {};
          if (deltaObj.reasoning_content) {
            broadcastThinking(deltaObj.reasoning_content);
          }
          const delta = deltaObj.content || null;
          if (delta) {
            handleDelta(delta);
          }
        } catch {
          /* 忽略无法解析的事件 */
        }
      });
      if (!fullContent && rawAll.trim()) {
        try {
          const data = JSON.parse(rawAll.trim());
          const msg = data.choices && data.choices[0] ? data.choices[0].message : null;
          if (msg && msg.reasoning_content && settings.showThinking) {
            broadcastThinking(msg.reasoning_content);
          }
          const content = msg ? msg.content : '';
          if (content) {
            endThinking();
            fullContent = content;
            completionTokens += estimateTokens(content);
            const t = content.trimStart();
            const start = t.startsWith('```') ? 0 : t.search(/\{/);
            if (start === -1) {
              notify({ type: 'agent-stream', delta: content });
            } else if (start > 0) {
              notify({ type: 'agent-stream', delta: t.slice(0, start) });
            }
          }
        } catch {
          /* 非 SSE 格式且无法解析 */
        }
      }
    }
  };

  try {
    await requestOpenAI();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    throw new Error(`LLM 调用失败: ${error.message}`);
  } finally {
    endThinking();
    totalTokens += promptTokens + completionTokens;
    broadcastTokens(totalTokens);
  }

  pushConversation('assistant', fullContent);
  return { content: fullContent, streamed: visible && fullContent.trim() !== '' };
}

// 最终答复判定与 parseAction 保持一致：能解析出动作（含 code-fence 包裹/尾部混入 JSON）才算动作，
// 否则一律视为最终答复。避免 ```json 包裹的 JSON 被误当答复、自然语言后跟 JSON 被吞掉。
function isFinalResponse(model) {
  return !parseAction(model.content);
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
    case 'collect_images':
      return `抓取页面所有图片并打包下载`;
    case 'run_js':
      return `执行页面脚本`;
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
      case 'goto': {
        const url = normalizeUrl(action.url);
        if (!url) {
          return { ok: false, error: '无效的 URL，请提供一个以 http(s):// 开头的有效地址。' };
        }
        await evalInPage(tabId, gotoScript, [url]);
        await waitForPageLoad(tabId, 8000);
        return { ok: true };
      }

      case 'back':
        await evalInPage(tabId, backScript, []);
        await waitForPageLoad(tabId, 6000);
        return { ok: true };

      case 'reload':
        await evalInPage(tabId, reloadScript, []);
        await waitForPageLoad(tabId, 6000);
        return { ok: true };

      case 'click':
      case 'dblclick':
      case 'hover':
      case 'focus':
      case 'scroll_to': {
        const { found } = await evalInFramesSequential(
          tabId,
          domOpScript,
          [action.action, target, null],
          (r) => r === true
        );
        if (!found) {
          return { ok: false, error: '未找到目标元素' };
        }
        if (action.action === 'click' || action.action === 'dblclick') {
          await sleep(600);
        }
        return { ok: true };
      }

      case 'fill':
        if (target) {
          const { found: f1 } = await evalInFramesSequential(
            tabId,
            domOpScript,
            ['fill_selector', target, action.value],
            (r) => r === true
          );
          return f1 ? { ok: true } : { ok: false, error: '未找到输入框' };
        }
        {
          const { found: f2 } = await evalInFramesSequential(
            tabId,
            domOpScript,
            ['fill_focused', null, action.value],
            (r) => r === true
          );
          return f2 ? { ok: true } : { ok: false, error: '没有可输入的聚焦元素' };
        }

      case 'type': {
        const { found } = await evalInFramesSequential(
          tabId,
          domOpScript,
          ['type', null, action.text],
          (r) => r === true
        );
        return found ? { ok: true } : { ok: false, error: '没有可输入的聚焦元素' };
      }

      case 'clear': {
        const { found } = await evalInFramesSequential(
          tabId,
          domOpScript,
          ['clear', target, null],
          (r) => r === true
        );
        return found ? { ok: true } : { ok: false, error: '未找到输入框' };
      }

      case 'select': {
        const { found } = await evalInFramesSequential(
          tabId,
          domOpScript,
          ['select', target, { value: action.value, label: action.label }],
          (r) => r === true
        );
        return found ? { ok: true } : { ok: false, error: '未找到下拉选项' };
      }

      case 'check': {
        const { found } = await evalInFramesSequential(
          tabId,
          domOpScript,
          ['check', target, { checked: action.checked }],
          (r) => r === true
        );
        return found ? { ok: true } : { ok: false, error: '未找到复选框' };
      }

      case 'submit': {
        const { found } = await evalInFramesSequential(
          tabId,
          domOpScript,
          ['submit', target, null],
          (r) => r === true
        );
        if (!found) {
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
        pushConversation('user', `<tool_result name="extract" status="success">${snippet}</tool_result>`);
        notify({ type: 'agent-message', role: 'tool', text: `[已提取]\n${snippet.slice(0, 500)}` });
        return { ok: true };
      }

      case 'ask':
        notify({ type: 'agent-message', role: 'agent', text: action.question });
        return { ok: true, stop: true };

      case 'done':
        notify({ type: 'agent-message', role: 'agent', text: action.answer });
        pushConversation('assistant', `任务完成：${action.answer}`);
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
        pushConversation('user', `<tool_result name="extract_table" status="success">${summary}</tool_result>`);
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
        pushConversation('user', `<tool_result name="save_table" status="success">已保存文件 ${filename}</tool_result>`);
        notify({ type: 'download-csv', filename, csv });
        notify({ type: 'agent-message', role: 'tool', text: `已生成文件：${filename}` });
        return { ok: true };
      }

      case 'collect_images': {
        const frames = await evalInAllFrames(tabId, collectImagesScript, []);
        const urls = [];
        const seen = new Set();
        for (const f of frames) {
          for (const u of f.result || []) {
            if (!seen.has(u)) {
              seen.add(u);
              urls.push(u);
            }
          }
        }
        if (!urls.length) {
          return { ok: false, error: '页面上没有找到图片' };
        }
        const files = [];
        for (let i = 0; i < urls.length; i++) {
          if (abortFlag) {
            break;
          }
          try {
            const res = await fetch(urls[i], { signal: abortController.signal });
            if (!res.ok) {
              continue;
            }
            const buf = new Uint8Array(await res.arrayBuffer());
            let binary = '';
            for (let j = 0; j < buf.length; j++) {
              binary += String.fromCharCode(buf[j]);
            }
            const ext = guessImageExt(urls[i], res.headers.get('content-type'));
            files.push({ name: `image_${i + 1}.${ext}`, base64: btoa(binary) });
          } catch {
            /* 跳过无法下载的图片 */
          }
        }
        if (!files.length) {
          return { ok: false, error: '图片下载失败（可能存在防盗链）' };
        }
        const filename = `images_${new Date().toISOString().slice(0, 10)}.zip`;
        pushConversation('user', `<tool_result name="collect_images" status="success">已打包下载 ${files.length}/${urls.length} 张图片</tool_result>`);
        notify({ type: 'download-bundle', filename, files });
        notify({ type: 'agent-message', role: 'tool', text: `已打包下载 ${files.length} 张图片：${filename}` });
        return { ok: true };
      }

      case 'run_js': {
        if (!action.code || !String(action.code).trim()) {
          return { ok: false, error: 'run_js 缺少 code 参数' };
        }
        const frames = await evalInAllFrames(tabId, runJsScript, [action.code]);
        const isFail = (t) => /未找到|没有找到|找不到|not\s*find|未发现/i.test(String(t || ''));
        const hit = frames.find((r) => r.result && r.result.ok && !isFail(r.result.text)) ||
          frames.find((r) => r.result && r.result.ok);
        const failed = frames.find((r) => r.result && !r.result.ok);
        if (!hit && !failed) {
          return { ok: false, error: '脚本没有返回结果' };
        }
        const result = hit ? hit.result : failed.result;
        if (!result.ok) {
          return { ok: false, error: `脚本执行失败: ${result.error}` };
        }
        const text = result.text || '(无返回)';
        const snippet = text.slice(0, 4000);
        pushConversation('user', `<tool_result name="run_js" status="success">${snippet}</tool_result>`);
        notify({ type: 'agent-message', role: 'tool', text: `[脚本执行]\n${snippet.slice(0, 500)}` });
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

// 规范化 goto 目标：补全缺失的协议前缀并校验是否为合法 URL
function normalizeUrl(raw) {
  if (!raw) return '';
  let trimmed = String(raw).trim();
  if (!trimmed || /\s/.test(trimmed)) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    trimmed = 'https://' + trimmed;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

function gotoScript(url) {
  location.href = url;
  return true;
}

// 页面是否已加载出实质内容（用于导航后智能等待，避免 SPA 尚未渲染完就被采集为空状态）
function pageReadyScript() {
  if (document.readyState === 'loading') {
    return false;
  }
  const text = document.body && document.body.innerText ? document.body.innerText.trim() : '';
  return text.length >= 30;
}

// 导航后轮询等待页面就绪，最多等 timeoutMs
async function waitForPageLoad(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (abortFlag) {
      return;
    }
    try {
      if (await evalInPage(tabId, pageReadyScript, [])) {
        return;
      }
    } catch {
      // 页面正在跳转，忽略错误继续轮询
    }
    await sleep(300);
  }
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
  if (rows.length > 1) {
    const width = rows[0].length;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.length === width + 1 && r[0] === '') {
        rows[i] = r.slice(1);
      }
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

function collectImagesScript() {
  const urls = [];
  const seen = new Set();
  const push = (u) => {
    if (!u || /^data:|^blob:|^javascript:/i.test(u)) {
      return;
    }
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };
  for (const img of document.querySelectorAll('img')) {
    push(img.currentSrc || img.src);
    push(img.getAttribute('src'));
  }
  for (const el of document.querySelectorAll('source')) {
    push(el.getAttribute('src') || el.getAttribute('srcset'));
  }
  for (const el of document.querySelectorAll('[style*="background-image"]')) {
    const m = el.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
    if (m) {
      push(m[1]);
    }
  }
  return urls;
}

function guessImageExt(url, contentType) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };
  if (map[type]) {
    return map[type];
  }
  const m = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
  if (m) {
    return m[1];
  }
  return 'jpg';
}

function runJsScript(code) {
  try {
    let value;
    try {
      value = new Function(`return (${code});`)();
    } catch {
      value = new Function(code)();
    }
    if (value && typeof value === 'object' && value.status === 'error') {
      return { ok: false, error: value.message || '脚本返回 error' };
    }
    let text;
    if (value === null || value === undefined) {
      text = String(value);
    } else if (typeof value === 'string') {
      text = value;
    } else if (typeof value === 'object') {
      try {
        text = JSON.stringify(value);
      } catch {
        text = String(value);
      }
    } else {
      text = String(value);
    }
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
