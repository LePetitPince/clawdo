/**
 * render.ts - Output formatting layer
 * Separates display logic from business logic for clean JSON/text dual output.
 */

import chalk from 'chalk';
import type { Task, TaskHistory, TaskStatus, AutonomyLevel, Urgency } from './types.js';

export type OutputFormat = 'text' | 'json';

// Semantic color helpers (auto-disabled in non-TTY, respects NO_COLOR)
const c = {
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,
  dim: chalk.dim,
  id: chalk.cyan,
  project: chalk.magenta,
  context: chalk.yellow,
  status: chalk.blue,
  autonomy: chalk.green,
  meta: chalk.gray,
};

/**
 * Render a single task (text format)
 */
export function renderTaskLine(task: Task, compact: boolean = false): string {
  const statusIcon = task.status === 'done' ? '●' : task.status === 'archived' ? '◯' : '○';
  const prefix = task.id.substring(0, 6);
  
  let line = `${statusIcon} [${c.id(prefix)}] ${task.text}`;
  
  if (task.project) line += ` ${c.project(task.project)}`;
  if (task.context) line += ` ${c.context(task.context)}`;
  
  if (!compact) {
    const meta: string[] = [
      c.status(task.status),
      c.autonomy(task.autonomy),
      task.urgency,
      c.dim(`added ${formatAge(task.createdAt)}`),
    ];
    
    if (task.blockedBy) {
      meta.push(c.warning(`blocked by ${task.blockedBy.substring(0, 6)}`));
    }
    
    if (task.dueDate) {
      meta.push(`due ${task.dueDate}`);
    }
    
    line += `\n  ${meta.join(' | ')}`;
    
    if (task.notes) {
      const noteLines = task.notes.split('\n').slice(0, 2);
      line += '\n  📝 ' + noteLines.join('\n     ');
      if (task.notes.split('\n').length > 2) {
        line += c.dim('\n     ... (more)');
      }
    }
  }
  
  return line;
}

/**
 * Render a list of tasks
 */
export function renderTaskList(tasks: Task[], format: OutputFormat = 'text', options: { compact?: boolean } = {}): string {
  if (format === 'json') {
    return JSON.stringify({ tasks }, null, 2);
  }
  
  if (tasks.length === 0) {
    return '\nNo tasks found.\n';
  }
  
  let output = `\n${tasks.length} task(s):\n\n`;
  for (const task of tasks) {
    output += renderTaskLine(task, options.compact) + '\n\n';
  }
  
  return output;
}

/**
 * Render a single task (detailed view)
 */
export function renderTaskDetail(task: Task | null, format: OutputFormat = 'text'): string {
  if (format === 'json') {
    return JSON.stringify({ task }, null, 2);
  }
  
  if (!task) {
    return '\nTask not found.\n';
  }
  
  const statusIcon = task.status === 'done' ? '●' : task.status === 'archived' ? '◯' : '○';
  
  let output = `\n${statusIcon} Task: ${task.text}\n\n`;
  output += c.dim('ID:        ') + c.id(task.id) + '\n';
  output += c.dim('Status:    ') + c.status(task.status) + '\n';
  output += c.dim('Autonomy:  ') + c.autonomy(task.autonomy) + '\n';
  output += c.dim('Urgency:   ') + task.urgency + '\n';
  output += c.dim('Added by:  ') + task.addedBy + '\n';
  output += c.dim('Created:   ') + formatTimestamp(task.createdAt) + '\n';
  
  if (task.project) output += c.dim('Project:   ') + c.project(task.project) + '\n';
  if (task.context) output += c.dim('Context:   ') + c.context(task.context) + '\n';
  if (task.dueDate) output += c.dim('Due:       ') + task.dueDate + '\n';
  if (task.blockedBy) output += c.dim('Blocked:   ') + c.warning(task.blockedBy) + '\n';
  if (task.startedAt) output += c.dim('Started:   ') + formatTimestamp(task.startedAt) + '\n';
  if (task.completedAt) output += c.dim('Completed: ') + formatTimestamp(task.completedAt) + '\n';
  
  if (task.attempts > 0) {
    output += c.dim('Attempts:  ') + task.attempts + '\n';
    if (task.lastAttemptAt) {
      output += c.dim('Last try:  ') + formatTimestamp(task.lastAttemptAt) + '\n';
    }
  }
  
  if (task.tokensUsed > 0) {
    output += c.dim('Tokens:    ') + task.tokensUsed.toLocaleString() + '\n';
  }
  
  if (task.durationSec > 0) {
    output += c.dim('Duration:  ') + formatDuration(task.durationSec) + '\n';
  }
  
  if (task.notes) {
    output += '\n' + c.dim('Notes:') + '\n' + task.notes + '\n';
  }
  
  return output;
}

/**
 * Render task history
 */
export function renderHistory(history: TaskHistory[], format: OutputFormat = 'text'): string {
  if (format === 'json') {
    return JSON.stringify({ history }, null, 2);
  }
  
  if (history.length === 0) {
    return '\nNo history found.\n';
  }
  
  let output = `\n${history.length} history entry(ies):\n\n`;
  
  for (const entry of history) {
    output += `[${formatTimestamp(entry.timestamp)}] ${entry.action} (${entry.actor})\n`;
    if (entry.notes) {
      output += `  ${entry.notes}\n`;
    }
    if (entry.sessionId) {
      output += `  Session: ${entry.sessionId}\n`;
    }
    if (entry.toolsUsed) {
      output += `  Tools: ${entry.toolsUsed}\n`;
    }
    output += '\n';
  }
  
  return output;
}

/**
 * Render stats
 */
export function renderStats(stats: {
  total: number;
  byStatus: Record<TaskStatus, number>;
  byAutonomy: Record<AutonomyLevel, number>;
}, format: OutputFormat = 'text'): string {
  if (format === 'json') {
    return JSON.stringify(stats, null, 2);
  }
  
  let output = '\n📊 Task Statistics\n\n';
  output += `Total tasks: ${stats.total}\n\n`;
  
  output += 'By Status:\n';
  for (const [status, count] of Object.entries(stats.byStatus)) {
    if (count > 0) {
      output += `  ${status.padEnd(15)} ${count}\n`;
    }
  }
  
  output += '\nActive tasks by autonomy:\n';
  for (const [autonomy, count] of Object.entries(stats.byAutonomy)) {
    if (count > 0) {
      output += `  ${autonomy.padEnd(15)} ${count}\n`;
    }
  }
  
  return output + '\n';
}

/**
 * Render success message
 */
export function renderSuccess(message: string, format: OutputFormat = 'text', data?: any): string {
  if (format === 'json') {
    return JSON.stringify({ success: true, message, ...data }, null, 2);
  }
  
  return c.success('✓') + ' ' + message + '\n';
}

/**
 * Render error message
 */
export function renderError(error: any, format: OutputFormat = 'text'): string {
  if (format === 'json') {
    // Check if it's a ClawdoError with toJSON method
    if (error.toJSON) {
      return JSON.stringify(error.toJSON(), null, 2);
    }
    return JSON.stringify({
      error: true,
      code: 'UNKNOWN_ERROR',
      message: error.message || String(error)
    }, null, 2);
  }
  
  // Text format
  const code = error.code ? ` [${error.code}]` : '';
  let output = c.error('✗') + ' Error' + (error.code ? c.dim(` [${error.code}]`) : '') + ': ' + error.message + '\n';
  
  if (error.context) {
    output += '\n';
    for (const [key, value] of Object.entries(error.context)) {
      if (key === 'matches' && Array.isArray(value)) {
        output += c.dim(`  ${key}: `) + value.join(', ') + '\n';
      } else {
        output += c.dim(`  ${key}: `) + value + '\n';
      }
    }
  }
  
  return output;
}

/**
 * Format relative time (e.g., "2h ago")
 */
function formatAge(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Format absolute timestamp (human-readable)
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Format duration in seconds to human-readable
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
