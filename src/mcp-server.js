import readline from 'node:readline';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { WorkBuddyAdapter } from './adapter.js';
import { ensureWorkBuddy } from './launcher.js';
import { qwenRun, qwenStatus, qwenWorkDir } from './qwen-worker.js';
import { QwenUI } from './qwen-ui.js';

const cfg = loadConfig();
const store = new Store(cfg.home);
const adapter = new WorkBuddyAdapter(cfg, store);
const qwenUI = new QwenUI(cfg);

const VERSION = '0.1.2';

const TOOLS = [
  {
    name: 'office_status',
    description: '查看 WorkBuddy 调试端口、当前对话标题、侧栏对话数量与最近任务。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'office_launch',
    description: '确保 WorkBuddy 以调试端口启动。restart=true 会强制结束已在运行的 WorkBuddy（可能丢失未保存任务）。',
    inputSchema: {
      type: 'object',
      properties: { restart: { type: 'boolean', description: '是否强制重启', default: false } },
      additionalProperties: false
    }
  },
  {
    name: 'office_list_threads',
    description: '列出 WorkBuddy 左侧任务/对话列表（标题、是否当前、别名）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'office_open_thread',
    description: '按别名（如 A/B）或标题打开一个对话，并校验标题。',
    inputSchema: {
      type: 'object',
      properties: { thread: { type: 'string', description: '别名或标题' } },
      required: ['thread'],
      additionalProperties: false
    }
  },
  {
    name: 'office_new_thread',
    description: '新建任务/对话；可选先草拟一个标题（不发送）。',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: '可选，草拟标题' } },
      additionalProperties: false
    }
  },
  {
    name: 'office_send',
    description:
      '在当前或指定对话发送消息。mode=draft 只填入不发送（用于人工确认）；mode=send 直接发送并返回 task_id。',
    inputSchema: {
      type: 'object',
      properties: {
        thread: { type: 'string', description: '可选，别名或标题；省略则用当前对话' },
        text: { type: 'string', description: '消息内容' },
        mode: { type: 'string', enum: ['draft', 'send'], default: 'send' },
        task_id: { type: 'string', description: '可选：你预先生成的任务 ID，必须与消息里的 DONE| 标记一致' }
      },
      required: ['text'],
      additionalProperties: false
    }
  },
  {
    name: 'office_wait',
    description:
      '等待任务完成（分段，最长 120 秒）。识别 DONE|task_id 标记、FAIL 标记，或“停止按钮消失 + 文本稳定”。超时返回 running，可再次调用。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        timeout_s: { type: 'number', default: 120, minimum: 1, maximum: 600 }
      },
      required: ['task_id'],
      additionalProperties: false
    }
  },
  {
    name: 'office_read_last',
    description: '读取指定对话（或当前对话）最后一条助手回复与是否正在生成。',
    inputSchema: {
      type: 'object',
      properties: { thread: { type: 'string' } },
      additionalProperties: false
    }
  },
  {
    name: 'office_commit_draft',
    description: '把当前输入框里已填好的草案真正发送（用于 mode=draft 之后、用户已批准的场景）。',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: '可选，与消息里的 DONE| 标记一致' } },
      additionalProperties: false
    }
  },
  {
    name: 'office_clear_draft',
    description: '清空当前输入框里的草案，不发送。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'office_stop',
    description: '点击当前对话的“停止生成”。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '可选：把该任务标记为已停止' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'office_artifacts',
    description: '列出某个任务目录下的产物文件（路径、大小、修改时间）。',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
      additionalProperties: false
    }
  },
  {
    name: 'office_tasks',
    description: '列出最近的任务记录（task_id、对话、状态、最后文本摘要）。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', default: 10, minimum: 1, maximum: 50 } },
      additionalProperties: false
    }
  },
  {
    name: 'office_set_alias',
    description: '把别名（如 A/B）绑定到一个对话标题。',
    inputSchema: {
      type: 'object',
      properties: { alias: { type: 'string' }, thread: { type: 'string' } },
      required: ['alias', 'thread'],
      additionalProperties: false
    }
  },
  {
    name: 'office_delete_thread',
    description:
      '删除一个任务/对话（不可恢复）。必须显式 confirm=true；只应在用户明确要求删除时调用，且先用标题确认。',
    inputSchema: {
      type: 'object',
      properties: {
        thread: { type: 'string', description: '别名或完整标题' },
        confirm: { type: 'boolean', description: '必须为 true 才会执行' }
      },
      required: ['thread', 'confirm'],
      additionalProperties: false
    }
  },
  {
    name: 'qwen_status',
    description: '检查千问办公（qoderclicn）CLI 是否安装、是否已登录、可用模型。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'qwen_run',
    description:
      '把任务交给千问办公的 qoderclicn 以非交互方式执行，返回 stdout。需要先完成一次 qoderclicn login。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '任务提示词' },
        cwd: { type: 'string', description: '可选工作目录' },
        model: { type: 'string', description: '可选模型，如 Qwen3.8-Flash；默认 Auto' },
        permission_mode: {
          type: 'string',
          enum: ['auto', 'accept_edits', 'default', 'bypass_permissions', 'dont_ask'],
          description: '权限模式，默认 auto（自动放行安全操作）',
          default: 'auto'
        },
        timeout_ms: { type: 'number', description: '可选超时，默认 10 分钟' }
      },
      required: ['prompt'],
      additionalProperties: false
    }
  },
  {
    name: 'qwen_ui_status',
    description: '查看千问办公桌面端（CDP）连接状态、侧栏任务数与当前标题。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'qwen_ui_list_tasks',
    description: '列出千问办公左侧“最近”任务。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'qwen_ui_read_last',
    description: '读取千问办公当前任务最后一条助手回复。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'qwen_ui_send',
    description:
      '在千问办公界面里发一条消息并等待回复（会真实操作桌面端）。new_task=true 时先点“新任务”。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '消息内容' },
        new_task: { type: 'boolean', default: false },
        timeout_s: { type: 'number', default: 180, minimum: 10, maximum: 600 }
      },
      required: ['prompt'],
      additionalProperties: false
    }
  },
  {
    name: 'office_request_approval',
    description: '登记一个需要人拍板的问题，返回对话卡片；人回复后用 office_resolve_approval 记录决定。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '关联任务，可空' },
        question: { type: 'string', description: '要人决定的问题' },
        options: { type: 'array', items: { type: 'string' }, description: '可选项，最多 4 个' }
      },
      required: ['question'],
      additionalProperties: false
    }
  },
  {
    name: 'office_resolve_approval',
    description: '记录某次审批的决定（人已经回答之后调用）。',
    inputSchema: {
      type: 'object',
      properties: {
        approval_id: { type: 'string' },
        decision: { type: 'string', description: '人的决定，原样记录' }
      },
      required: ['approval_id', 'decision'],
      additionalProperties: false
    }
  },
  {
    name: 'office_approvals',
    description: '列出待审批事项。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'office_probe',
    description: '探测页面 DOM：按钮、输入框、标题、列表项，写入 data/probe.json。用于校准选择器。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
];

function log(...args) {
  process.stderr.write(`[botcrew] ${args.join(' ')}\n`);
}

function sendMessage(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function reply(id, result) {
  sendMessage({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

const handlers = {
  office_status: async () => adapter.status(),
  office_launch: async (args) => ensureWorkBuddy(cfg, { restart: Boolean(args.restart) }),
  office_list_threads: async () => {
    const result = await adapter.listThreads();
    return { ...result, aliases: store.aliases() };
  },
  office_open_thread: async (args) => adapter.openThread(args.thread),
  office_new_thread: async (args) => adapter.newThread(args.title || ''),
  office_send: async (args) =>
    adapter.send({
      thread: args.thread || '',
      text: args.text || '',
      mode: args.mode || 'send',
      taskId: args.task_id || ''
    }),
  office_commit_draft: async (args) => adapter.commitDraft({ taskId: args.task_id || '' }),
  office_clear_draft: async () => adapter.clearDraft(),
  office_wait: async (args) => adapter.wait(args.task_id, Number(args.timeout_s) || 120),
  office_read_last: async (args) => adapter.readLast(args.thread || ''),
  office_stop: async (args) => {
    const result = await adapter.stop();
    if (result && result.ok) {
      let id = args && args.task_id ? args.task_id : '';
      if (!id) {
        const running = Object.values(store.data.tasks || {})
          .filter((t) => t.status === 'running')
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        id = running[0] ? running[0].id : '';
      }
      if (id) store.updateTask(id, { status: 'stopped', updatedAt: new Date().toISOString() });
    }
    return result;
  },
  office_artifacts: async (args) => adapter.artifacts(args.task_id),
  office_tasks: async (args) => ({ tasks: store.listTasks(Number(args.limit) || 10) }),
  office_set_alias: async (args) => {
    store.setAlias(args.alias, args.thread);
    return { ok: true, alias: args.alias, thread: args.thread };
  },
  office_delete_thread: async (args) => adapter.deleteThread(args.thread, { confirm: Boolean(args.confirm) }),
  office_request_approval: async (args) => {
    const approval = store.createApproval({
      taskId: args.task_id || '',
      question: args.question || '',
      options: (args.options || []).slice(0, 4)
    });
    const options = approval.options.length
      ? approval.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')
      : '';
    return {
      approval_id: approval.id,
      ...approval,
      display: [
        `⚠ **需要你拍板 · ${approval.id}** \`待确认\``,
        approval.question,
        options,
        approval.task_id ? `任务：${approval.task_id}` : ''
      ].filter(Boolean).join('\n')
    };
  },
  office_resolve_approval: async (args) => {
    const approval = store.resolveApproval(args.approval_id, args.decision || '');
    if (!approval) throw new Error(`未知审批：${args.approval_id}`);
    return {
      ...approval,
      display: `✅ **已确认 · ${approval.id}** \`已完成\`\n决定：${approval.decision}`
    };
  },
  office_approvals: async () => {
    const pending = store.listApprovals('pending');
    return {
      count: pending.length,
      approvals: pending,
      display: pending.length
        ? [`**待审批 · ${pending.length} 项**`, ...pending.map((a) => `- ${a.id}：${a.question}${a.task_id ? `（任务 ${a.task_id}）` : ''}`)].join('\n')
        : '（没有待审批事项）'
    };
  },
  qwen_status: async () => qwenStatus(cfg),
  qwen_run: async (args) => {
    qwenWorkDir(cfg);
    return qwenRun(cfg, {
      prompt: args.prompt || '',
      cwd: args.cwd || '',
      model: args.model || '',
      permissionMode: args.permission_mode || 'auto',
      timeoutMs: Number(args.timeout_ms) || 0
    });
  },
  qwen_ui_status: async () => qwenUI.status(),
  qwen_ui_list_tasks: async () => ({ tasks: await qwenUI.listTasks() }),
  qwen_ui_read_last: async () => ({ text: await qwenUI.readLast() }),
  qwen_ui_send: async (args) => {
    if (args.new_task) await qwenUI.newTask();
    await qwenUI.send(args.prompt || '');
    const result = await qwenUI.wait({ timeoutMs: (Number(args.timeout_s) || 180) * 1000 });
    return { prompt: args.prompt, ...result };
  },
  office_probe: async () => adapter.probe()
};

async function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    reply(id, {
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'botcrew', version: VERSION },
      instructions:
        'Use office_* tools to operate the local WorkBuddy desktop app. Prefer office_send mode=draft when the message would send/publish/pay; ask the human, then send.'
    });
    return;
  }

  if (method === 'ping') {
    reply(id, {});
    return;
  }

  if (method === 'tools/list') {
    reply(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    const handler = handlers[name];
    if (!handler) {
      reply(id, {
        content: [{ type: 'text', text: `未知工具：${name}` }],
        isError: true
      });
      return;
    }
    try {
      const result = await handler(args);
      reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      log(`${name} failed: ${err.message}`);
      reply(id, {
        content: [{ type: 'text', text: `执行失败：${err.message}` }],
        isError: true
      });
    }
    return;
  }

  if (typeof method === 'string' && method.startsWith('notifications/')) {
    return;
  }

  replyError(id, -32601, `Method not found: ${method}`);
}

async function main() {
  log(`starting v${VERSION} port=${cfg.port} home=${cfg.home}`);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      log('invalid JSON on stdin');
      continue;
    }
    try {
      await handleRequest(msg);
    } catch (err) {
      log(`fatal handler error: ${err.stack || err.message}`);
      if (msg && typeof msg.id !== 'undefined') replyError(msg.id, -32603, err.message);
    }
  }
  adapter.close();
}

main().catch((err) => {
  log(`fatal: ${err.stack || err.message}`);
  process.exit(1);
});

