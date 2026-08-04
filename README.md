# PlayAgent

基于 Playwright + OpenAI 兼容 LLM 的 AI Agent Chrome 扩展。

## 架构

```
┌──────────────────────────┐     WebSocket      ┌──────────────────────────────┐
│ Chrome Extension         │◄──────────────────►│ PlayAgent Server (Node.js)   │
│ ├─ sidepanel (Chat UI)   │   ws://localhost   │ ├─ LLM 推理 (OpenAI 兼容)     │
│ └─ background.js (桥接)   │       :9223        │ └─ Playwright 浏览器自动化     │
└──────────────────────────┘                    └──────────────────────────────┘
```

## 使用方法

### 1. 启动 Server

```bash
cd server
npm install
npx playwright install chromium   # 首次使用，下载浏览器
cp .env.example .env              # 然后编辑 .env 填入 API Key
npm start
```

`.env` 配置项：

- `OPENAI_API_KEY` - API Key（支持 OpenAI、DeepSeek、Moonshot、Ollama 等）
- `OPENAI_BASE_URL` - 兼容端点，例如 `https://api.deepseek.com/v1`
- `OPENAI_MODEL` - 模型名，例如 `gpt-4o-mini`、`deepseek-chat`
- `PORT` - 服务器端口，默认 `9223`

### 2. 加载扩展

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录（`playagent/`）
4. 点击工具栏图标打开侧边栏

### 3. 使用

- 在侧边栏输入任务（如「打开百度搜索 playwright，返回第一条结果的标题」）
- Agent 会逐步执行浏览器操作并汇报进度
- Agent 遇到不明确的地方会反问，此时直接回复即可继续
- 可以随时点击「停止」中断任务

## 支持的操作

| 操作 | 说明 |
|------|------|
| `goto` | 打开 URL |
| `click` | 按文本或 CSS 选择器点击 |
| `fill` | 在元素中填入文本 |
| `press` | 按键（Enter/Tab 等） |
| `scroll` | 页面滚动 |
| `wait` | 等待 |
| `ask` | 向用户提问 |
| `done` | 任务完成并返回答案 |

## 说明

- 浏览器以 headless 模式运行，页面不会被直接看到。
- 会话期间浏览器保持存活，可以在同一会话中连续对话式地下达指令。
