import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connectToWorkBuddy, isPortUp } from './cdp.js';
import { artifactLines, cleanSummary, taskDisplay } from './format.js';

const HELPERS = `
const __vis = (el) => {
  if (!el || !el.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
};
const __txt = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\\s+/g, ' ').trim();
const __rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
const __norm = (s) => (s || '').replace(/\\s+/g, ' ').replace(/[「」【】\\[\\]（）()]/g, '').trim().toLowerCase();
const __stripTime = (s) => (s || '')
  .replace(/\\s+/g, ' ')
  .replace(/\\s*\\d+\\s*(秒|分钟|小时|天|周|个月|年)前\\s*$/, '')
  .replace(/\\s*(刚刚|昨天|今天)\\s*$/, '')
  .trim();
const __clean = (s) => __norm(__stripTime(s));
const __click = (el) => {
  const t = el.closest('a,button,[role="listitem"],li,[role="button"]') || el;
  try { t.scrollIntoView({ block: 'center' }); } catch (e) {}
  for (const type of ['mousedown', 'mouseup', 'click']) {
    t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  return true;
};
`;

function buildExpr(fn, ...args) {
  const literal = args.map((a) => JSON.stringify(a === undefined ? null : a)).join(', ');
  return `(() => { ${HELPERS}; return (${fn.toString()})(${literal}); })()`;
}

function norm(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\d+\s*(秒|分钟|小时|天|周|个月|年)前\s*$/, '')
    .replace(/\s*(刚刚|昨天|今天)\s*$/, '')
    .replace(/[「」【】\[\]（）()]/g, '')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function truncate(s, max = 6000) {
  const text = String(s || '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export class WorkBuddyAdapter {
  constructor(cfg, store) {
    this.cfg = cfg;
    this.store = store;
    this.cdp = null;
    this.target = null;
  }

  async ensure() {
    if (this.cdp && !this.cdp.closed) return this;
    if (!(await isPortUp(this.cfg.port))) {
      throw new Error(
        `WorkBuddy 调试端口 ${this.cfg.port} 未开启。请先运行 node src/launcher.js（或带 --remote-debugging-port=${this.cfg.port} 重启 WorkBuddy）。`
      );
    }
    const { cdp, target } = await connectToWorkBuddy(this.cfg.port, this.cfg.timing.connectTimeoutMs);
    this.cdp = cdp;
    this.target = target;
    return this;
  }

  close() {
    this.cdp?.close();
    this.cdp = null;
    this.target = null;
  }

  async eval(fn, ...args) {
    await this.ensure();
    const expression = buildExpr(fn, ...args);
    try {
      return await this.cdp.evaluate(expression);
    } catch (err) {
      // 页面刷新/重载后执行上下文会失效，重连一次再试
      this.close();
      await this.ensure();
      return this.cdp.evaluate(expression);
    }
  }

  async expandThreads() {
    if (this.expanded) return;
    const clicked = await this.eval(
      (t) => {
        for (const el of document.querySelectorAll(t.selector)) {
          if (!__vis(el)) continue;
          if (/查看更多/.test(__txt(el))) {
            __click(el);
            return true;
          }
        }
        return false;
      },
      { selector: '.conversation-show-more-button' }
    );
    this.expanded = Boolean(clicked);
    if (clicked) await delay(600);
  }

  async listThreads() {
    await this.expandThreads();
    const selector = this.cfg.selectors.threadItem;
    const ignore = this.cfg.ignoreTitles || [];
    const result = await this.eval(
      (t) => {
        const items = [];
        const seen = new Set();
        const ignoreSet = new Set(t.ignore || []);
        const nodes = document.querySelectorAll(t.selector);
        for (const el of nodes) {
          if (!__vis(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.left > 460 || r.width > 420) continue;
          const text = __txt(el);
          const title = __stripTime(text);
          if (!title || title.length > 50) continue;
          if (ignoreSet.has(title)) continue;
          const key = __norm(title) + ':' + Math.round(r.top / 4);
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({
            title,
            top: Math.round(r.top),
            active:
              el.getAttribute('aria-current') === 'page' ||
              /active|selected|current/i.test(String(el.className || ''))
          });
        }
        items.sort((a, b) => a.top - b.top);
        return { ok: true, items: items.slice(0, 100), url: location.href, docTitle: document.title };
      },
      { selector, ignore }
    );
    this.docTitle = result?.docTitle || '';
    return result || { ok: false, items: [] };
  }

  async headerTitle() {
    return (
      (await this.eval(
        (t) => {
          const parts = t.selectors.split(',').map((s) => s.trim()).filter(Boolean);
          for (const sel of parts) {
            const nodes = [...document.querySelectorAll(sel)].filter(__vis);
            if (nodes.length) return __txt(nodes[nodes.length - 1]);
          }
          return document.title || '';
        },
        { selectors: this.cfg.selectors.title }
      )) || ''
    );
  }

  async composerInfo() {
    return this.eval(
      (t) => {
        const nodes = [...document.querySelectorAll(t.selector)].filter(__vis);
        if (!nodes.length) return null;
        nodes.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        });
        const el = nodes[0];
        el.focus();
        if (el.tagName === 'TEXTAREA' && 'value' in el) {
          el.setSelectionRange(el.value.length, el.value.length);
        }
        return { tag: el.tagName, rect: __rect(el), editable: el.getAttribute('contenteditable') };
      },
      { selector: this.cfg.selectors.composer }
    );
  }

  async composerText() {
    return (
      (await this.eval(
        (t) => {
          const nodes = [...document.querySelectorAll(t.selector)].filter(__vis);
          if (!nodes.length) return '';
          const el = nodes.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return rb.width * rb.height - ra.width * ra.height;
          })[0];
          return 'value' in el && el.tagName === 'TEXTAREA' ? el.value : __txt(el);
        },
        { selector: this.cfg.selectors.composer }
      )) || ''
    );
  }

  resolveTitle(name) {
    const alias = this.store.getAlias(name);
    return alias || name;
  }

  async findTitle(name) {
    const want = this.resolveTitle(name);
    const { items } = await this.listThreads();
    const exact = items.find((it) => norm(it.title) === norm(want));
    if (exact) return exact.title;
    const prefix = items.filter((it) => norm(it.title).startsWith(norm(want)));
    if (prefix.length === 1) return prefix[0].title;
    const truncated = items.filter((it) => {
      const a = norm(it.title);
      const b = norm(want);
      return a.length >= 4 && b.startsWith(a);
    });
    if (truncated.length === 1) return truncated[0].title;
    const candidates = items.slice(0, 12).map((it) => it.title).join(' | ') || '(空)';
    throw new Error(`未找到对话「${want}」。当前侧栏：${candidates}`);
  }

  async openThread(name) {
    const title = await this.findTitle(name);
    const clicked = await this.eval(
      (t) => {
        const target = __clean(t.title);
        let best = null;
        for (const el of document.querySelectorAll(t.selector)) {
          if (!__vis(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.left > 460 || r.width > 420) continue;
          const text = __txt(el);
          const clean = __clean(text);
          if (!clean) continue;
          if (clean !== target && !clean.startsWith(target) && !(clean.length >= 4 && target.startsWith(clean))) continue;
          const area = r.width * r.height;
          if (!best || area < best.area) best = { el, area };
        }
        if (!best) return { ok: false, reason: 'not_found' };
        __click(best.el);
        return { ok: true, clicked: __txt(best.el) };
      },
      { title, selector: this.cfg.selectors.threadItem }
    );
    if (!clicked || !clicked.ok) throw new Error(`点击对话失败：${title}`);
    await delay(700);
    const header = await this.headerTitle();
    const generic = !header || norm(header) === norm(this.docTitle || '');
    if (!generic && !norm(header).includes(norm(title))) {
      throw new Error(`打开后标题不匹配：期望「${title}」，实际「${header}」`);
    }
    if (norm(name) !== norm(title)) this.store.setAlias(name, title);
    return { thread: title, header, generic_header: generic };
  }

  async newThread(title = '') {
    const clicked = await this.eval(
      (t) => {
        const wants = ['新建任务', '新建对话', '新建', 'New task', 'New chat'];
        for (const el of document.querySelectorAll(t.selector)) {
          if (!__vis(el)) continue;
          const text = __txt(el);
          if (!text) continue;
          if (wants.some((w) => text === w || text.startsWith(w))) {
            __click(el);
            return { ok: true, clicked: text };
          }
        }
        return { ok: false, reason: 'new_button_not_found' };
      },
      { selector: this.cfg.selectors.button }
    );
    if (!clicked || !clicked.ok) throw new Error('找不到「新建任务」按钮');
    await delay(900);
    if (title) {
      const info = await this.composerInfo();
      if (!info) throw new Error('新建后找不到输入框');
      await this.cdp.insertText(title);
      await delay(150);
      return { thread: title, drafted: true, header: await this.headerTitle() };
    }
    return { thread: '', drafted: false, header: await this.headerTitle() };
  }

  async activeThreadTitle() {
    const { items } = await this.listThreads();
    const active = items.find((it) => it.active);
    if (active) return active.title;
    return this.headerTitle();
  }

  async commitDraft({ taskId = '' } = {}) {
    const text = (await this.composerText()).trim();
    if (!text) throw new Error('输入框是空的，没有可发送的草案');
    const baseline = await this.lastAssistant();
    const beforeTitles = (await this.listThreads()).items.map((it) => it.title);
    await this.cdp.pressEnter();
    await delay(1200);
    const current = await this.waitForActiveTitle('', 5000);
    const task = this.store.createTask({
      id: taskId || undefined,
      thread: current || '',
      text,
      baselineText: truncate(baseline),
      beforeTitles
    });
    try {
      fs.mkdirSync(path.join(this.cfg.artifactsDir, task.id), { recursive: true });
    } catch {
      /* ignore */
    }
    return { task_id: task.id, thread: task.thread, mode: 'commit' };
  }

  async clearDraft() {
    const ok = await this.eval(
      (t) => {
        const nodes = [...document.querySelectorAll(t.selector)].filter(__vis);
        if (!nodes.length) return false;
        nodes.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        });
        const el = nodes[0];
        el.focus();
        if (el.tagName === 'TEXTAREA') {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          el.textContent = '';
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        }
        return true;
      },
      { selector: this.cfg.selectors.composer }
    );
    return { ok: Boolean(ok) };
  }

  async send({ thread = '', text = '', mode = 'send', taskId = '' } = {}) {
    if (!text) throw new Error('text 不能为空');
    if (thread) await this.openThread(thread);
    if (mode === 'draft' && !thread) {
      const head = await this.headerTitle();
      if (!head || head === 'WorkBuddy') {
        throw new Error('新任务页不支持草案：请先打开一个已有对话，或直接用 mode=send');
      }
    }
    const info = await this.composerInfo();
    if (!info) throw new Error('找不到输入框（composer）');
    const baseline = await this.lastAssistant();
    const beforeTitles = (await this.listThreads()).items.map((it) => it.title);
    await this.cdp.insertText(text);
    await delay(200);

    if (mode === 'draft') {
      const current = await this.headerTitle();
      return { mode: 'draft', thread: current, chars: text.length };
    }

    await this.cdp.pressEnter();
    await delay(1200);

    const remaining = await this.composerText();
    const stillThere = remaining && text.length >= 10 && remaining.includes(text.slice(0, 10));
    if (stillThere) {
      await this.clickSend();
      await delay(300);
    }

    const current = thread ? await this.findTitle(thread) : '';
    const task = this.store.createTask({
      id: taskId || undefined,
      thread: current,
      text,
      baselineText: truncate(baseline),
      beforeTitles
    });
    try {
      fs.mkdirSync(path.join(this.cfg.artifactsDir, task.id), { recursive: true });
    } catch {
      /* 目录失败不影响发送 */
    }
    return {
      task_id: task.id,
      thread: current,
      mode: 'send',
      display: taskDisplay({
        thread: current || '新对话',
        status: 'running',
        elapsedSeconds: 0,
        summary: `已发送 ${task.id}，任务进入队列。`
      })
    };
  }

  async clickSend() {
    return this.eval(
      (t) => {
        for (const el of document.querySelectorAll(t.selector)) {
          if (!__vis(el)) continue;
          const text = __txt(el);
          const aria = el.getAttribute('aria-label') || '';
          if (/发送|send/i.test(text) || /发送|send/i.test(aria)) {
            __click(el);
            return { ok: true, clicked: text || aria };
          }
        }
        return { ok: false };
      },
      { selector: this.cfg.selectors.button }
    );
  }

  async isStreaming() {
    return Boolean(
      await this.eval(
        (t) => {
          const stop = [...document.querySelectorAll('[aria-label="停止"], [aria-label*="停止生成"]')].filter(__vis);
          if (stop.length) return true;
          for (const el of document.querySelectorAll(t.selector)) {
            if (!__vis(el)) continue;
            const text = __txt(el);
            const aria = el.getAttribute('aria-label') || '';
            if (/^停止(生成)?$/.test(text) || /停止生成|stop generating/i.test(text) || /^停止|停止生成/.test(aria) || /stop/i.test(aria)) return true;
          }
          return false;
        },
        { selector: this.cfg.selectors.button }
      )
    );
  }

  async scrollToBottom() {
    const ok = await this.eval(() => {
      const el = document.querySelector('.cr-message-list-viewport');
      if (!el) return false;
      el.scrollTop = el.scrollHeight;
      return true;
    });
    if (ok) await delay(400);
    return ok;
  }

  async waitForAssistant(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const count = await this.eval(() => {
        const els = [...document.querySelectorAll('.cr-markdown')];
        return els.filter((el) => ((el.innerText || '').trim().length > 0)).length;
      });
      if (count > 0) return count;
      await delay(400);
    }
    return 0;
  }

  async lastAssistant() {
    return (
      (await this.eval(
        (t) => {
          const nodes = [...document.querySelectorAll(t.selector)].filter(__vis);
          for (let i = nodes.length - 1; i >= 0; i -= 1) {
            const text = __txt(nodes[i]);
            if (text) return text;
          }
          return '';
        },
        { selector: this.cfg.selectors.assistant }
      )) || ''
    );
  }

  async readLast(thread = '') {
    if (thread) await this.openThread(thread);
    await delay(2000);
    await this.waitForAssistant();
    const header = await this.headerTitle();
    const text = await this.lastAssistant();
    const streaming = await this.isStreaming();
    const shown =
      cleanSummary(text, 320) ||
      ((/DONE\|/.test(text) || /完成\|/.test(text)) ? '任务完成。' : '（暂无回复）');
    return {
      thread: header,
      last_text: truncate(text),
      streaming,
      display: `**WorkBuddy${header ? ` · ${header}` : ''}** \`${streaming ? '运行中' : '最后一条'}\`\n${shown}`
    };
  }

  async waitForActiveTitle(previous, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    let lastTitle = previous;
    while (Date.now() < deadline) {
      const { items } = await this.listThreads();
      const active = items.find((it) => it.active);
      if (active && active.title) {
        lastTitle = active.title;
        if (active.title !== previous && !previous.startsWith(active.title) && active.title.length <= 60) {
          return active.title;
        }
      }
      await delay(500);
    }
    return lastTitle;
  }

  saveCheckpoint(taskId, text) {
    try {
      const dir = path.join(this.cfg.home, 'checkpoints');
      fs.mkdirSync(dir, { recursive: true });
      const safe = String(taskId).replace(/[^A-Za-z0-9._-]/g, '');
      fs.writeFileSync(
        path.join(dir, `${safe}.md`),
        `# ${taskId}\n\nupdated: ${new Date().toISOString()}\n\n${truncate(text, 20000)}\n`,
        'utf8'
      );
    } catch {
      /* 检查点失败不阻塞任务 */
    }
  }

  async settleText(timeoutMs = 15000) {
    let prev = '';
    const rounds = Math.ceil(timeoutMs / 400);
    for (let i = 0; i < rounds; i += 1) {
      const text = await this.lastAssistant();
      const streaming = await this.isStreaming();
      if (!streaming && text && text === prev) return text;
      prev = text;
      await delay(400);
    }
    return prev;
  }

  async finishTask(taskId, status, text) {
    const task = this.store.getTask(taskId);
    let title = task?.thread || '';

    if (!title) {
      try {
        const { items } = await this.listThreads();
        const before = new Set(task?.beforeTitles || []);
        const fresh = items.filter((it) => !before.has(it.title));
        if (fresh.length > 0) {
          const active = fresh.find((it) => it.active);
          title = (active || fresh[0]).title;
        }
      } catch {
        /* 继续用 header 兜底 */
      }
    }

    if (!title) {
      try {
        for (let i = 0; i < 8; i += 1) {
          const h = await this.headerTitle();
          if (h && h !== 'WorkBuddy' && h.length <= 60 && !text.startsWith(h)) {
            title = h;
            break;
          }
          await delay(500);
        }
      } catch {
        /* 保持原值 */
      }
    }

    return this.store.updateTask(taskId, { status, lastText: truncate(text), thread: title });
  }

  async wait(taskId, timeoutSec = 120) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`未知任务：${taskId}`);
    if (task.status === 'stopped') {
      return {
        task_id: taskId,
        status: 'stopped',
        thread: task.thread,
        elapsed_s: this.taskElapsed(task),
        last_text: truncate(task.lastText || ''),
        display: taskDisplay({
          thread: task.thread,
          status: 'stopped',
          elapsedSeconds: this.taskElapsed(task),
          summary: task.lastText || '任务已停止。'
        })
      };
    }
    const pollMs = Math.max(500, Number(this.cfg.timing.pollMs) || 2000);
    const deadline = Date.now() + Math.max(1, timeoutSec) * 1000;
    const baseline = task.baselineText || '';
    let last = task.lastText || baseline;
    let stable = 0;
    let streaming = false;

    while (Date.now() < deadline) {
      if (!last) await this.waitForAssistant(3000);
      const text = await this.lastAssistant();
      streaming = await this.isStreaming();
      if (text && text !== last) this.saveCheckpoint(taskId, text);
      if (text && text !== baseline && (/DONE\|/.test(text) || /完成\|/.test(text))) {
        const finalText = (await this.settleText()) || text;
        const updated = await this.finishTask(taskId, 'done', finalText);
        const files = this.listArtifacts(taskId);
        const elapsed = this.taskElapsed(task);
        return {
          task_id: taskId,
          status: 'done',
          thread: updated.thread,
          elapsed_s: elapsed,
          artifacts: files,
          last_text: truncate(finalText),
          display: taskDisplay({ thread: updated.thread, status: 'done', elapsedSeconds: elapsed, summary: finalText, files })
        };
      }
      if (text && text !== baseline && (/FAIL\|/.test(text) || /失败\|/.test(text))) {
        const finalText = (await this.settleText(5000)) || text;
        const updated = await this.finishTask(taskId, 'failed', finalText);
        const files = this.listArtifacts(taskId);
        const elapsed = this.taskElapsed(task);
        return {
          task_id: taskId,
          status: 'failed',
          thread: updated.thread,
          elapsed_s: elapsed,
          artifacts: files,
          last_text: truncate(finalText),
          display: taskDisplay({ thread: updated.thread, status: 'failed', elapsedSeconds: elapsed, summary: finalText, files })
        };
      }
      if (text === last) stable += 1;
      else {
        stable = 0;
        last = text;
        if (text) this.saveCheckpoint(taskId, text);
      }
      if (!streaming && text && text !== baseline && stable >= 4) {
        const updated = await this.finishTask(taskId, 'done', text);
        const files = this.listArtifacts(taskId);
        const elapsed = this.taskElapsed(task);
        return {
          task_id: taskId,
          status: 'done',
          thread: updated.thread,
          elapsed_s: elapsed,
          artifacts: files,
          last_text: truncate(text),
          display: taskDisplay({ thread: updated.thread, status: 'done', elapsedSeconds: elapsed, summary: text, files })
        };
      }
      await delay(pollMs);
    }

    this.store.updateTask(taskId, { lastText: truncate(last) });
    const elapsed = this.taskElapsed(task);
    return {
      task_id: taskId,
      status: 'running',
      streaming,
      thread: task.thread,
      elapsed_s: elapsed,
      last_text: truncate(last),
      hint: '仍在生成，可再次调用 office_wait 继续等待。',
      display: taskDisplay({
        thread: task.thread,
        status: 'running',
        elapsedSeconds: elapsed,
        summary: last,
        files: this.listArtifacts(taskId),
        note: '仍在生成，可再次调用 office_wait 继续等待。'
      })
    };
  }

  async stop() {
    const clicked = await this.eval(
      (t) => {
        const stop = [...document.querySelectorAll('[aria-label="停止"], [aria-label*="停止生成"]')].filter(__vis);
        if (stop.length) {
          __click(stop[0]);
          return { ok: true, clicked: stop[0].getAttribute('aria-label') || 'stop' };
        }
        for (const el of document.querySelectorAll(t.selector)) {
          if (!__vis(el)) continue;
          const text = __txt(el);
          const aria = el.getAttribute('aria-label') || '';
          if (/^停止(生成)?$/.test(text) || /停止生成|stop generating/i.test(text) || /^停止|停止生成/.test(aria) || /stop/i.test(aria)) {
            __click(el);
            return { ok: true, clicked: text || aria };
          }
        }
        return { ok: false, reason: 'stop_button_not_found' };
      },
      { selector: this.cfg.selectors.button }
    );
    return clicked || { ok: false };
  }

  taskElapsed(task) {
    if (!task || !task.createdAt) return 0;
    const started = Date.parse(task.createdAt);
    if (!Number.isFinite(started)) return 0;
    return Math.max(0, Math.round((Date.now() - started) / 1000));
  }

  listArtifacts(taskId) {
    const safeId = String(taskId || '').replace(/[^A-Za-z0-9._-]/g, '');
    const root = path.join(this.cfg.artifactsDir, safeId);
    if (!safeId || !fs.existsSync(root)) return [];
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          const stat = fs.statSync(full);
          files.push({ path: full, size: stat.size, mtime: stat.mtime.toISOString() });
        }
      }
    };
    walk(root);
    files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    return files.slice(0, 200);
  }

  async artifacts(taskId) {
    const files = this.listArtifacts(taskId);
    return {
      task_id: taskId,
      files,
      display: artifactLines(files) || '（暂无产物；确认任务已把文件写入 artifacts 目录）'
    };
  }

  async deleteThread(name, { confirm = false } = {}) {
    if (!confirm) throw new Error('删除对话需要显式 confirm=true');
    const title = await this.findTitle(name);
    const opened = await this.eval(
      (t) => {
        const cards = [...document.querySelectorAll('.conversation-agent-card')];
        const card = cards.find((el) => __clean(el.innerText || '') === __clean(t.title));
        if (!card) return { ok: false, reason: 'card_not_found' };
        const btn = card.querySelector('.agent-card-more-button');
        if (!btn) return { ok: false, reason: 'more_not_found' };
        btn.click();
        return { ok: true };
      },
      { title }
    );
    if (!opened.ok) throw new Error(`找不到任务卡片：${title}`);
    await delay(500);

    const menu = await this.eval(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
      const items = [...document.querySelectorAll('[role="menuitem"]')].filter(vis);
      const item = items.find((el) => /删除任务|删除/.test((el.innerText || '').trim()));
      if (!item) return { ok: false, reason: 'menu_item_not_found' };
      item.click();
      return { ok: true };
    });
    if (!menu.ok) throw new Error('菜单里找不到“删除任务”');
    await delay(700);

    const confirmed = await this.eval(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
      const btns = [...document.querySelectorAll('button, [role="button"]')].filter(vis);
      const btn = btns.find((el) => /^(删除|确定|确认)/.test((el.innerText || '').trim()));
      if (!btn) return { ok: false, reason: 'confirm_not_found' };
      btn.click();
      return { ok: true, label: (btn.innerText || '').trim() };
    });
    if (!confirmed.ok) throw new Error('确认删除的按钮没找到');

    this.store.removeAliasByTitle(title);
    await delay(800);
    return { deleted: true, thread: title };
  }

  async screenshot() {
    await this.ensure();
    const shot = await this.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    return Buffer.from(shot.data, 'base64');
  }

  async status() {
    const up = await isPortUp(this.cfg.port);
    if (!up) return { port: this.cfg.port, connected: false, hint: '调试端口未开启' };
    const threads = await this.listThreads();
    return {
      port: this.cfg.port,
      connected: true,
      url: threads.url,
      doc_title: threads.docTitle,
      header: await this.headerTitle(),
      thread_count: threads.items.length,
      tasks: this.store.listTasks(5)
    };
  }

  async probe() {
    const result = await this.eval(
      (t) => {
        const uniq = (arr) => {
          const seen = new Set();
          return arr.filter((x) => {
            const k = `${x.text}|${x.rect.x}|${x.rect.y}|${x.rect.w}|${x.rect.h}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        };
        const collect = (selector) =>
          [...document.querySelectorAll(selector)]
            .filter(__vis)
            .slice(0, 300)
            .map((el) => ({
              text: __txt(el).slice(0, 80),
              aria: el.getAttribute('aria-label') || '',
              cls: String(el.className || '').slice(0, 120),
              tag: el.tagName,
              rect: __rect(el)
            }));

        return {
          url: location.href,
          docTitle: document.title,
          buttons: uniq(collect(t.buttons)),
          editables: uniq(collect(t.editables)),
          headings: uniq(collect('h1,h2,h3,[role="heading"]')),
          listItems: uniq(collect('[role="listitem"],nav li,aside li'))
        };
      },
      { buttons: this.cfg.selectors.button, editables: this.cfg.selectors.composer }
    );
    const out = path.join(this.cfg.home, 'probe.json');
    fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
    return { ok: true, file: out, summary: { buttons: result.buttons.length, editables: result.editables.length, headings: result.headings.length, listItems: result.listItems.length } };
  }
}
