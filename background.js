const SERVER_URL = 'ws://localhost:9223';

let ws = null;
let reconnectTimer = null;
let connected = false;

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

connect();

function connect() {
  clearTimeout(reconnectTimer);
  try {
    ws = new WebSocket(SERVER_URL);
  } catch (error) {
    console.error('WebSocket 创建失败:', error);
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    connected = true;
    broadcastStatus();
  });

  ws.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error('无法解析服务器消息:', error);
      return;
    }
    handleServerMessage(message);
  });

  ws.addEventListener('close', () => {
    connected = false;
    broadcastStatus();
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    connected = false;
    broadcastStatus();
    try {
      ws.close();
    } catch (error) {
      /* 忽略 */
    }
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 3000);
}

function broadcastStatus() {
  void chrome.runtime
    .sendMessage({ type: 'connection-status', connected })
    .catch(() => {});
}

function handleServerMessage(message) {
  switch (message.type) {
    case 'message':
      void chrome.runtime
        .sendMessage({ type: 'agent-message', role: message.role, text: message.text })
        .catch(() => {});
      break;
    case 'done':
      void chrome.runtime.sendMessage({ type: 'agent-done' }).catch(() => {});
      break;
    case 'error':
      void chrome.runtime
        .sendMessage({ type: 'agent-error', text: message.text })
        .catch(() => {});
      break;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'connection-status':
      sendResponse({ connected });
      return false;
    case 'agent-run':
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        sendResponse({ ok: false, error: 'Playwright server 未连接，请先启动 server' });
        return false;
      }
      ws.send(JSON.stringify({ action: 'run', text: message.text }));
      sendResponse({ ok: true });
      return false;
    case 'agent-stop':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'stop' }));
      }
      sendResponse({ ok: true });
      return false;
  }
});
