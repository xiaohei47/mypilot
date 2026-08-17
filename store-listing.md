# Chrome Web Store 上架材料（MyPilot）

> 已注册开发者账号，以下为提交时需要填写的资料与注意事项。

## 0. 命名说明

- 扩展已更名为 **MyPilot**（避开 Google "Play Agent" 商标冲突）。

## 1. 提交文件

- 使用 `dist/mypilot-extension.zip`(版本 0.9，已修复 8/11 被拒问题)
- 上传到 Chrome Web Store Developer Dashboard → "New Item" → 上传 zip
- 注意：上传 zip 前，先在本地 `chrome://extensions` 验证功能正常

> 2026-08-11 拒绝原因及修复：
> 1. **Red Potassium（内容政策）**：`new URL(tab.url)` 在 `chrome://` 等无 `tab.url` 的页面上抛 "Failed to construct URL : Invalid URL"。
>    已修复：`background.js` 中对 `tab.url` 做防御性解析，并对 `goto` 的 URL 做规范化/校验（补全 https:// 前缀、无效地址返回明确错误）。
> 2. **Purple Nickel（用户数据隐私）**：隐私政策链接必须填在 **Dashboard → 该产品 → 修改 → 「隐私权」标签页** 的隐私政策链接字段，**不要写进产品说明**。把 5 节的隐私政策草稿放到一个公开网页（GitHub Pages 等），再把链接填到该字段并保存。

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

- **必须**把隐私政策链接填在 **Dashboard → 该产品 → 「修改」 → 「隐私权」标签页** 的"隐私权政策链接"字段里，**不要**加在产品说明中（被拒项 Purple Nickel）。
- 把下面的隐私政策草稿发布到任意公开网页（GitHub Pages、博客等），确保链接可公开访问、不返回 404。
- 若勾选 "本扩展传输数据"，需要填一个**隐私政策 URL**（随便一个网页，如 GitHub Pages 或你的博客）。
- **2026-08-13 版本 0.9 再次被拒（Purple Nickel）：完全没提供隐私政策。** 现成的完整草稿在仓库 `privacy-policy.md`，直接把它贴到你博客/任意公开网页上，得到公开 URL 后填进上面的字段。
- 把下面的简版草稿放到任意网页即可（完整版用 `privacy-policy.md`）：

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

## 6.5 隐私权规范标签页（发布拦截项，直接粘贴）

发布时提示的每一项，都在 Dashboard → 该产品的「修改」→「隐私权规范」标签页里填写。以下文案可直接粘贴：

**① 单一用途说明 (Single purpose)**
```
MyPilot is a single-purpose AI browser automation assistant. Users describe a web task in plain language, and the agent operates the current tab on their behalf: navigate, click, type, fill forms, select options, check boxes, extract content, and save tables as CSV files. Automation runs only while the user has an active task in the extension's side panel.
```

**② 远程代码理由 (Remote code)**
```
The extension never loads or executes remote code. All JavaScript is bundled in the extension package (service worker, side panel, and the in-page scripts it injects). The only remote requests are (1) the OpenAI-compatible LLM endpoint configured by the user, which is used to generate agent decisions, and (2) navigation to web pages the user asks the agent to visit. No executable code is fetched or run from remote hosts.
```

**③ 主机权限理由 (Host permissions)**
```
MyPilot is a general-purpose web automation agent, so it must be able to operate on any http/https page the user opens. Host permission is required to inject automation scripts into every possible target site. Scripts are injected only when the user explicitly sends a task; the extension does not run automatically in the background on other pages.
```

**④ scripting 权限理由**
```
The scripting permission is used to run automation scripts in the user's current tab via chrome.scripting.executeScript. These scripts perform the requested actions (click, type, fill forms, read page text, extract tables) and return results to the agent. Injection happens only during an active user task.
```

**⑤ sidePanel 权限理由**
```
The sidePanel permission is used to display the extension's chat interface in Chrome's side panel, where the user types their task and reads the agent's actions and responses. The panel opens only when the user clicks the extension icon.
```

**⑥ storage 权限理由**
```
The storage permission saves the user's settings (LLM endpoint and model) and conversation history locally via chrome.storage.local. All data stays on the user's device; nothing is uploaded to us.
```

**⑦ 联系邮箱验证**
```
在 Dashboard → 左侧「设置 Settings」页，点击 "Verify" 验证发布方联系邮箱（Google 会发验证邮件）。验证通过后才能发布。
```

**⑧ 数据使用确认（隐私问题勾选）**
与上面文案保持一致地勾选/填写：

| 问题 | 答案 |
|------|------|
| 是否收集/传输个人数据 | 是（仅在用户主动运行时，把当前页面文本发给用户自己配置的 LLM 端点） |
| 收集的数据类型 | 勾选 **Web history** 或 **User activity / Website content**（页面内容），并注明"仅发送给用户自选的 LLM 端点，用于完成自动化任务" |
| API Key 认证信息 | 不收集到我们这里；仅保存在用户本地（chrome.storage.local），仅发送给用户配置的端点 |
| 是否加密传输 | 勾选"是"（端点通常为 HTTPS；你可在隐私政策中说明） |
| 是否由第三方处理 | 勾选"是"，并注明"数据发送至用户配置的第三方 LLM API 提供商" |
| 远程代码 | 否 |

- 最后在「隐私权规范」页面底部勾选确认 **"MyPilot 的数据使用情况符合开发者计划政策"**，保存草稿。

## 7. 提交前检查清单

- [ ] `chrome://extensions` 重新加载后功能正常
- [ ] 图标已替换（不再使用 Google Gemini 图标）
- [ ] 至少 1 张截图就绪
- [ ] 隐私政策 URL 就绪（用 `privacy-policy.md` 发布到公开网页）
- [ ] **Dashboard → 该产品 → 「修改」 → 「隐私权」标签页 → 在"隐私权政策链接"字段填入该 URL 并保存**（不是产品说明里）
- [ ] `dist/mypilot-extension.zip` 为最新（本目录内容 = zip 内容）
- [ ] 说明文字中不含 "Playwright" 等可能引起商标/混淆的词（本扩展不依赖 Playwright）

## 8. 审核预期

- 首审通常 3 天~2 周；若因权限问题被拒，按第 6 节的说明回复即可。
- 后续更新：改 `manifest.json` 的 `version`，重新打包 zip，在 Dashboard "Package" 处重新上传。
- **"发布将被推迟 / 可能必须接受深入审核"的警告是自动提示，不是拒绝。** 原因就是我们保留了 `<all_urls>`（为了跨站自动化能力）。处理方式：
  1. 这是预期内的，提交前把「隐私权规范」标签页的 **③ 主机权限理由** 填好（6.5 节），审核员会看到。
  2. 若审核员在消息里追问，直接把 6.5 节 ③ 的英文文案回复过去即可。
  3. 不要改成 `activeTab`——那会失去跨网站继续操作的能力（`goto` 跳转其他域名后权限失效）。
