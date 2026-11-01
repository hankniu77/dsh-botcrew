import { loadConfig } from './config.js';
import { Store } from './store.js';
import { WorkBuddyAdapter } from './adapter.js';
import { ensureWorkBuddy } from './launcher.js';

const args = process.argv.slice(2);
const cfg = loadConfig();
const store = new Store(cfg.home);
const adapter = new WorkBuddyAdapter(cfg, store);

try {
  if (args.includes('--launch')) {
    console.log('[launch]', JSON.stringify(await ensureWorkBuddy(cfg, { restart: args.includes('--restart') })));
  }
  const result = await adapter.probe();
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n已写入 ${result.file}，把里面按钮/输入框的文本与 class 对照 config.selectors 调整。`);
  adapter.close();
} catch (err) {
  console.error(`[probe] ${err.message}`);
  adapter.close();
  process.exit(1);
}
