import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function findWorkBuddy() {
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
  if (!cli) return '';
  const exe = path.resolve(path.dirname(cli), '..', '..', 'QwenWorkCN.exe');
  return fs.existsSync(exe) ? exe : '';
}

function findGitBash() {
  const local = process.env.LOCALAPPDATA || '';
  return firstExisting([
    'C:/Program Files/Git/usr/bin/bash.exe',
    'C:/Program Files/Git/bin/bash.exe',
    path.join(local, 'Programs', 'WorkBuddy', 'resources', 'vendor', 'PortableGit', 'usr', 'bin', 'bash.exe')
  ]);
}

const HOME = path.join(os.homedir(), '.dsh', 'office-bus', 'data');
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
  const userConfig = path.join(os.homedir(), '.dsh', 'office-bus', 'data', 'config.json');
  const file =
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
