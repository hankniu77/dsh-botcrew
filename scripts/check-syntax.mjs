import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const files = [];
for (const dir of ['src', 'lib']) {
  for (const entry of fs.readdirSync(path.join(root, dir))) {
    if (entry.endsWith('.js')) files.push(path.join(dir, entry));
  }
}
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`syntax failed: ${file}`);
  }
}
if (failed) process.exit(1);
console.log(`syntax ok: ${files.length} files`);
