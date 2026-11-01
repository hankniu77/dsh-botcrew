import { loadConfig } from '../src/config.js';
import { isProcessRunning } from '../src/launcher.js';

const cfg = loadConfig();
console.log(
  JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      workbuddyExe: cfg.workbuddyExe,
      qwenExe: cfg.qwen.exe,
      qwenCli: cfg.qwen.cli,
      gitBashPath: cfg.qwen.gitBashPath,
      home: cfg.home,
      workbuddyRunning: await isProcessRunning('WorkBuddy'),
      qwenRunning: await isProcessRunning('QwenWorkCN')
    },
    null,
    2
  )
);
