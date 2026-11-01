import { loadConfig } from './config.js';
import { Store } from './store.js';
import { WorkBuddyAdapter } from './adapter.js';
import { ensureWorkBuddy } from './launcher.js';

const args = process.argv.slice(2);
const cfg = loadConfig();
const store = new Store(cfg.home);
const adapter = new WorkBuddyAdapter(cfg, store);

function has(flag) {
  return args.includes(flag);
}

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : '';
}

try {
  if (has('--launch')) {
    const launched = await ensureWorkBuddy(cfg, { restart: has('--restart') });
    console.log('[launch]', JSON.stringify(launched));
  }

  const status = await adapter.status();
  console.log('[status]', JSON.stringify(status, null, 2));

  if (!status.connected) {
    console.error('\n调试端口未开启。先运行：node src/launcher.js   （或 node src/selftest.js --launch）');
    process.exit(2);
  }

  const list = await adapter.listThreads();
  console.log('[threads]', JSON.stringify(list, null, 2));

  const open = valueOf('--open');
  if (open) {
    const opened = await adapter.openThread(open);
    console.log('[open]', JSON.stringify(opened, null, 2));
    const last = await adapter.readLast('');
    console.log('[last]', JSON.stringify(last, null, 2));
  }

  adapter.close();
  console.log('\nOK');
} catch (err) {
  console.error(`[selftest] ${err.message}`);
  try {
    adapter.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
