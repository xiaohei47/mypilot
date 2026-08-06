# MyPilot

AI Agent 驱动的浏览器自动化 Chrome 扩展，完全自包含（无外部 server）。

基于 `chrome.scripting` API 在扩展内注入 JS 控制当前标签页，LLM 调用 OpenAI 兼容接口。

## 架构

```
┌────────────────────────────────────────────┐
│ Chrome Extension (MyPilot)                  │
│ ├─ sidepanel (Chat UI + 设置面板)          │
│ └─ background.js (service worker)          │
│    ├─ chrome.scripting 注入 JS 控制页面    │
│    └─ fetch → OpenAI 兼容 LLM API          │
└────────────────────────────────────────────┘
```

## 使用方法

1. 打开 `chrome://extensions`
2. 开启「开发者模式」→「加载已解压的扩展程序」，选择本目录
3. 打开侧边栏，点击右上角 ⚙ 配置：
   - **提供商** — 内置 DeepSeek（base URL 和模型自动带出），或选「自定义」手填
   - **API Key** — 对应提供商的 Key
   - **Base URL / Model** — 内置 DeepSeek 会自动填充，可手动覆盖；「自定义」可手填任意 OpenAI 兼容接口（如 Ollama 本地 `http://localhost:11434/v1`）
   - **最大操作次数** — Agent 单次任务最多执行的操作步数（默认 20）
   - **显示思考过程** — 开启后展示模型推理内容（DeepSeek 等带 reasoning 的模型），默认关闭
4. 在任意 http/https 页面输入任务（如「在搜索框输入 playwright 并回车」）

Agent 会逐步操作你当前正在看的标签页，并汇报进度。遇到不明确的地方会反问，直接回复即可继续；可随时点「停止」。

## 支持的操作

| 操作 | 说明 |
|------|------|
| `goto` | 打开 URL |
| `click` | 按文本或 CSS 选择器点击 |
| `fill` | 在元素中填入文本 |
| `press` | 按键（Enter/Tab 等，部分站点不响应合成事件）|
| `scroll` | 页面滚动 |
| `wait` | 等待 |
| `ask` | 向用户提问 |
| `done` | 任务完成并返回答案 |
| `collect_images` | 抓取当前页面所有图片并打包为 zip 下载 |
| `run_js` | 在页面直接执行一段 JS 代码（隐藏元素、绕过限制、操作 shadow DOM 等） |

## 权限说明

- 权限：`sidePanel`、`scripting`、`storage`；`host_permissions` 覆盖 http/https。
- 相比 `chrome.debugger` 版：无隐藏 headless 浏览器，操作过程肉眼可见；`press` 键盘事件为合成事件（`isTrusted:false`），个别站点可能不响应，这是相对 CDP 的已知短板。
- 使用 `<all_urls>` 通配 host 权限，上架 Chrome Web Store 时会触发额外人工审核（Automa 等自动化扩展同样如此），个人使用不受影响。
