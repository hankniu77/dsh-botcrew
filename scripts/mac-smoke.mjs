import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

if (process.platform !== 'darwin') {
  console.log('mac-smoke: skipped (not macOS)');
  process.exit(0);
}

const execFileAsync = promisify(execFile);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'botcrew-mac-'));
const home = os.homedir();
const apps = path.join(home, 'Applications');
const workbuddy = path.join(apps, 'WorkBuddy.app', 'Contents', 'MacOS', 'WorkBuddy');
const qwenExe = path.join(apps, 'QwenWorkCN.app', 'Contents', 'MacOS', 'QwenWorkCN');
const qwenCli = path.join(apps, 'QwenWorkCN.app', 'Contents', 'Resources', 'bin', 'qoderclicn');
const dummy = path.join(tmp, 'WorkBuddy');

function write(file, mode = 0o755) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode });
}

try {
  for (const file of [workbuddy, qwenExe, qwenCli]) write(file);
  fs.copyFileSync('/bin/sleep', dummy);
  fs.chmodSync(dummy, 0o755);

  const { loadConfig } = await import('../src/config.js');
  const { isProcessRunning } = await import('../src/launcher.js');
  const cfg = loadConfig();
  assert.equal(cfg.workbuddyExe, workbuddy);
  assert.equal(cfg.qwen.exe, qwenExe);
  assert.equal(cfg.qwen.cli, qwenCli);
  assert.equal(cfg.qwen.gitBashPath, '');
  console.log('mac-smoke: config paths ok');

  const child = spawn(dummy, ['30'], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await isProcessRunning('WorkBuddy'), true);
    console.log('mac-smoke: process detection ok');
  } finally {
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
  }

  const configFile = path.join(tmp, 'config.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      panelPort: 8799,
      home: path.join(tmp, 'data'),
      artifactsDir: path.join(tmp, 'data', 'artifacts'),
      port: 9331
    })
  );
  const server = spawn(process.execPath, ['src/panel-server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, OFFICE_BUS_CONFIG: configFile },
    stdio: 'ignore'
  });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch('http://127.0.0.1:8799/api/setup/status');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.workbuddy && body.qwen);
    console.log('mac-smoke: panel setup status ok');
  } finally {
    server.kill('SIGKILL');
  }

  console.log('mac-smoke: OK');
} finally {
  try {
    await execFileAsync('pkill', ['-x', 'WorkBuddy']);
  } catch {
    /* ignore */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const app of ['WorkBuddy.app', 'QwenWorkCN.app']) {
    fs.rmSync(path.join(apps, app), { recursive: true, force: true });
  }
}
