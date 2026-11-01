import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, 'mcp-server.js');

const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env
});

let nextId = 1;
const pending = new Map();
let buffer = '';

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error('[smoke] 非 JSON 输出：', line.slice(0, 200));
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

function rpc(method, params = {}, timeoutMs = 15000) {
  const id = nextId++;
  const payload = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} 超时`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

function textOf(msg) {
  try {
    return msg.result.content[0].text;
  } catch {
    return JSON.stringify(msg.result ?? msg.error);
  }
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'office-bus-smoke', version: '0.1.0' }
  });
  console.log('[initialize]', JSON.stringify(init.result));

  const tools = await rpc('tools/list', {});
  const names = (tools.result?.tools || []).map((t) => t.name);
  console.log('[tools]', names.join(', '));
  if (!names.includes('office_status')) throw new Error('tools/list 里没有 office_status');

  const status = await rpc('tools/call', { name: 'office_status', arguments: {} });
  console.log('[office_status]', textOf(status));
  if (status.result?.isError) {
    console.warn('[warn] office_status 返回错误（通常代表 WorkBuddy 调试端口没开，先跑 start.cmd）');
  }

  const threads = await rpc('tools/call', { name: 'office_list_threads', arguments: {} });
  console.log('[office_list_threads]', textOf(threads).slice(0, 600));

  if (process.argv.includes('--send')) {
    const taskId = `T-SMOKE-${Date.now().toString(36).toUpperCase()}`;
    const text = `【任务】${taskId}\n【目标】MCP 冒烟：不要调用工具\n【完成】只回复：DONE|${taskId}|OK|smoke`;
    const sent = await rpc('tools/call', {
      name: 'office_send',
      arguments: { text, task_id: taskId, mode: 'send' }
    });
    console.log('[office_send]', textOf(sent));
    const waited = await rpc(
      'tools/call',
      { name: 'office_wait', arguments: { task_id: taskId, timeout_s: 120 } },
      150000
    );
    console.log('[office_wait]', textOf(waited));
  }

  console.log('\nSMOKE OK');
} catch (err) {
  console.error('[smoke] 失败：', err.message);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  setTimeout(() => child.kill(), 500);
}
