import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { isPortUp } from './cdp.js';
import { isProcessRunning } from './launcher.js';

const cfg = loadConfig();
const lines = [];
const add = (k, v) => lines.push(`${k}: ${v}`);

add('node', process.version);
add('platform', `${process.platform} ${process.arch}`);
add('websocket', typeof WebSocket === 'undefined' ? 'MISSING（需要 Node 22+）' : 'ok');
add('config', cfg.configFile);
add('port', cfg.port);
add('workbuddyExe', `${cfg.workbuddyExe} ${fs.existsSync(cfg.workbuddyExe) ? '(exists)' : '(MISSING)'}`);
add('home', `${cfg.home} ${fs.existsSync(cfg.home) ? '(exists)' : '(missing)'}`);
add('artifactsDir', `${cfg.artifactsDir} ${fs.existsSync(cfg.artifactsDir) ? '(exists)' : '(missing)'}`);
add('workbuddyProcess', (await isProcessRunning('WorkBuddy')) ? 'running' : 'not running');
add('debugPort', (await isPortUp(cfg.port)) ? `open (http://127.0.0.1:${cfg.port})` : 'closed');

const storeFile = path.join(cfg.home, 'store.json');
add('store', fs.existsSync(storeFile) ? storeFile : '(not created yet)');
add('probe', fs.existsSync(path.join(cfg.home, 'probe.json')) ? path.join(cfg.home, 'probe.json') : '(not created yet)');

console.log(lines.join('\n'));

if (typeof WebSocket === 'undefined') {
  console.error('\n结论：Node 版本过低或未启用 WebSocket。请升级到 Node 22+，或用 node --experimental-websocket 启动。');
  process.exitCode = 2;
} else if (!(await isPortUp(cfg.port))) {
  console.error('\n结论：调试端口未开启。先完全退出 WorkBuddy，再运行 node src/launcher.js。');
  process.exitCode = 1;
} else {
  console.log('\n结论：环境看起来可用，继续 node src/selftest.js。');
}
