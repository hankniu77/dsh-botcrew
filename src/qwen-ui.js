import { CDP, listTargets } from './cdp.js';
import { setTimeout as delay } from 'node:timers/promises';

const HELPERS = `
const __vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden'; };
const __txt = (el) => ((el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim();
const __rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
const __click = (el) => { el.scrollIntoView({ block: 'center' }); ['mousedown','mouseup','click'].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); return true; };
`;

function buildExpr(fn, ...args) {
  const literal = args.map((a) => JSON.stringify(a === undefined ? null : a)).join(', ');
  return `(() => { ${HELPERS}; return (${fn.toString()})(${literal}); })()`;
}

export class QwenUI {
  constructor(cfg) {
    this.cfg = cfg;
    this.port = (cfg.qwen && cfg.qwen.uiPort) || 9444;
    this.cdp = null;
  }

  async ensure() {
    if (this.cdp && !this.cdp.closed) return this;
    const targets = await listTargets(this.port).catch(() => {
      throw new Error(`千问办公调试端口 ${this.port} 未开启；用 --remote-debugging-port=${this.port} 启动一次`);
    });
    const page = targets.find((t) => t.type === 'page' && String(t.url).includes('/renderer/index.html'));
    if (!page) throw new Error('找不到千问办公主页面 target');
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.connect();
    this.cdp = cdp;
    return this;
  }

  async eval(fn, ...args) {
    await this.ensure();
    return this.cdp.evaluate(buildExpr(fn, ...args));
  }

  async clickAria(aria) {
    return this.eval((label) => {
      const el = document.querySelector(`[aria-label="${label}"]`);
      if (!el) return false;
      __click(el);
      return true;
    }, aria);
  }

  async listTasks() {
    return this.eval(() => {
      const items = [];
      const seen = new Set();
      for (const el of document.querySelectorAll('button')) {
        if (!__vis(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.x > 240 || r.y < 600 || r.y > 900 || r.width < 60 || r.height > 40) continue;
        const text = __txt(el);
        if (!text || text.length > 60) continue;
        if (/新建|置顶|项目|最近|设置|任务|频道|个人版|hankniu|账号/.test(text)) continue;
        if (seen.has(text)) continue;
        seen.add(text);
        items.push({ title: text, rect: __rect(el) });
      }
      return items;
    });
  }

  async newTask() {
    const ok = await this.clickAria('新任务');
    if (!ok) throw new Error('找不到“新任务”按钮');
    await delay(1200);
    return { ok: true };
  }

  async send(prompt) {
    if (!prompt || !prompt.trim()) throw new Error('prompt 为空');
    const focused = await this.eval(() => {
      const el = document.querySelector('[contenteditable="true"]');
      if (!el) return null;
      el.focus();
      return true;
    });
    if (!focused) throw new Error('找不到千问办公输入框');
    await this.cdp.insertText(prompt);
    await delay(400);
    const sent = await this.clickAria('发送消息');
    if (!sent) throw new Error('找不到“发送消息”按钮');
    return { sent: true };
  }

  async readLast() {
    return this.eval(() => {
      const nodes = [...document.querySelectorAll('.markdown-body, .qd-markdown-content')].filter(__vis);
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const text = __txt(nodes[i]);
        if (text) return text;
      }
      return '';
    });
  }

  async wait({ timeoutMs = 180000, pollMs = 1500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    let stable = 0;
    while (Date.now() < deadline) {
      await delay(pollMs);
      const state = await this.eval(() => {
        const txt = (el) => ((el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim();
        const body = document.body.innerText;
        const nodes = [...document.querySelectorAll('.markdown-body, .qd-markdown-content')];
        const lastText = nodes.length ? txt(nodes[nodes.length - 1]) : '';
        const done = /处理已结束|已完成/.test(body);
        const busy = /思考中|规划中|执行中|生成中|停止生成/.test(body) && !done;
        return { done, busy, lastText };
      });
      if (state.lastText === last) stable += 1;
      else {
        stable = 0;
        last = state.lastText;
      }
      if (state.done || (!state.busy && last && stable >= 2)) {
        return { text: last, done: Boolean(state.done) };
      }
    }
    return { text: last, done: false, timed_out: true };
  }

  async stop() {
    await this.ensure();
    return this.eval(() => {
      const nodes = [...document.querySelectorAll('[aria-label="停止"], [aria-label*="停止生成"]')].filter(__vis);
      if (!nodes.length) return { ok: false, reason: 'stop_not_found' };
      __click(nodes[0]);
      return { ok: true, clicked: nodes[0].getAttribute('aria-label') || 'stop' };
    });
  }

  async screenshot() {
    await this.ensure();
    const shot = await this.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    return Buffer.from(shot.data, 'base64');
  }

  async status() {
    const tasks = await this.listTasks();
    const text = await this.eval(() => {
      const el = document.querySelector('[class*="chat-title"], [class*="task-title"], header h1, h1');
      return el ? (el.innerText || '').trim() : '';
    });
    return { port: this.port, tasks: tasks.length, title: text };
  }
}
