import { spawn } from 'node:child_process';
import fs from 'node:fs';

let state = {
  running: false,
  status: 'idle',
  url: '',
  error: '',
  startedAt: 0,
  finishedAt: 0
};

let child = null;
let timer = null;

export function qwenLoginState() {
  return { ...state };
}

function openBrowser(url) {
  if (!url) return;
  try {
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';
    const command = isMac ? 'open' : isWin ? 'rundll32.exe' : 'xdg-open';
    const args = isMac ? [url] : isWin ? ['url.dll,FileProtocolHandler', url] : [url];
    const p = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    p.unref();
  } catch {
    /* 用户可手动打开返回的 URL */
  }
}

export function startQwenLogin(cfg) {
  if (state.running) return qwenLoginState();
  const cli = cfg.qwen && cfg.qwen.cli;
  if (!cli || !fs.existsSync(cli)) {
    state = { running: false, status: 'failed', url: '', error: '找不到 qoderclicn', startedAt: Date.now(), finishedAt: Date.now() };
    return qwenLoginState();
  }

  state = { running: true, status: 'waiting', url: '', error: '', startedAt: Date.now(), finishedAt: 0 };
  const env = { ...process.env };
  if (cfg.qwen.gitBashPath && fs.existsSync(cfg.qwen.gitBashPath)) {
    env.QODER_GIT_BASH_PATH = cfg.qwen.gitBashPath;
    env.QODER_BASH_PATH = cfg.qwen.gitBashPath;
    env.GIT_BASH = cfg.qwen.gitBashPath;
  }

  child = spawn(cli, ['login'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let all = '';
  let opened = false;
  child.stdout.on('data', (chunk) => {
    all += chunk.toString('utf8');
    const match = all.match(/https:\/\/qoder\.cn\/device\/[^\s"']+/i);
    if (match && !opened) {
      state.url = match[0];
      opened = true;
      openBrowser(state.url);
    }
  });
  child.stderr.on('data', (chunk) => {
    all += chunk.toString('utf8');
  });
  child.on('error', (err) => {
    state.running = false;
    state.status = 'failed';
    state.error = err.message;
    state.finishedAt = Date.now();
  });
  child.on('close', (code) => {
    state.running = false;
    state.status = code === 0 ? 'done' : 'failed';
    state.finishedAt = Date.now();
    if (code !== 0 && !state.error) state.error = all.replace(/\s+/g, ' ').slice(-500);
    if (timer) clearTimeout(timer);
    child = null;
  });

  timer = setTimeout(() => {
    if (!child) return;
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    state.running = false;
    state.status = 'failed';
    state.error = '登录等待超时（5 分钟）';
    state.finishedAt = Date.now();
    timer = null;
  }, 5 * 60 * 1000);

  return qwenLoginState();
}
