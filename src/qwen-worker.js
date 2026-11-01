import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function clean(text) {
  return String(text || '').replace(ANSI, '').replace(/\r/g, '');
}

export function qwenCli(cfg) {
  return (cfg.qwen && cfg.qwen.cli) || '';
}

export async function qwenStatus(cfg) {
  const cli = qwenCli(cfg);
  if (!cli || !fs.existsSync(cli)) {
    return { installed: false, cli, logged_in: false, hint: '找不到 qoderclicn.exe，检查 config.qwen.cli' };
  }
  const result = await runOnce(cli, ['--list-models'], { timeoutMs: 30000 });
  const out = clean(`${result.stdout}\n${result.stderr}`);
  const loggedIn = !/not logged in|请.*登录|login/i.test(out) || result.code === 0;
  return {
    installed: true,
    cli,
    logged_in: Boolean(loggedIn && result.code === 0),
    exit_code: result.code,
    output: out.slice(0, 2000),
    hint: loggedIn ? '' : '先运行一次 qoderclicn.exe login 完成账号登录'
  };
}

function runOnce(cli, args, { cwd, timeoutMs = 60000, env, onSpawn } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cli, args, {
      cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
      env: { ...process.env, ...(env || {}) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (typeof onSpawn === 'function') onSpawn(child);
    let stdout = '';
    let stderr = '';
    let timer = null;
    const done = (code, timedOut = false) => {
      if (timer) clearTimeout(timer);
      resolve({ code: typeof code === 'number' ? code : -1, stdout, stderr, timedOut });
    };
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done(-1, true);
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      stderr += `\nspawn error: ${err.message}`;
      done(-1);
    });
    child.on('close', (code) => done(code));
  });
}

export async function qwenRun(cfg, { prompt, cwd = '', timeoutMs = 0, model = '', permissionMode = 'auto', onSpawn } = {}) {
  const cli = qwenCli(cfg);
  if (!cli || !fs.existsSync(cli)) throw new Error('找不到 qoderclicn.exe，检查 config.qwen.cli');
  if (!prompt || !prompt.trim()) throw new Error('prompt 不能为空');

  const status = await qwenStatus(cfg);
  if (!status.logged_in) {
    throw new Error('qoderclicn 未登录：先在终端运行一次 qoderclicn.exe login，再调用 qwen_run');
  }

  const workdir = cwd || (cfg.qwen && cfg.qwen.cwd) || '';
  if (workdir) fs.mkdirSync(workdir, { recursive: true });

  const args = ['-p', prompt, '--permission-mode', permissionMode || 'auto'];
  if (model) args.push('-m', model);
  const childEnv = {};
  if (cfg.qwen && cfg.qwen.gitBashPath && fs.existsSync(cfg.qwen.gitBashPath)) {
    childEnv.QODER_GIT_BASH_PATH = cfg.qwen.gitBashPath;
    childEnv.QODER_BASH_PATH = cfg.qwen.gitBashPath;
    childEnv.GIT_BASH = cfg.qwen.gitBashPath;
  }
  const started = Date.now();
  const result = await runOnce(cli, args, {
    cwd: workdir,
    timeoutMs: timeoutMs || (cfg.qwen && cfg.qwen.timeoutMs) || 600000,
    env: childEnv,
    onSpawn
  });

  return {
    exit_code: result.code,
    timed_out: result.timedOut,
    duration_ms: Date.now() - started,
    cwd: workdir,
    model: model || 'auto',
    permission_mode: permissionMode || 'auto',
    output: clean(result.stdout).trim(),
    stderr: clean(result.stderr).trim().slice(0, 4000)
  };
}

export function qwenWorkDir(cfg) {
  const dir = (cfg.qwen && cfg.qwen.cwd) || path.join(cfg.home, 'qwen-work');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
