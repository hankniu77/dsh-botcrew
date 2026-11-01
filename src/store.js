import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(home) {
    this.file = path.join(home, 'store.json');
    this.data = { tasks: {}, aliases: {}, approvals: {} };
    if (fs.existsSync(this.file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { tasks: parsed.tasks || {}, aliases: parsed.aliases || {}, approvals: parsed.approvals || {} };
      } catch {
        /* 损坏就重建，不阻塞启动 */
      }
    }
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  newTaskId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 6);
    return `T-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${rand}`;
  }

  createTask(fields) {
    const id = fields.id || this.newTaskId();
    const task = {
      id,
      thread: fields.thread || '',
      text: fields.text || '',
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastText: '',
      baselineText: fields.baselineText || '',
      beforeTitles: Array.isArray(fields.beforeTitles) ? fields.beforeTitles : [],
      artifacts: []
    };
    this.data.tasks[id] = task;
    this.save();
    return task;
  }

  updateTask(id, patch) {
    const task = this.data.tasks[id];
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return task;
  }

  getTask(id) {
    return this.data.tasks[id] || null;
  }

  listTasks(limit = 20) {
    return Object.values(this.data.tasks)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  }

  setAlias(alias, title) {
    this.data.aliases[alias] = title;
    this.save();
  }

  getAlias(alias) {
    return this.data.aliases[alias] || null;
  }

  aliases() {
    return { ...this.data.aliases };
  }

  removeAliasByTitle(title) {
    let changed = false;
    for (const [alias, value] of Object.entries(this.data.aliases)) {
      if (value === title) {
        delete this.data.aliases[alias];
        changed = true;
      }
    }
    if (changed) this.save();
    return changed;
  }

  newApprovalId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const seq = Object.keys(this.data.approvals || {}).length + 1;
    return `A-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(seq)}`;
  }

  createApproval({ taskId = '', question = '', options = [] } = {}) {
    const id = this.newApprovalId();
    const approval = {
      id,
      task_id: taskId,
      question,
      options: Array.isArray(options) ? options : [],
      status: 'pending',
      decision: '',
      createdAt: new Date().toISOString(),
      resolvedAt: ''
    };
    this.data.approvals[id] = approval;
    this.save();
    return approval;
  }

  resolveApproval(id, decision) {
    const approval = this.data.approvals[id];
    if (!approval) return null;
    approval.status = 'resolved';
    approval.decision = decision;
    approval.resolvedAt = new Date().toISOString();
    this.save();
    return approval;
  }

  listApprovals(status = 'pending') {
    return Object.values(this.data.approvals || {})
      .filter((a) => !status || a.status === status)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
}
