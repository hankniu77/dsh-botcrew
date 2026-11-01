import { setTimeout as delay } from 'node:timers/promises';

const CDP_TIMEOUT_MS = 30000;

export class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
  }

  async connect(timeoutMs = 10000, { runtime = true, page = true } = {}) {
    if (typeof WebSocket === 'undefined') {
      throw new Error('需要 Node.js 22+（内置 WebSocket）。当前 Node 不支持。');
    }
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP 连接超时')), timeoutMs);
      const onOpen = () => {
        clearTimeout(timer);
        ws.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        clearTimeout(timer);
        ws.removeEventListener('open', onOpen);
        reject(new Error('CDP WebSocket 连接失败'));
      };
      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('error', onError, { once: true });
    });

    ws.addEventListener('message', (ev) => this._onMessage(ev.data));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error('CDP 连接已关闭'));
      this.pending.clear();
    });

    if (runtime) await this.send('Runtime.enable');
    if (page) await this.send('Page.enable');
    return this;
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg.id !== 'number') return;
    const waiter = this.pending.get(msg.id);
    if (!waiter) return;
    this.pending.delete(msg.id);
    clearTimeout(waiter.timer);
    if (msg.error) waiter.reject(new Error(msg.error.message || 'CDP error'));
    else waiter.resolve(msg.result);
  }

  send(method, params = {}) {
    if (!this.ws || this.closed) return Promise.reject(new Error('CDP 未连接'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, CDP_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async evaluate(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text || '页面脚本异常';
      throw new Error(desc);
    }
    return result.result ? result.result.value : undefined;
  }

  async insertText(text) {
    await this.send('Input.insertText', { text });
  }

  async pressEnter() {
    const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await delay(30);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  close() {
    try {
      this.closed = true;
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list HTTP ${res.status}`);
  return res.json();
}

export async function isPortUp(port, timeoutMs = 1500) {
  try {
    const ctrl = AbortSignal.timeout(timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctrl });
    return res.ok;
  } catch {
    return false;
  }
}

export async function connectToWorkBuddy(port, timeoutMs = 10000) {
  const targets = await listTargets(port);
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (pages.length === 0) throw new Error('没有可用的 page target（客户端可能还没打开窗口）');

  const scored = pages
    .map((t) => {
      const hay = `${t.title || ''} ${t.url || ''}`.toLowerCase();
      let score = 0;
      if (hay.includes('workbuddy')) score += 10;
      if (hay.includes('codebuddy')) score += 5;
      if (hay.includes('devtools')) score -= 100;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score);

  const target = scored[0].t;
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect(timeoutMs);
  return { cdp, target };
}
