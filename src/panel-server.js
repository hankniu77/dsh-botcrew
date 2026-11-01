import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { WorkBuddyAdapter } from './adapter.js';
import { QwenUI } from './qwen-ui.js';
import { qwenRun, qwenWorkDir, qwenStatus } from './qwen-worker.js';
import { ensureQwenWork, ensureWorkBuddy, isProcessRunning } from './launcher.js';
import { qwenLoginState, startQwenLogin } from './qwen-login.js';
import { isPortUp } from './cdp.js';

const cfg = loadConfig();
const store = new Store(cfg.home);
const wb = new WorkBuddyAdapter(cfg, store);
const qw = new QwenUI(cfg);
const qwenTasks = new Map();
const customTasks = new Map();
const port = Number(cfg.panelPort) || 8765;
const GROUP_CHAT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'group-chat.html');

const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>工位面板 · botcrew</title>
<style>
  :root{--bg:#f3f0ea;--card:#fff;--line:#e7e1d6;--muted:#8d867a;--text:#24211d;--blue:#2f7cf6;--orange:#ef7a2e;--green:#2f9e6f;--amber:#b7791f}
  *{box-sizing:border-box}body{margin:0;background:radial-gradient(900px 500px at 10% 0%,#e8e2f6,#f3f0ea 60%);font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--text)}
  .wrap{max-width:980px;margin:22px auto;padding:0 18px}
  .head{display:flex;align-items:baseline;gap:10px;margin:0 4px 14px}
  .head h1{font-size:17px;margin:0}.head .sub{font-size:11px;color:var(--muted)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;box-shadow:0 8px 24px rgba(40,32,20,.06)}
  .top{display:flex;align-items:center;gap:10px}
  .av{width:30px;height:30px;border-radius:50%;position:relative;flex:0 0 auto;background:#ccc}
  .av:before,.av:after{content:"";position:absolute;top:10px;width:6px;height:6px;border-radius:50%;background:#fff}
  .av:before{left:7px}.av:after{right:7px}
  .wb{background:linear-gradient(145deg,#4d95ff,#1f6be0)}.qw{background:linear-gradient(145deg,#ffa45c,#ef7425)}
  .nm{font-size:13px;font-weight:650}.th{font-size:10.5px;color:var(--muted);margin-top:2px}
  .pill{margin-left:auto;font-size:10px;border-radius:999px;padding:3px 7px;background:#eef4ff;color:var(--blue)}
  .pill.off{background:#fdecec;color:#b33}.pill.wait{background:#fdf3e1;color:var(--amber)}
  .shot{display:block;width:100%;height:190px;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:10px;margin-top:11px;background:#f6f3ed}
  .rows{margin-top:10px;font-size:10.5px;color:var(--muted)}
  .row{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-top:1px dashed #eee7db}
  .row:first-child{border-top:0}.row b{color:#3b362e;font-weight:600;max-width:70%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .foot{margin-top:12px;border-top:1px solid var(--line);padding-top:9px;font-size:10.5px;color:var(--muted);display:flex;justify-content:space-between}
  .approvals{margin-top:14px;background:#fdf6e7;border:1px solid #f0d9a8;border-radius:14px;padding:11px 13px;font-size:11px;color:#6b4d1c}
  .approvals b{display:block;margin-bottom:4px}.approvals .item{padding:3px 0;border-top:1px dashed #ecd9b4}.approvals .item:first-of-type{border-top:0}
  body.embed .head{display:none}body.embed .wrap{margin:10px auto;padding:0 10px}body.embed .shot{height:150px}
  @media(max-width:760px){.grid{grid-template-columns:1fr}.shot{height:150px}}
</style></head><body><div class="wrap">
  <div class="head"><h1>工位面板</h1><span class="sub">botcrew · 只读观察，不代替对话</span></div>
  <div class="grid">
    <div class="card" id="wb-card">
      <div class="top"><div class="av wb"></div><div><div class="nm">WorkBuddy</div><div class="th" id="wb-th">A 对话</div></div><div class="pill" id="wb-pill">检测中</div></div>
      <img class="shot" data-app="workbuddy" src="/shot?app=workbuddy" alt="WorkBuddy 屏幕">
      <div class="rows">
        <div class="row"><span>当前标题</span><b id="wb-title">—</b></div>
        <div class="row"><span>侧栏任务</span><b id="wb-count">—</b></div>
        <div class="row"><span>调试端口</span><b id="wb-port">—</b></div>
      </div>
    </div>
    <div class="card" id="qw-card">
      <div class="top"><div class="av qw"></div><div><div class="nm">千问办公</div><div class="th" id="qw-th">B 对话</div></div><div class="pill" id="qw-pill">检测中</div></div>
      <img class="shot" data-app="qwen" src="/shot?app=qwen" alt="千问办公屏幕">
      <div class="rows">
        <div class="row"><span>当前标题</span><b id="qw-title">—</b></div>
        <div class="row"><span>侧栏任务</span><b id="qw-count">—</b></div>
        <div class="row"><span>调试端口</span><b id="qw-port">—</b></div>
      </div>
    </div>
  </div>
  <div class="approvals" id="approvals" style="display:none"><b>待审批</b><div id="approval-list"></div></div>
  <div class="foot"><span id="ts">—</span><span>3 秒刷新状态 · 5 秒刷新屏幕</span></div>
</div>
<script>
  if (location.search.indexOf('embed=1') >= 0) document.body.classList.add('embed');
  function set(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function pill(id, ok, waiting) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = ok ? (waiting ? '等待' : '在线') : '离线';
    el.className = 'pill' + (ok ? (waiting ? ' wait' : '') : ' off');
  }
  async function refresh() {
    try {
      var r = await fetch('/state', { cache: 'no-store' });
      var s = await r.json();
      var w = s.workbuddy || {};
      pill('wb-pill', w.ok, false);
      set('wb-title', w.header || '—');
      set('wb-count', String(w.threads == null ? '—' : w.threads));
      set('wb-port', w.ok ? String(w.port) : '未连接');
      set('wb-th', w.header ? 'A 对话 · ' + w.header : 'A 对话');
      var q = s.qwen || {};
      pill('qw-pill', q.ok, false);
      set('qw-title', q.title || '—');
      set('qw-count', String(q.tasks == null ? '—' : q.tasks));
      set('qw-port', q.ok ? String(q.port) : '未连接');
      set('qw-th', q.title ? 'B 对话 · ' + q.title : 'B 对话');
      var ap = s.approvals || [];
      var box = document.getElementById('approvals');
      var list = document.getElementById('approval-list');
      if (ap.length) {
        box.style.display = 'block';
        list.innerHTML = ap.map(function (a) {
          return '<div class="item">' + a.id + '：' + a.question + (a.task_id ? '（' + a.task_id + '）' : '') + '</div>';
        }).join('');
      } else {
        box.style.display = 'none';
      }
      set('ts', '更新于 ' + new Date().toLocaleTimeString());
    } catch (e) {
      set('ts', '连接失败：' + e.message);
    }
  }
  async function shots() {
    document.querySelectorAll('img.shot').forEach(function (img) {
      img.src = '/shot?app=' + img.dataset.app + '&t=' + Date.now();
    });
  }
  refresh(); shots();
  setInterval(refresh, 3000);
  setInterval(shots, 5000);
</script>
</body></html>`;

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 32 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function pickWorkThread(text, hint) {
  if (hint) return hint;
  if (!/小红书|种草|发布|发一篇/.test(text)) return '';
  try {
    const { items } = await wb.listThreads();
    const ranked = items
      .map((item) => {
        let score = 0;
        if (/种草/.test(item.title)) score += 5;
        if (/小红书/.test(item.title)) score += 2;
        if (/发布|宣传|爆款/.test(item.title)) score += 2;
        return { title: item.title, score };
      })
      .sort((a, b) => b.score - a.score);
    return ranked[0] && ranked[0].score > 0 ? ranked[0].title : '';
  } catch {
    return '';
  }
}

let loginCache = { at: 0, data: null };
let setupJob = { running: false, startedAt: 0, finishedAt: 0, steps: [], needsRestart: [], errors: [] };

async function loginStatus(force = false) {
  const live = qwenLoginState();
  if (live.running) {
    return { logged_in: false, pending: true, status: live.status, url: live.url, error: live.error, hint: '请在浏览器完成千问登录' };
  }
  if (live.status === 'done') {
    const data = { logged_in: true, pending: false, status: 'done', url: '', error: '', hint: '' };
    loginCache = { at: Date.now(), data };
    return data;
  }
  if (!force && loginCache.data && Date.now() - loginCache.at < 60000) return loginCache.data;
  if (!cfg.qwen || !cfg.qwen.cli || !fs.existsSync(cfg.qwen.cli)) {
    const data = { logged_in: false, pending: false, status: 'missing', url: '', error: '找不到 qoderclicn', hint: '安装千问办公后重试' };
    loginCache = { at: Date.now(), data };
    return data;
  }
  try {
    const status = await Promise.race([
      qwenStatus(cfg),
      new Promise((_, reject) => setTimeout(() => reject(new Error('登录检查超时')), 12000))
    ]);
    const data = {
      logged_in: Boolean(status.logged_in),
      pending: false,
      status: status.logged_in ? 'done' : 'idle',
      url: '',
      error: '',
      hint: status.hint || ''
    };
    loginCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    const data = { logged_in: false, pending: false, status: 'unknown', url: '', error: err.message, hint: '点击「打开千问登录」完成授权' };
    loginCache = { at: Date.now(), data };
    return data;
  }
}

async function setupStatus() {
  const qwenPort = Number((cfg.qwen && cfg.qwen.uiPort) || 9444);
  const [wbPort, qPort, wbRunning, qRunning, login] = await Promise.all([
    isPortUp(cfg.port),
    isPortUp(qwenPort),
    isProcessRunning('WorkBuddy'),
    isProcessRunning('QwenWorkCN'),
    loginStatus()
  ]);
  return {
    ready: Boolean(wbPort && qPort && login.logged_in),
    workbuddy: {
      installed: Boolean(cfg.workbuddyExe && fs.existsSync(cfg.workbuddyExe)),
      running: wbRunning,
      port_up: wbPort,
      port: cfg.port,
      exe: cfg.workbuddyExe
    },
    qwen: {
      installed: Boolean(cfg.qwen && cfg.qwen.exe && fs.existsSync(cfg.qwen.exe)),
      running: qRunning,
      port_up: qPort,
      port: qwenPort,
      exe: (cfg.qwen && cfg.qwen.exe) || '',
      cli: (cfg.qwen && cfg.qwen.cli) || ''
    },
    login,
    panel: { url: `http://127.0.0.1:${port}` },
    setup: { ...setupJob, steps: [...setupJob.steps], needsRestart: [...setupJob.needsRestart], errors: [...setupJob.errors] }
  };
}

function runSetup(body = {}) {
  if (setupJob.running) return setupJob;
  setupJob = { running: true, startedAt: Date.now(), finishedAt: 0, steps: [], needsRestart: [], errors: [] };

  (async () => {
    const qwenPort = Number((cfg.qwen && cfg.qwen.uiPort) || 9444);
    const steps = setupJob.steps;

    if (!(await isPortUp(cfg.port))) {
      try {
        steps.push('正在启动 WorkBuddy…');
        await ensureWorkBuddy(cfg, { restart: Boolean(body.restart_workbuddy) });
        steps.push('WorkBuddy 调试端口已就绪');
      } catch (err) {
        if (/已经在运行/.test(err.message)) setupJob.needsRestart.push('workbuddy');
        else setupJob.errors.push('WorkBuddy：' + err.message);
      }
    } else {
      steps.push('WorkBuddy 已就绪');
    }

    if (!(await isPortUp(qwenPort))) {
      try {
        steps.push('正在启动千问办公…');
        await ensureQwenWork(cfg, { restart: Boolean(body.restart_qwen) });
        steps.push('千问办公调试端口已就绪');
      } catch (err) {
        if (/已经在运行/.test(err.message)) setupJob.needsRestart.push('qwen');
        else setupJob.errors.push('千问办公：' + err.message);
      }
    } else {
      steps.push('千问办公已就绪');
    }

    loginCache = { at: 0, data: null };
    const login = await loginStatus(true);
    if (!login.logged_in && body.login !== false) {
      startQwenLogin(cfg);
      steps.push('已打开千问登录页，请完成浏览器授权');
    }
    setupJob.running = false;
    setupJob.finishedAt = Date.now();
  })();

  return setupJob;
}

async function restartApp(app) {
  if (app === 'workbuddy') return ensureWorkBuddy(cfg, { restart: true });
  if (app === 'qwen') return ensureQwenWork(cfg, { restart: true });
  throw new Error('未知应用');
}async function state() {
  const [wbState, qwState, approvals] = await Promise.all([
    (async () => {
      try {
        const s = await wb.status();
        return { ok: Boolean(s.connected), port: s.port, header: s.header, threads: s.thread_count };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })(),
    (async () => {
      try {
        const s = await qw.status();
        return { ok: Boolean(s.tasks >= 0), port: s.port, title: s.title, tasks: s.tasks };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })(),
    Promise.resolve(store.listApprovals('pending').map((a) => ({ id: a.id, question: a.question, task_id: a.task_id })))
  ]);
  return { workbuddy: wbState, qwen: qwState, approvals };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(HTML);
      return;
    }
    if (url.pathname === '/state') {
      json(res, 200, await state());
      return;
    }
    if (url.pathname === '/group-chat') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(GROUP_CHAT));
      return;
    }
    if (url.pathname === '/shot') {
      const app = url.searchParams.get('app') || 'workbuddy';
      const buf = app === 'qwen' ? await qw.screenshot() : await wb.screenshot();
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(buf);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/attach') {
      const body = await readJson(req);
      const target = String(body.path || '').trim();
      if (!target) {
        json(res, 400, { ok: false, error: 'path 不能为空' });
        return;
      }
      try {
        const stat = fs.statSync(target);
        if (!stat.isFile()) {
          json(res, 400, { ok: false, error: '不是文件' });
          return;
        }
        json(res, 200, { ok: true, name: path.basename(target), path: target, size: stat.size });
      } catch {
        json(res, 400, { ok: false, error: '文件不存在或不可读' });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/setup/run') {
      const body = await readJson(req);
      runSetup(body);
      json(res, 202, { ok: true, setup: setupJob });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/setup/restart') {
      const body = await readJson(req);
      const result = await restartApp(String(body.app || ''));
      json(res, 200, { ok: true, result });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/setup/login') {
      json(res, 200, startQwenLogin(cfg));
      return;
    }
    if (url.pathname === '/api/setup/login') {
      json(res, 200, qwenLoginState());
      return;
    }
    if (url.pathname === '/api/setup/status') {
      json(res, 200, await setupStatus());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const body = await readJson(req);
      if (!body.name || !body.data) {
        json(res, 400, { ok: false, error: 'name 和 data 不能为空' });
        return;
      }
      const buffer = Buffer.from(String(body.data), 'base64');
      if (buffer.length > 25 * 1024 * 1024) {
        json(res, 413, { ok: false, error: '文件超过 25MB' });
        return;
      }
      const dir = path.join(cfg.home, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const safe = path.basename(String(body.name)).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_') || 'file';
      const file = path.join(dir, `${Date.now()}-${safe}`);
      fs.writeFileSync(file, buffer);
      json(res, 200, { ok: true, path: file, size: buffer.length });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/dispatch') {
      const body = await readJson(req);
      const text = String(body.text || '').trim();
      if (!text) {
        json(res, 400, { ok: false, error: 'text 不能为空' });
        return;
      }
      const assistant = String(body.assistant || 'workbuddy').toLowerCase();
      if (assistant === 'custom') {
        const member = body.member || {};
        const name = String(member.name || '成员').trim().slice(0, 30) || '成员';
        const role = String(member.role || '助理').trim().slice(0, 40) || '助理';
        const perms = member.permissions || {};
        const denied = [];
        if (perms.read === false) denied.push('读取文件');
        if (perms.write === false) denied.push('写入文件');
        if (perms.shell === false) denied.push('执行命令');
        if (perms.external === false) denied.push('外发/发布');
        const id = 'C-' + Date.now().toString(36);
        const prompt = `你是群聊成员「${name}」，角色：${role}。请以这个身份完成下面的任务；需要时可以使用工具，完成后直接给出结果。${denied.length ? `\n权限限制：不能${denied.join('、')}。` : ''}\n\n${text}`;
        customTasks.set(id, { id, status: 'running', startedAt: Date.now(), text: '', name });
        qwenWorkDir(cfg);
        qwenRun(cfg, {
          prompt,
          model: 'Qwen3.8-Flash',
          permissionMode: denied.length ? 'auto' : 'bypass_permissions',
          timeoutMs: 600000,
          onSpawn: (child) => {
            const task = customTasks.get(id);
            if (task) task.child = child;
          }
        })
          .then((r) => {
            const task = customTasks.get(id);
            if (task && task.status !== 'stopped') {
              task.status = 'done';
              task.text = r.output || '';
            }
          })
          .catch((err) => {
            const task = customTasks.get(id);
            if (task && task.status !== 'stopped') {
              task.status = 'failed';
              task.text = String(err.message || err);
            }
          });
        json(res, 200, { ok: true, task_id: id, thread: name, assistant: 'custom' });
        return;
      }
      if (assistant === 'qwen' || assistant === 'qwenwork' || assistant === '千问') {
        const id = 'Q-' + Date.now().toString(36);
        await qw.newTask();
        await qw.send(text);
        qwenTasks.set(id, { id, status: 'running', startedAt: Date.now(), thread: '千问办公 · 新任务', lastText: '' });
        json(res, 200, { ok: true, task_id: id, thread: '千问办公 · 新任务', assistant: 'qwen' });
        return;
      }
      const thread = await pickWorkThread(text, body.thread || '');
      const task = await wb.send({ thread, text, mode: 'send' });
      json(res, 200, { ok: true, ...task });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      const body = await readJson(req);
      const id = String(body.task_id || '');
      if (!id) {
        json(res, 400, { ok: false, error: 'task_id 不能为空' });
        return;
      }
      if (id.startsWith('Q-')) {
        const task = qwenTasks.get(id);
        await qw.stop();
        if (task) {
          task.status = 'stopped';
          task.text = '任务已停止。';
        }
        json(res, 200, { ok: true, task_id: id });
        return;
      }
      if (id.startsWith('C-')) {
        const task = customTasks.get(id);
        if (task && task.child) {
          try {
            task.child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
        if (task) {
          task.status = 'stopped';
          task.text = '任务已停止。';
        }
        json(res, 200, { ok: true, task_id: id });
        return;
      }
      const result = await wb.stop();
      try {
        store.updateTask(id, { status: 'stopped', lastText: '任务已停止。' });
      } catch {
        /* ignore */
      }
      json(res, 200, { ok: true, task_id: id, stop: result });
      return;
    }
    if (url.pathname === '/api/task') {
      const id = url.searchParams.get('id') || '';
      if (!id) {
        json(res, 400, { ok: false, error: 'id 不能为空' });
        return;
      }
      if (id.startsWith('C-')) {
        const task = customTasks.get(id);
        if (!task) {
          json(res, 404, { ok: false, error: '未知自定义成员任务' });
          return;
        }
        json(res, 200, {
          ok: true,
          task_id: id,
          status: task.status,
          thread: task.name,
          elapsed_s: Math.round((Date.now() - task.startedAt) / 1000),
          last_text: task.text,
          done: task.status === 'done'
        });
        return;
      }
      if (id.startsWith('Q-')) {
        const task = qwenTasks.get(id);
        if (!task) {
          json(res, 404, { ok: false, error: '未知千问任务' });
          return;
        }
        if (task.status === 'stopped') {
          json(res, 200, {
            ok: true,
            task_id: id,
            status: 'stopped',
            thread: task.thread,
            elapsed_s: Math.round((Date.now() - task.startedAt) / 1000),
            last_text: task.lastText,
            done: true
          });
          return;
        }
        const result = await qw.wait({ timeoutMs: 1500, pollMs: 400 });
        if (result.done) task.status = 'done';
        if (result.text) task.lastText = result.text;
        const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
        json(res, 200, {
          ok: true,
          task_id: id,
          status: task.status,
          thread: task.thread,
          elapsed_s: elapsed,
          last_text: task.lastText,
          done: result.done
        });
        return;
      }
      try {
        const result = await wb.wait(id, 2);
        json(res, 200, { ok: true, ...result });
      } catch (err) {
        if (/未知任务/.test(err.message)) {
          json(res, 404, { ok: false, error: '未知任务' });
          return;
        }
        throw err;
      }
      return;
    }
    res.writeHead(404);
    res.end('not found');
  } catch (err) {
    json(res, 503, { error: err.message });
  }
});

let started = false;

export function startPanelServer() {
  if (started) return server;
  started = true;
  server.listen(port, '127.0.0.1', () => {
    console.log(`[panel] http://127.0.0.1:${port}`);
  });
  server.on('error', (err) => {
    console.error('[panel] listen failed:', err.message);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPanelServer();
}

