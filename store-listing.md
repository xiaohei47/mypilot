# Chrome Web Store 上架材料（MyPilot）

> 已注册开发者账号，以下为提交时需要填写的资料与注意事项。

## 0. 命名说明

- 扩展已更名为 **MyPilot**（避开 Google "Play Agent" 商标冲突）。

## 1. 提交文件

- 使用 `dist/mypilot-extension.zip`（已包含新图标，版本 0.6）
- 上传到 Chrome Web Store Developer Dashboard → "New Item" → 上传 zip
- 注意：上传 zip 前，先在本地 `chrome://extensions` 验证功能正常

## 2. 商店信息（Dashboard 填写）

**名称 (Name)**
```
MyPilot - AI Browser Automation Agent
```
> ≤45 字符。若只填 "MyPilot" 也可，更简洁。

**简短描述 (Short description，≤132 字符)**
```
AI browser automation agent. Describe a task in plain language and the agent operates the current page for you. Bring your own API key.
```

**详细描述 (Detailed description)**

建议用下面的英文版（覆盖面广），也可同时添加中文语言：

```
MyPilot is an AI browser automation agent that runs entirely inside your Chrome extension — no separate server or installation needed.

HOW IT WORKS
• Open the side panel and describe a task in plain language (e.g. "search for the latest pricing page and return the headline").
• The agent reads the current page (text, interactive elements, embedded frames), then operates the page step by step: navigate, click, type, fill forms, select dropdowns, check boxes, scroll, submit, extract content and save tables as CSV files.
• Every action is reported in the chat, and the final answer streams in real time.

KEY FEATURES
• 20+ browser actions, including hover, double-click, keyboard shortcuts (Ctrl+A), wait-for-element, and table extraction.
• Works across embedded iframes.
• Full conversation history: view past sessions and continue them anytime.
• Real-time token usage counter.
• Fully self-contained — no server, no external dependencies. Your browser is the automation engine.

PRIVACY
• Bring Your Own Key: connect any OpenAI-compatible endpoint (OpenAI, DeepSeek, Moonshot, Ollama, etc.).
• Your API key is stored only in your local browser storage (chrome.storage.local) and is never transmitted anywhere.
• Page content is sent only to the LLM endpoint you configured, only while you actively run a task.
• The extension does not collect, store, or share any personal data with us.
```

**分类 (Category)**
```
Productivity（生产力）
```

**语言 (Language)**
```
en（可再添加 zh-CN）
```

## 3. 截图（必须至少 1 张）

- 尺寸：**1280×800 或 640×400**（横屏）
- 已生成两张可直接上传（位于 `dist/screenshots/`）：
  1. `screenshot-settings.png` — 设置页（由桌面截图排版为浏览器窗口样式）
  2. `screenshot-chat.png` — 对话页（由桌面截图排版为浏览器窗口样式）
- 若想要第三张（Agent 正在执行任务的画面），可自行再截一张，同样排版成 1280×800 即可

## 4. 图标

- 商店需要独立的 **128×128** 图标，可直接用 `icons/icon128.png`（已生成）
- 另需为商店上传一张 **128×128 图标**（列表页），同样用该文件

## 5. 隐私政策（必填）

因为扩展会把**页面内容**发送到用户配置的 LLM 端点，商店会要求隐私政策。

- 若勾选 "本扩展传输数据"，需要填一个**隐私政策 URL**（随便一个网页，如 GitHub Pages 或你的博客）。
- 可用的隐私政策草稿（放到任意网页即可）：

```
Privacy Policy for MyPilot

MyPilot is a browser extension that automates web pages with an AI assistant.

DATA WE PROCESS
- Page content of the tab you are working on, sent to the LLM API endpoint you configure.
- Your API key is stored locally on your device (chrome.storage.local) and is never sent to us.
- Conversation history is stored locally on your device and never sent to us.

DATA TRANSMISSION
- When you run a task, the current page's visible text is sent to the LLM endpoint you configured (e.g. OpenAI, DeepSeek, or your own server). We do not receive, store, or have access to this data.

CONTACT
- For any privacy questions, contact the extension developer.
```

## 6. 权限 / 审查说明（手动审核会问）

商店对 `host_permissions: <all_urls>` 会触发额外人工审核，需要在提交时/审核说明里写清楚：

```
Why the extension needs host permissions:
MyPilot is a general-purpose browser automation agent. It must be able to inject scripts
(chrome.scripting) into ANY http/https page the user opens, because the user may ask it to
operate on any website. Access is only used at the user's explicit request (they type a task
in the side panel). The extension does not run in the background on other pages.
```

- 权限清单：`sidePanel`（侧边栏）、`scripting`（注入脚本操作页面）、`storage`（本地存设置/历史）。
- 无远程代码、无外部脚本，符合 MV3 安全要求。

## 7. 提交前检查清单

- [ ] `chrome://extensions` 重新加载后功能正常
- [ ] 图标已替换（不再使用 Google Gemini 图标）
- [ ] 至少 1 张截图就绪
- [ ] 隐私政策 URL 就绪（放一个网页）
- [ ] `dist/mypilot-extension.zip` 为最新（本目录内容 = zip 内容）
- [ ] 说明文字中不含 "Playwright" 等可能引起商标/混淆的词（本扩展不依赖 Playwright）

## 8. 审核预期

- 首审通常 3 天~2 周；若因权限问题被拒，按第 6 节的说明回复即可。
- 后续更新：改 `manifest.json` 的 `version`，重新打包 zip，在 Dashboard "Package" 处重新上传。
