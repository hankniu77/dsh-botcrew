import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPortUp } from './cdp.js';
import { loadConfig } from './config.js';

const execFileAsync = promisify(execFile);

function systemExe(name) {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const full = path.join(root, 'System32', name);
  return fs.existsSync(full) ? full : name;
}

export async function isProcessRunning(imageName) {
  try {
    const { stdout } = await execFileAsync(systemExe('tasklist.exe'), [
      '/FI',
      `IMAGENAME eq ${imageName}`,
      '/FO',
      'CSV',
      '/NH'
    ]);
    return stdout.includes(imageName);
  } catch {
    return false;
  }
}

async function killProcess(imageName) {
  try {
    await execFileAsync(systemExe('taskkill.exe'), ['/IM', imageName, '/F']);
  } catch {
    /* 进程可能已退出 */
  }
}

export async function ensureWorkBuddy(cfg, { restart = false, timeoutSec = 45 } = {}) {
  const portUp = await isPortUp(cfg.port);
  if (portUp && !restart) {
    return { started: false, port: cfg.port, reason: 'already-listening' };
  }

  if (!fs.existsSync(cfg.workbuddyExe)) {
    throw new Error(`找不到 WorkBuddy.exe：${cfg.workbuddyExe}（请在 config.json 修正 workbuddyExe）`);
  }

  const running = await isProcessRunning('WorkBuddy.exe');
  if (running && !restart && !portUp) {
    throw new Error(
      'WorkBuddy 已经在运行，但没有开调试端口。请先完全退出 WorkBuddy，再运行 launcher；或加 --restart 让 launcher 强制重启（未保存的任务会丢）。'
    );
  }

  if (running && restart) {
    await killProcess('WorkBuddy.exe');
    await delay(2500);
  }

  const args = [
    `--remote-debugging-port=${cfg.port}`,
    '--remote-allow-origins=*',
    '--force-renderer-accessibility',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'
  ];

  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.ELECTRON_FORCE_RENDERER_ACCESSIBILITY;

  const child = spawn(cfg.workbuddyExe, args, {
    cwd: path.dirname(cfg.workbuddyExe),
    env: childEnv,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();

  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (await isPortUp(cfg.port)) {
      return { started: true, pid: child.pid, port: cfg.port };
    }
    await delay(500);
  }

  throw new Error(`WorkBuddy 启动后 ${timeoutSec}s 内调试端口仍未就绪（port=${cfg.port}）`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

export async function ensureQwenWork(cfg, { restart = false, timeoutSec = 45 } = {}) {
  const exe = (cfg.qwen && cfg.qwen.exe) || '';
  const port = Number((cfg.qwen && cfg.qwen.uiPort) || 9444);
  const portUp = await isPortUp(port);
  if (portUp && !restart) {
    return { started: false, port, reason: 'already-listening' };
  }

  if (!exe || !fs.existsSync(exe)) {
    throw new Error(`找不到 QwenWorkCN.exe：${exe || '(未配置)'}（请在 config.json 修正 qwen.exe）`);
  }

  const running = await isProcessRunning('QwenWorkCN.exe');
  if (running && !restart && !portUp) {
    throw new Error('千问办公已经在运行，但没有开调试端口。需要完全退出后重开，或允许重启（未保存的任务会丢）。');
  }

  if (running && restart) {
    await killProcess('QwenWorkCN.exe');
    await delay(3000);
  }

  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding'
  ];
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.ELECTRON_FORCE_RENDERER_ACCESSIBILITY;

  const child = spawn(exe, args, {
    cwd: path.dirname(exe),
    env: childEnv,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();

  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (await isPortUp(port)) {
      return { started: true, pid: child.pid, port };
    }
    await delay(500);
  }
  throw new Error(`千问办公启动后 ${timeoutSec}s 内调试端口仍未就绪（port=${port}）`);
}

if (isMain) {
  const cfg = loadConfig();
  const restart = process.argv.includes('--restart');
  ensureWorkBuddy(cfg, { restart })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((err) => {
      console.error(`[botcrew] ${err.message}`);
      process.exit(1);
    });
}

