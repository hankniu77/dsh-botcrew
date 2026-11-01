import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function findNamed(root, name, depth = 5) {
  if (depth < 0) return '';
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isFile() && entry.name === name) return full;
      if (entry.isDirectory()) {
        const nested = findNamed(full, name, depth - 1);
        if (nested) return nested;
      }
    }
  } catch {
    /* unreadable or missing */
  }
  return '';
}

function findWorkBuddy() {
  if (isMac) {
    return (
      firstExisting([
        '/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy',
        path.join(os.homedir(), 'Applications', 'WorkBuddy.app', 'Contents', 'MacOS', 'WorkBuddy')
      ]) || 'WorkBuddy'
    );
  }
  const local = process.env.LOCALAPPDATA || '';
  return (
    firstExisting([
      path.join(local, 'Programs', 'WorkBuddy', 'WorkBuddy.exe'),
      'C:/Program Files/WorkBuddy/WorkBuddy.exe',
      'C:/Program Files (x86)/WorkBuddy/WorkBuddy.exe'
    ]) || 'WorkBuddy.exe'
  );
}

function findQwenCli() {
  if (isMac) {
    return (
      firstExisting([
        '/Applications/QwenWorkCN.app/Contents/Resources/bin/qoderclicn',
        '/Applications/QwenWork.app/Contents/Resources/bin/qoderclicn',
        '/Applications/千问办公.app/Contents/Resources/bin/qoderclicn',
        path.join(os.homedir(), 'Applications', 'QwenWorkCN.app', 'Contents', 'Resources', 'bin', 'qoderclicn'),
        path.join(os.homedir(), 'Applications', 'QwenWork.app', 'Contents', 'Resources', 'bin', 'qoderclicn'),
        path.join(os.homedir(), 'Applications', '千问办公.app', 'Contents', 'Resources', 'bin', 'qoderclicn'),
        '/usr/local/bin/qoderclicn',
        '/opt/homebrew/bin/qoderclicn'
      ]) ||
      findNamed('/Applications/QwenWorkCN.app/Contents', 'qoderclicn') ||
      findNamed('/Applications/QwenWork.app/Contents', 'qoderclicn') ||
      findNamed('/Applications/千问办公.app/Contents', 'qoderclicn')
    );
  }
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'QwenWorkCN'),
    'C:/Program Files/QwenWorkCN',
    'C:/Program Files (x86)/QwenWorkCN'
  ];
  const found = [];
  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const cli = path.join(root, entry.name, 'resources', 'bin', 'qoderclicn.exe');
        if (fs.existsSync(cli)) found.push(cli);
      }
    } catch {
      /* not installed */
    }
  }
  found.sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }));
  return found[0] || '';
}

function findQwenExe(cli) {
  if (isMac) {
    return firstExisting([
      '/Applications/QwenWorkCN.app/Contents/MacOS/QwenWorkCN',
      '/Applications/QwenWork.app/Contents/MacOS/QwenWork',
      '/Applications/千问办公.app/Contents/MacOS/千问办公',
      path.join(os.homedir(), 'Applications', 'QwenWorkCN.app', 'Contents', 'MacOS', 'QwenWorkCN'),
      path.join(os.homedir(), 'Applications', 'QwenWork.app', 'Contents', 'MacOS', 'QwenWork'),
      path.join(os.homedir(), 'Applications', '千问办公.app', 'Contents', 'MacOS', '千问办公')
    ]);
  }
  if (!cli) return '';
  const exe = path.resolve(path.dirname(cli), '..', '..', 'QwenWorkCN.exe');
  return fs.existsSync(exe) ? exe : '';
}

function findGitBash() {
  if (!isWin) return '';
  const local = process.env.LOCALAPPDATA || '';
  return firstExisting([
    'C:/Program Files/Git/usr/bin/bash.exe',
    'C:/Program Files/Git/bin/bash.exe',
    path.join(local, 'Programs', 'WorkBuddy', 'resources', 'vendor', 'PortableGit', 'usr', 'bin', 'bash.exe')
  ]);
}

const HOME = path.join(os.homedir(), '.dsh', 'botcrew', 'data');
const QWEN_CLI = findQwenCli();

const DEFAULTS = {
  port: 9331,
  panelPort: 8765,
  workbuddyExe: findWorkBuddy(),
  home: HOME,
  artifactsDir: path.join(HOME, 'artifacts'),
  aliases: {},
  ignoreTitles: [],
  qwen: {
    cli: QWEN_CLI,
    exe: findQwenExe(QWEN_CLI),
    cwd: path.join(HOME, 'qwen-work'),
    gitBashPath: findGitBash(),
    uiPort: 9444,
    timeoutMs: 600000
  },
  selectors: {
    threadItem: '.conversation-agent-card',
    composer: '[contenteditable="true"], textarea, [role="textbox"]',
    assistant: '.cr-markdown',
    title: '.workbuddy-topbar-title',
    button: 'button, [role="button"]'
  },
  timing: {
    pollMs: 2000,
    stablePolls: 12,
    maxWaitSec: 5400,
    connectTimeoutMs: 10000
  }
};

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function loadConfig() {
  const userConfig = path.join(os.homedir(), '.dsh', 'botcrew', 'data', 'config.json');
  const file =
    process.env.BOTCREW_CONFIG ||
    process.env.OFFICE_BUS_CONFIG ||
    (fs.existsSync(userConfig) ? userConfig : path.join(ROOT, 'config.json'));
  let user = {};
  if (fs.existsSync(file)) {
    user = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const cfg = deepMerge(DEFAULTS, user);
  cfg.home = path.resolve(cfg.home);
  cfg.artifactsDir = path.resolve(cfg.artifactsDir);
  fs.mkdirSync(cfg.home, { recursive: true });
  fs.mkdirSync(cfg.artifactsDir, { recursive: true });
  cfg.configFile = file;
  return cfg;
}

