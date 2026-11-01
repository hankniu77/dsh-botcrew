import path from 'node:path';

const STATUS = {
  queued: '排队中',
  running: '运行中',
  waiting_input: '等待输入',
  waiting_approval: '等待审批',
  done: '完成',
  failed: '失败',
  stopped: '已停止',
  blocked: '受阻'
};

export function statusZh(status) {
  return STATUS[status] || status || '未知';
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

export function cleanSummary(text, max = 220) {
  const raw = String(text || '')
    .replace(/DONE\|[^\n]*/gi, '')
    .replace(/FAIL\|[^\n]*/gi, '')
    .replace(/完成\|[^\n]*/g, '')
    .replace(/失败\|[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function artifactLines(files = [], limit = 5) {
  return files
    .slice(0, limit)
    .map((f) => {
      const name = path.basename(f.path);
      const link = String(f.path).replace(/\\/g, '/');
      return `📎 [${name}](${link}) · ${fileSize(f.size)}`;
    })
    .join('\n');
}

export function taskDisplay({ bot = 'WorkBuddy', thread = '', status = 'running', elapsedSeconds = 0, summary = '', files = [], note = '' } = {}) {
  const head = `**${bot}${thread ? ` · ${thread}` : ''}** \`${statusZh(status)} ${fmtDuration(elapsedSeconds)}\``;
  const body = cleanSummary(summary) || (status === 'done' ? '任务完成。' : '');
  const arts = artifactLines(files);
  return [head, body, arts, note].filter(Boolean).join('\n');
}
