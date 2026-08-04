import 'dotenv/config';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 9223);

let openai = null;

function getOpenAI() {
  if (openai) {
    return openai;
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('未配置 OPENAI_API_KEY，请在 server/.env 中填写（参考 .env.example）');
  }
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined
  });
  return openai;
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_ITERATIONS = 15;
const MAX_STATE_CHARS = 6000;

const clients = new Set();
let browser = null;
let page = null;
let conversation = [];
let running = false;
let abortFlag = false;

const wss = new WebSocketServer({ port: PORT });
console.log(`PlayAgent server 监听 ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('客户端已连接');
  send(ws, { type: 'system', text: '已连接到 PlayAgent server' });

  ws.on('message', async (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (message.action === 'run') {
      await handleRun(message.text);
    } else if (message.action === 'stop') {
      abortFlag = true;
    }
  });

  ws.on('close', () => clients.delete(ws));
});

function send(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(message) {
  for (const ws of clients) {
    send(ws, message);
  }
}

async function handleRun(userText) {
  if (running) {
    broadcast({ type: 'message', role: 'system', text: '已有任务正在执行，请等待完成或点击「停止」' });
    return;
  }
  running = true;
  abortFlag = false;
  conversation.push({ role: 'user', content: userText });

  try {
    if (!browser) {
      broadcast({ type: 'message', role: 'tool', text: '[动作] 启动浏览器…' });
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
    }
    await runAgentLoop();
  } catch (error) {
    console.error(error);
    broadcast({ type: 'error', text: error.message });
  } finally {
    running = false;
    broadcast({ type: 'done' });
  }
}

async function runAgentLoop() {
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (abortFlag) {
      broadcast({ type: 'message', role: 'system', text: '已停止' });
      return;
    }

    const state = await collectState();
    const model = await askModel(state);
    const text = model.content || '';

    if (!text.trim()) {
      broadcast({ type: 'message', role: 'agent', text: '（模型没有给出响应）' });
      return;
    }

    if (isFinalResponse(model)) {
      broadcast({ type: 'message', role: 'agent', text });
      return;
    }

    const action = parseAction(text);
    if (!action) {
      broadcast({ type: 'message', role: 'agent', text });
      broadcast({ type: 'message', role: 'system', text: '无法解析操作，请换个说法重试。' });
      return;
    }

    broadcast({ type: 'message', role: 'tool', text: `[动作] ${describeAction(action)}` });
    const result = await executeAction(action);
    if (!result.ok) {
      broadcast({ type: 'message', role: 'system', text: `执行失败：${result.error}` });
    } else if (result.stop) {
      return;
    }
  }
  broadcast({ type: 'message', role: 'system', text: `已达到最大迭代次数（${MAX_ITERATIONS}）` });
}

async function collectState() {
  try {
    const url = page.url();
    const title = await page.title();
    const bodyText = await page
      .locator('body')
      .innerText({ timeout: 5000 })
      .catch(() => '');
    return `当前页面 URL: ${url}\n页面标题: ${title}\n\n页面可见内容:\n${bodyText.slice(0, MAX_STATE_CHARS)}`;
  } catch (error) {
    return `页面状态获取失败: ${error.message}`;
  }
}

const SYSTEM_PROMPT = `你是一个网页自动化 AI Agent，通过浏览器操作完成用户的任务。

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

规则：
- 根据页面可见内容选择点击目标，优先使用精确的可见文本。
- 一次只执行一步操作，等待下一页状态后再继续。
- 任务模糊时使用 ask 询问用户，而不是猜测。
- 任务完成时使用 done 返回最终答案。
- 无法推进任务时使用 done 说明原因。`;

async function askModel(state) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversation,
    { role: 'user', content: `--- 页面状态 ---\n${state}\n\n请根据页面状态决定下一步操作。` }
  ];
  try {
    const response = await getOpenAI().chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.1
    });
    const content = response.choices[0].message.content;
    conversation.push({ role: 'assistant', content });
    return { content };
  } catch (error) {
    throw new Error(`LLM 调用失败: ${error.message}`);
  }
}

function isFinalResponse(model) {
  const text = model.content.trim();
  if (text.startsWith('{')) {
    return false;
  }
  return true;
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
    default:
      return JSON.stringify(action);
  }
}

async function executeAction(action) {
  try {
    switch (action.action) {
      case 'goto':
        await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return { ok: true };

      case 'click': {
        let locator;
        if (action.text) {
          locator = page.getByText(action.text, { exact: false }).first();
        } else {
          locator = page.locator(action.selector).first();
        }
        await locator.click({ timeout: 10000 });
        return { ok: true };
      }

      case 'fill':
        if (action.selector) {
          await page.fill(action.selector, action.value, { timeout: 10000 });
        } else {
          await page.keyboard.type(action.value, { delay: 10 });
        }
        return { ok: true };

      case 'press':
        await page.keyboard.press(action.key);
        return { ok: true };

      case 'scroll':
        await page.mouse.wheel(0, action.direction === 'down' ? 800 : -800);
        return { ok: true };

      case 'wait':
        await page.waitForTimeout(action.ms || 1000);
        return { ok: true };

      case 'ask':
        broadcast({ type: 'message', role: 'agent', text: action.question });
        return { ok: true, stop: true };

      case 'done':
        broadcast({ type: 'message', role: 'agent', text: action.answer });
        conversation.push({ role: 'assistant', content: `任务完成：${action.answer}` });
        return { ok: true, stop: true };

      default:
        return { ok: false, error: `未知操作: ${action.action}` };
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

process.on('SIGINT', async () => {
  if (browser) {
    await browser.close().catch(() => {});
  }
  process.exit(0);
});
