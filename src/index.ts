#!/usr/bin/env node

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import { TodoDatabase } from './db.js';
import { parseTaskText } from './parser.js';
import { generateInbox, formatInboxJSON, formatInboxMarkdown } from './inbox.js';
import type { AutonomyLevel, Urgency, AddedBy, Task, TaskStatus } from './types.js';
import * as readline from 'readline';
import { 
  renderTaskList, 
  renderTaskDetail, 
  renderHistory, 
  renderStats, 
  renderSuccess, 
  renderError,
  type OutputFormat 
} from './render.js';

const program = new Command();

// Helper function for readline confirmations.
// DESIGN: Non-TTY (piped/scripted) mode auto-confirms. This is standard CLI
// behavior and intentional — agents running bulk operations in scripts are
// trusted callers. The safety boundary is the autonomy level, not the
// confirmation prompt. If you need to prevent agent bulk ops, don't give
// agents access to bulk commands; the prompt is a UX convenience, not security.
function confirmAction(message: string, callback: (confirmed: boolean) => void): void {
  if (!process.stdin.isTTY) {
    callback(true);
    return;
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  try {
    rl.question(`${message} (y/N) `, (answer: string) => {
      const confirmed = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
      rl.close();
      callback(confirmed);
    });
  } catch (error) {
    console.error(`Error during confirmation: ${(error as Error).message}`);
    rl.close();
    callback(false);
  }
}

// Helper to expand ~ in paths
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

// Get DB and audit paths (allow override via env var or --db flag)
function getDbPaths(customDbPath?: string): { dbPath: string; auditPath: string } {
  const basePath = customDbPath || process.env.CLAWDO_DB_PATH;
  
  if (basePath) {
    // Custom path specified - use it directly
    const expanded = expandPath(basePath);
    return {
      dbPath: expanded,
      auditPath: expanded.replace(/\.db$/, '.audit.jsonl')
    };
  }
  
  // Default: ~/.config/clawdo/
  const configDir = expandPath('~/.config/clawdo');
  return {
    dbPath: join(configDir, 'clawdo.db'),
    auditPath: join(configDir, 'audit.jsonl')
  };
}

// Helper to get DB instance
function getDb(customDbPath?: string): TodoDatabase {
  const { dbPath, auditPath } = getDbPaths(customDbPath);
  return new TodoDatabase(dbPath, auditPath);
}

// Helper to resolve task ID from prefix
function resolveId(db: TodoDatabase, idOrPrefix: string): string {
  try {
    const resolved = db.resolveTaskId(idOrPrefix);
    if (!resolved) {
      throw new Error(`Task not found: ${idOrPrefix}`);
    }
    return resolved;
  } catch (error) {
    throw error; // Re-throw ambiguous match errors
  }
}

// Helper to resolve multiple task IDs from comma-separated list
function resolveIds(db: TodoDatabase, idsOrPrefixes: string): string[] {
  const parts = idsOrPrefixes.split(',').map(s => s.trim()).filter(s => s.length > 0);
  const resolved: string[] = [];
  
  for (const part of parts) {
    const id = resolveId(db, part);
    resolved.push(id);
  }
  
  return resolved;
}

// Helper to truncate text
function truncateText(text: string, maxLen: number = 60): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

// Helper to format time ago
function formatTimeAgo(isoTimestamp: string): string {
  const now = new Date();
  const then = new Date(isoTimestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWeek = Math.floor(diffDay / 7);
  return `${diffWeek}w ago`;
}

program
  .name('clawdo')
  .description('Personal task queue with autonomous execution — claw + to-do')
  .version('1.1.3')
  .option('--db <path>', 'Database path (default: ~/.config/clawdo/clawdo.db, or $CLAWDO_DB_PATH)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.db) {
      process.env.CLAWDO_DB_PATH = opts.db;
    }
  })
  .addHelpText('after', `
EXAMPLES (copy-paste these):
  # Add a task (inline tags: +project @context, urgency: now/soon/whenever/someday)
  clawdo add "Fix the login bug +backend @coding auto soon"
  clawdo add "Review PR #42" --level collab --urgency now

  # View tasks
  clawdo list                       # all active tasks
  clawdo list --status proposed     # filter by status
  clawdo next                       # highest priority task
  clawdo list --json                # JSON output for agents

  # Work on tasks
  clawdo start abc123               # mark in-progress
  clawdo done abc123                # mark complete
  clawdo done abc,def,ghi           # complete multiple tasks
  clawdo done                       # complete all in-progress tasks

  # Agent interface (structured output)
  clawdo inbox                      # what needs attention?
  clawdo inbox --format json        # structured for scripts
  clawdo propose "New task idea" --level auto-notify
  clawdo next --auto --json         # get next auto task as JSON

  # Manage tasks
  clawdo show abc123                # show full task details
  clawdo show abc123 --json         # JSON output
  clawdo edit abc123 --urgency now
  clawdo archive abc,def            # archive multiple tasks
  clawdo note abc123 "Blocked on API access"

WORKFLOW EXAMPLES (for agents):
  # Agent proposes task, human confirms
  clawdo propose "Refactor auth module" --level auto
  clawdo confirm <id>
  
  # Agent picks next auto task
  clawdo next --auto --json
  clawdo start <id>
  clawdo done <id>
  
  # Bulk operations
  clawdo done <id1>,<id2>,<id3>
  clawdo archive --status done

AUTONOMY LEVELS:
  auto         10 min max, no notify  Small fixes, run tests, trivial tasks
  auto-notify  30 min max, notify     Research, refactor
  collab       unlimited, needs human Requires discussion

For full command details, run: clawdo <command> --help
`);

// Helper to normalize project/context tags (auto-prepend + or @)
function normalizeProject(project: string | undefined): string | undefined {
  if (!project) return undefined;
  return project.startsWith('+') ? project : `+${project}`;
}

function normalizeContext(context: string | undefined): string | undefined {
  if (!context) return undefined;
  return context.startsWith('@') ? context : `@${context}`;
}

// Add command (with inline parsing)
program
  .command('add')
  .description('Add a new task')
  .argument('<text>', 'Task text (supports inline metadata: +project @context auto/soon/etc)')
  .option('-l, --level <level>', 'Autonomy level (auto|auto-notify|collab)')
  .option('-u, --urgency <urgency>', 'Urgency (now|soon|whenever|someday)')
  .option('-p, --project <project>', 'Project tag (+ prefix optional)')
  .option('-c, --context <context>', 'Context tag (@ prefix optional)')
  .option('--due <date>', 'Due date (YYYY-MM-DD or tomorrow)')
  .option('--blocked-by <id>', 'Blocked by task ID')
  .option('--json', 'Output as JSON')
  .action((text, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();

      // Parse inline metadata
      const parsed = parseTaskText(text);

      // Flags override inline parsing, normalize project/context
      const finalText = parsed.cleanText;
      const autonomy = (options.level as AutonomyLevel) || parsed.autonomy || 'collab';
      const urgency = (options.urgency as Urgency) || parsed.urgency || 'whenever';
      const project = normalizeProject(options.project) || parsed.project;
      const context = normalizeContext(options.context) || parsed.context;
      const dueDate = options.due || parsed.dueDate;

      const id = db.createTask(finalText, 'human', {
        autonomy,
        urgency,
        project,
        context,
        dueDate,
        blockedBy: options.blockedBy,
      });

      console.log(renderSuccess(`Added: ${id}`, format, { id }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// List command
program
  .command('list')
  .alias('ls')
  .description('List tasks')
  .option('--project <project>', 'Filter by project')
  .option('--level <level>', 'Filter by autonomy level')
  .option('--urgency <urgency>', 'Filter by urgency')
  .option('--status <status>', 'Filter by status')
  .option('--blocked', 'Show only blocked tasks')
  .option('--ready', 'Show only ready (unblocked, actionable) tasks')
  .option('--all', 'Show all tasks including archived')
  .option('--added-by <actor>', 'Filter by who added (human|agent)')
  .option('--full', 'Show full task text without truncation')
  .option('--json', 'Output as JSON')
  .action((options) => {
    try {
      const db = getDb();
      const format: OutputFormat = options.json ? 'json' : 'text';

      const filters: any = {};
      if (options.project) filters.project = normalizeProject(options.project);
      if (options.level) filters.autonomy = options.level;
      if (options.urgency) filters.urgency = options.urgency;
      if (options.addedBy) filters.addedBy = options.addedBy;
      if (options.blocked) filters.blocked = true;
      if (options.ready) filters.ready = true;

      if (options.status) {
        // Validate status value
        const validStatuses: TaskStatus[] = ['proposed', 'todo', 'in_progress', 'done', 'archived'];
        if (!validStatuses.includes(options.status as TaskStatus)) {
          throw new Error(`Invalid status '${options.status}'. Must be one of: ${validStatuses.join(', ')}`);
        }
        filters.status = options.status;
      } else if (!options.all) {
        // Default: show active tasks
        filters.status = ['todo', 'in_progress', 'proposed'];
      }

      const tasks = db.listTasks(filters);
      console.log(renderTaskList(tasks, format, { compact: !options.full }));

      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, options.json ? 'json' : 'text'));
      process.exit(1);
    }
  });

// Next command
program
  .command('next')
  .description('Show next highest-priority task')
  .option('--auto', 'Show next auto-executable task')
  .option('--json', 'Output as JSON')
  .action((options) => {
    try {
      const db = getDb();
      const format: OutputFormat = options.json ? 'json' : 'text';
      const task = db.getNextTask({ auto: options.auto });

      console.log(renderTaskDetail(task, format));

      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, options.json ? 'json' : 'text'));
      process.exit(1);
    }
  });

// Show command - display full task details
program
  .command('show')
  .description('Show full task details')
  .argument('<id>', 'Task ID or prefix')
  .option('--json', 'Output as JSON')
  .action((idOrPrefix, options) => {
    try {
      const db = getDb();
      const format: OutputFormat = options.json ? 'json' : 'text';
      const id = resolveId(db, idOrPrefix);
      const task = db.getTask(id);

      console.log(renderTaskDetail(task, format));

      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, options.json ? 'json' : 'text'));
      process.exit(1);
    }
  });

// Start command
program
  .command('start')
  .description('Mark task as in progress')
  .argument('<id>', 'Task ID or prefix')
  .option('--json', 'Output as JSON')
  .action((idOrPrefix, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();
      const id = resolveId(db, idOrPrefix);
      db.startTask(id, 'human');
      console.log(renderSuccess(`Started: ${id}`, format, { id }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Done command
program
  .command('done')
  .description('Mark task(s) as completed')
  .argument('[ids]', 'Task ID(s) or prefix(es), comma-separated (e.g., abc,def,ghi) - completes all in-progress tasks if omitted')
  .option('--all', 'Mark all todo tasks as done')
  .option('--project <project>', 'Mark all tasks in project as done')
  .option('--json', 'Output as JSON')
  .action((ids, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();
      
      // Bulk operations
      if (options.all || options.project) {
        if (ids) {
          console.error(renderError(new Error('Cannot specify task ID with --all or --project'), format));
          process.exit(1);
        }
        
        const filters: any = { status: ['todo', 'in_progress'] };
        if (options.project) filters.project = normalizeProject(options.project);
        
        const tasks = db.listTasks(filters);
        if (tasks.length === 0) {
          console.log(renderSuccess('No tasks found matching criteria.', format, { count: 0 }));
          db.close();
          process.exit(0);
        }
        
        if (format !== 'json') {
          console.log(`About to mark ${tasks.length} task(s) as done:`);
          for (const task of tasks) {
            console.log(`  [${task.id}] ${task.text}`);
          }
        }
        
        // Confirmation prompt (auto-confirms in non-TTY / JSON mode)
        confirmAction('Continue?', (confirmed) => {
          if (confirmed) {
            const count = db.bulkComplete(filters, 'human');
            console.log(renderSuccess(`Marked ${count} task(s) as done.`, format, { count }));
          } else {
            console.log(format === 'json' ? JSON.stringify({ success: false, message: 'Cancelled' }) : 'Cancelled.');
          }
          db.close();
          process.exit(0);
        });
        return;
      }
      
      // No ID specified - complete all in-progress tasks
      if (!ids) {
        const filters = { status: ['in_progress'] as TaskStatus[] };
        const tasks = db.listTasks(filters);
        
        if (tasks.length === 0) {
          console.log(renderSuccess('No in-progress tasks to complete.', format, { count: 0 }));
          db.close();
          process.exit(0);
        }
        
        if (format !== 'json') {
          console.log(`About to mark ${tasks.length} in-progress task(s) as done:`);
          for (const task of tasks) {
            console.log(`  [${task.id}] ${task.text}`);
          }
        }
        
        confirmAction('Continue?', (confirmed) => {
          if (confirmed) {
            const count = db.bulkComplete(filters, 'human');
            console.log(renderSuccess(`Marked ${count} task(s) as done.`, format, { count }));
          } else {
            console.log(format === 'json' ? JSON.stringify({ success: false, message: 'Cancelled' }) : 'Cancelled.');
          }
          db.close();
          process.exit(0);
        });
        return;
      }
      
      // Multiple task operation (comma-separated IDs)
      const resolvedIds = resolveIds(db, ids);
      const completed: string[] = [];
      for (const resolvedId of resolvedIds) {
        db.completeTask(resolvedId, 'human');
        completed.push(resolvedId);
      }
      console.log(renderSuccess(`Completed: ${completed.join(', ')}`, format, { ids: completed, count: completed.length }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Edit command
program
  .command('edit')
  .description('Edit task metadata (Note: autonomy level cannot be changed after creation)')
  .argument('<id>', 'Task ID or prefix')
  .option('--text <text>', 'Update task text')
  .option('--urgency <urgency>', 'Update urgency')
  .option('--project <project>', 'Update project (+ prefix optional)')
  .option('--context <context>', 'Update context (@ prefix optional)')
  .option('--due <date>', 'Update due date')
  .option('--json', 'Output as JSON')
  .action((idOrPrefix, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();
      const id = resolveId(db, idOrPrefix);
      const updates: any = {};
      
      if (options.text !== undefined) updates.text = options.text;
      if (options.urgency) updates.urgency = options.urgency;
      if (options.project !== undefined) updates.project = normalizeProject(options.project);
      if (options.context !== undefined) updates.context = normalizeContext(options.context);
      if (options.due !== undefined) updates.dueDate = options.due;

      db.updateTask(id, updates, 'human');
      console.log(renderSuccess(`Updated: ${id}`, format, { id }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Archive command
program
  .command('archive')
  .description('Archive task(s)')
  .argument('[ids]', 'Task ID(s), comma-separated (e.g., abc,def) - optional if using --all or --status')
  .option('--all', 'Archive all non-active tasks')
  .option('--status <status>', 'Archive all tasks with status (e.g., done)')
  .option('--json', 'Output as JSON')
  .action((ids, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();
      
      // Bulk operations
      if (options.all || options.status) {
        if (ids) {
          console.error(renderError(new Error('Cannot specify task ID with --all or --status'), format));
          process.exit(1);
        }
        
        const filters: any = {};
        if (options.status) {
          filters.status = options.status;
        } else if (options.all) {
          filters.status = ['done', 'proposed'];
        }
        
        const tasks = db.listTasks(filters);
        if (tasks.length === 0) {
          console.log(renderSuccess('No tasks found matching criteria.', format, { count: 0 }));
          db.close();
          process.exit(0);
        }
        
        if (format !== 'json') {
          console.log(`About to archive ${tasks.length} task(s):`);
          for (const task of tasks.slice(0, 10)) {
            console.log(`  [${task.id}] ${task.text}`);
          }
          if (tasks.length > 10) {
            console.log(`  ... and ${tasks.length - 10} more`);
          }
        }
        
        confirmAction('Continue?', (confirmed) => {
          if (confirmed) {
            const count = db.bulkArchive(filters, 'human');
            console.log(renderSuccess(`Archived ${count} task(s).`, format, { count }));
          } else {
            console.log(format === 'json' ? JSON.stringify({ success: false, message: 'Cancelled' }) : 'Cancelled.');
          }
          db.close();
          process.exit(0);
        });
        return;
      }
      
      // Multiple task operation
      if (!ids) {
        console.error(renderError(new Error('Task ID required (or use --all/--status)'), format));
        process.exit(1);
      }
      
      const resolvedIds = resolveIds(db, ids);
      const archived: string[] = [];
      for (const resolvedId of resolvedIds) {
        db.archiveTask(resolvedId, 'human');
        archived.push(resolvedId);
      }
      console.log(renderSuccess(`Archived: ${archived.join(', ')}`, format, { ids: archived, count: archived.length }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Unarchive command
program
  .command('unarchive')
  .description('Unarchive a task')
  .argument('<id>', 'Task ID or prefix')
  .option('--json', 'Output as JSON')
  .action((idOrPrefix, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();
      const id = resolveId(db, idOrPrefix);
      db.unarchiveTask(id, 'human');
      console.log(renderSuccess(`Unarchived: ${id}`, format, { id }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Confirm command
program
  .command('confirm')
  .description('Confirm agent-proposed task')
  .argument('<id>', 'Task ID or prefix')
  .option('--json', 'Output as JSON')
  .action((idOrPrefix, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();
      const id = resolveId(db, idOrPrefix);
      db.confirmTask(id, 'human');
      console.log(renderSuccess(`Confirmed: ${id}`, format, { id }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Reject command
program
  .command('reject')
  .description('Reject agent-proposed task')
  .argument('<id>', 'Task ID or prefix')
  .option('--reason <text>', 'Reason for rejection')
  .option('--json', 'Output as JSON')
  .action((idOrPrefix, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();
      const id = resolveId(db, idOrPrefix);
      db.rejectTask(id, 'human', options.reason);
      console.log(renderSuccess(`Rejected: ${id}`, format, { id }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Block command - accepts both "clawdo block <id> <blocker>" and "clawdo block <id> by <blocker>"
program
  .command('block')
  .description('Block a task by another task')
  .argument('<id>', 'Task ID or prefix to block')
  .argument('<arg2>', 'Blocker ID or "by"')
  .argument('[blocker]', 'Blocker task ID (if arg2 was "by")')
  .option('--json', 'Output as JSON')
  .action((idOrPrefix, arg2, blockerArg, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();
      const id = resolveId(db, idOrPrefix);
      
      // Determine blocker ID based on syntax
      let blockerPrefix: string;
      if (arg2.toLowerCase() === 'by' && blockerArg) {
        // Syntax: block <id> by <blocker>
        blockerPrefix = blockerArg;
      } else if (!blockerArg) {
        // Syntax: block <id> <blocker>
        blockerPrefix = arg2;
      } else {
        throw new Error('Invalid syntax. Use: block <id> <blocker> OR block <id> by <blocker>');
      }
      
      const blocker = resolveId(db, blockerPrefix);
      db.blockTask(id, blocker, 'human');
      console.log(renderSuccess(`Blocked ${id} by ${blocker}`, format, { id, blockerId: blocker }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Unblock command
program
  .command('unblock')
  .description('Unblock a task')
  .argument('<id>', 'Task ID or prefix')
  .option('--json', 'Output as JSON')
  .action((idOrPrefix, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();
      const id = resolveId(db, idOrPrefix);
      db.unblockTask(id, 'human');
      console.log(renderSuccess(`Unblocked: ${id}`, format, { id }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Propose command (agent adds task)
program
  .command('propose')
  .description('Propose a task (agent interface)')
  .argument('<text>', 'Task text')
  .option('-l, --level <level>', 'Autonomy level', 'collab')
  .option('-u, --urgency <urgency>', 'Urgency', 'whenever')
  .option('-p, --project <project>', 'Project tag (+ prefix optional)')
  .option('--json', 'Output as JSON')
  .action((text, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();

      const id = db.createTask(text, 'agent', {
        autonomy: options.level,
        urgency: options.urgency,
        project: normalizeProject(options.project),
      });

      console.log(renderSuccess(`Proposed: ${id} (awaiting confirmation)`, format, { id, status: 'proposed' }));

      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Note command
program
  .command('note')
  .description('Add a note to a task')
  .argument('<id>', 'Task ID or prefix')
  .argument('<text>', 'Note text')
  .option('--json', 'Output as JSON')
  .action((idOrPrefix, text, options) => {
    const format: OutputFormat = options.json ? 'json' : 'text';
    try {
      const db = getDb();
      const id = resolveId(db, idOrPrefix);
      db.addNote(id, text, 'human');
      console.log(renderSuccess(`Note added to ${id}`, format, { id }));
      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, format));
      process.exit(1);
    }
  });

// Inbox command (agent interface)
program
  .command('inbox')
  .description('Show inbox for agent (structured JSON or markdown)')
  .option('--format <format>', 'Output format (json|markdown)', 'auto')
  .action((options) => {
    try {
      const db = getDb();
      const inbox = generateInbox(db);

      // Auto-detect format
      let format = options.format;
      if (format === 'auto') {
        format = process.stdout.isTTY ? 'markdown' : 'json';
      }

      if (format === 'json') {
        console.log(formatInboxJSON(inbox));
      } else {
        console.log(formatInboxMarkdown(inbox));
      }

      db.close();
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Stats command
program
  .command('stats')
  .description('Show task statistics')
  .option('--json', 'Output as JSON')
  .action((options) => {
    try {
      const db = getDb();
      const format: OutputFormat = options.json ? 'json' : 'text';
      const stats = db.getStats();

      console.log(renderStats(stats, format));

      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, options.json ? 'json' : 'text'));
      process.exit(1);
    }
  });

// History command
program
  .command('history')
  .description('Show task history')
  .argument('<id>', 'Task ID or prefix')
  .option('--json', 'Output as JSON')
  .action((idOrPrefix, options) => {
    try {
      const db = getDb();
      const format: OutputFormat = options.json ? 'json' : 'text';
      const id = resolveId(db, idOrPrefix);
      const history = db.getHistory(id);

      console.log(renderHistory(history, format));

      db.close();
      process.exit(0);
    } catch (error) {
      console.error(renderError(error, options.json ? 'json' : 'text'));
      process.exit(1);
    }
  });

program.parse();
