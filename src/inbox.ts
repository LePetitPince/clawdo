/**
 * Agent-facing inbox - structured JSON with security wrapper
 */

import type { TodoDatabase } from './db.js';
import type { InboxResult } from './types.js';
import { wrapForLLM } from './sanitize.js';

export function generateInbox(db: TodoDatabase): InboxResult {
  const autoExecutionEnabled = db.getConfig('auto_execution_enabled') === 'true';
  const tasksCompleted4h = db.countCompletedInLast(4);

  // OPTIMIZATION: Single query + JS partitioning (fast for <5k tasks)
  // For >10k tasks, push filtering to SQL with separate queries per category
  // Trade-off: 1 query + N iterations (current) vs N queries + 0 iterations
  const allActiveTasks = db.listTasks({ status: ['todo', 'in_progress', 'proposed'] });
  const now = new Date().toISOString().split('T')[0];
  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Partition tasks in a single pass
  const result: InboxResult = {
    meta: {
      autoExecutionEnabled,
      tasksCompleted4h,
    },
    autoReady: [],
    autoNotifyReady: [],
    urgent: [],
    overdue: [],
    proposed: [],
    stale: [],
    blocked: [],
  };

  for (const task of allActiveTasks) {
    // Categorize by status
    if (task.status === 'proposed') {
      result.proposed.push(task);
    }

    // Urgent tasks (any status except archived/done)
    if (task.urgency === 'now' && (task.status === 'todo' || task.status === 'in_progress')) {
      result.urgent.push(task);
    }

    // Overdue tasks
    if (task.dueDate && task.dueDate < now && (task.status === 'todo' || task.status === 'in_progress')) {
      result.overdue.push(task);
    }

    // Blocked tasks
    if (task.blockedBy && (task.status === 'todo' || task.status === 'in_progress')) {
      result.blocked.push(task);
    }

    // Stale tasks (in_progress > 24h)
    if (task.status === 'in_progress' && task.startedAt && task.startedAt < staleThreshold) {
      result.stale.push(task);
    }

    // Auto-ready tasks (todo status, not blocked)
    if (task.status === 'todo' && !task.blockedBy) {
      if (task.autonomy === 'auto') {
        result.autoReady.push(task);
      } else if (task.autonomy === 'auto-notify') {
        result.autoNotifyReady.push(task);
      }
    }
  }

  return result;
}

export function formatInboxJSON(inbox: InboxResult): string {
  const json = JSON.stringify(inbox, null, 2);
  return wrapForLLM(json);
}

export function formatInboxMarkdown(inbox: InboxResult): string {
  const lines: string[] = [];

  lines.push('# Todo Inbox\n');
  lines.push('## Meta');
  lines.push(`- Auto execution: ${inbox.meta.autoExecutionEnabled ? 'enabled' : 'disabled'}`);
  lines.push(`- Tasks completed (4h): ${inbox.meta.tasksCompleted4h}\n`);

  if (inbox.urgent.length > 0) {
    lines.push(`## Urgent (${inbox.urgent.length})`);
    for (const task of inbox.urgent) {
      lines.push(`- [${task.id}] ${task.text} (${task.autonomy})`);
    }
    lines.push('');
  }

  if (inbox.overdue.length > 0) {
    lines.push(`## Overdue (${inbox.overdue.length})`);
    for (const task of inbox.overdue) {
      lines.push(`- [${task.id}] ${task.text} - due ${task.dueDate}`);
    }
    lines.push('');
  }

  if (inbox.autoReady.length > 0) {
    lines.push(`## Auto Ready (${inbox.autoReady.length})`);
    for (const task of inbox.autoReady) {
      lines.push(`- [${task.id}] ${task.text}`);
    }
    lines.push('');
  }

  if (inbox.autoNotifyReady.length > 0) {
    lines.push(`## Auto-Notify Ready (${inbox.autoNotifyReady.length})`);
    for (const task of inbox.autoNotifyReady) {
      lines.push(`- [${task.id}] ${task.text}`);
    }
    lines.push('');
  }

  if (inbox.proposed.length > 0) {
    lines.push(`## Proposed (${inbox.proposed.length})`);
    for (const task of inbox.proposed) {
      lines.push(`- [${task.id}] ${task.text} (${task.urgency})`);
    }
    lines.push('');
  }

  if (inbox.stale.length > 0) {
    lines.push(`## Stale (in progress >24h) (${inbox.stale.length})`);
    for (const task of inbox.stale) {
      const startedAgo = task.startedAt ? `started ${task.startedAt}` : '';
      lines.push(`- [${task.id}] ${task.text} ${startedAgo}`);
    }
    lines.push('');
  }

  if (inbox.blocked.length > 0) {
    lines.push(`## Blocked (${inbox.blocked.length})`);
    for (const task of inbox.blocked) {
      lines.push(`- [${task.id}] ${task.text} - blocked by ${task.blockedBy}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
