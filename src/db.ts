import Database from 'better-sqlite3';
import { existsSync, mkdirSync, chmodSync, appendFileSync } from 'fs';
import { appendFile } from 'fs/promises';
import { dirname } from 'path';
import type { Task, TaskHistory, AddedBy, TaskStatus, AutonomyLevel, Urgency } from './types.js';
import { sanitizeText, sanitizeNotes, sanitizeTag, validateTaskId, generateTaskId, LIMITS } from './sanitize.js';
import { ClawdoError } from './errors.js';

// DB row type interfaces for type safety
interface TaskRow {
  id: string;
  text: string;
  status: TaskStatus;
  autonomy: AutonomyLevel;
  urgency: Urgency;
  project: string | null;
  context: string | null;
  due_date: string | null;
  blocked_by: string | null;
  added_by: AddedBy;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  attempts: number;
  last_attempt_at: string | null;
  tokens_used: number;
  duration_sec: number;
}

interface TaskHistoryRow {
  id: number;
  task_id: string;
  action: string;
  actor: AddedBy;
  timestamp: string;
  notes: string | null;
  session_id: string | null;
  session_log_path: string | null;
  old_value: string | null;
  new_value: string | null;
  tools_used: string | null;
}

interface CountRow {
  count: number;
}

interface ValueRow {
  value: string | null;
}

interface StatusCountRow {
  status: TaskStatus;
  count: number;
}

interface AutonomyCountRow {
  autonomy: AutonomyLevel;
  count: number;
}

// Helper to wrap SQLite constraint errors with ClawdoError
function wrapSQLiteError(error: any): Error {
  const message = error.message || '';
  
  // Check constraint failed errors
  if (message.includes('CHECK constraint failed')) {
    if (message.includes('urgency IN')) {
      return new ClawdoError('INVALID_URGENCY', 'Invalid urgency. Must be one of: now, soon, whenever, someday');
    }
    if (message.includes('autonomy IN')) {
      return new ClawdoError('INVALID_AUTONOMY', 'Invalid autonomy level. Must be one of: auto, auto-notify, collab');
    }
    if (message.includes('status IN')) {
      return new ClawdoError('INVALID_STATUS', 'Invalid status. Must be one of: proposed, todo, in_progress, done, archived');
    }
    if (message.includes('added_by IN')) {
      return new Error('Invalid added_by. Must be one of: human, agent');
    }
  }
  
  // UNIQUE constraint failed
  if (message.includes('UNIQUE constraint failed')) {
    if (message.includes('tasks.id')) {
      return new Error('Task ID already exists');
    }
  }
  
  // FOREIGN KEY constraint failed
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new ClawdoError('BLOCKER_NOT_FOUND', 'Referenced task does not exist');
  }
  
  // Default: return original error
  return error;
}

export class TodoDatabase {
  private db: Database.Database;
  private auditPath: string;
  private auditQueue: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly AUDIT_BATCH_SIZE = 50;
  private readonly AUDIT_BATCH_MS = 100;

  constructor(dbPath: string, auditPath: string) {
    // Ensure directory exists with secure permissions
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    this.db = new Database(dbPath);
    this.auditPath = auditPath;

    // Enable WAL mode
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    // Set file permissions (owner only)
    try {
      chmodSync(dbPath, 0o600);
    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        console.warn('Warning: Database permission setup failed');
      } else {
        console.warn(`Warning: Could not set database file permissions: ${error}`);
      }
    }

    // Ensure audit log exists with secure permissions
    if (!existsSync(auditPath)) {
      appendFileSync(auditPath, '', { mode: 0o600 });
    }

    this.migrate();
  }

  private migrate(): void {
    // Create config table first
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // Check schema version
    const versionRow = this.db.prepare('SELECT value FROM config WHERE key = ?').get('schema_version') as ValueRow | undefined;
    const currentVersion = versionRow?.value ? parseInt(versionRow.value, 10) : 0;

    if (currentVersion < 1) {
      this.migrateV1();
      this.db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('schema_version', '1');
    }
  }

  private migrateV1(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY CHECK(length(id) = 8 AND id GLOB '[a-z0-9]*'),
        text TEXT NOT NULL CHECK(length(trim(text)) > 0 AND length(text) <= 1000),
        status TEXT DEFAULT 'todo' CHECK(status IN ('proposed','todo','in_progress','done','archived')),
        autonomy TEXT DEFAULT 'collab' CHECK(autonomy IN ('auto','auto-notify','collab')),
        urgency TEXT DEFAULT 'whenever' CHECK(urgency IN ('now','soon','whenever','someday')),
        project TEXT CHECK(project IS NULL OR (project GLOB '+[a-z0-9-]*' AND length(project) <= 50)),
        context TEXT CHECK(context IS NULL OR (context GLOB '@[a-z0-9-]*' AND length(context) <= 50)),
        due_date TEXT,
        blocked_by TEXT REFERENCES tasks(id),
        added_by TEXT DEFAULT 'human' CHECK(added_by IN ('human','agent')),
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        notes TEXT CHECK(notes IS NULL OR length(notes) <= 5000),
        attempts INTEGER DEFAULT 0,
        last_attempt_at TEXT,
        tokens_used INTEGER DEFAULT 0,
        duration_sec INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_autonomy ON tasks(autonomy);
      CREATE INDEX IF NOT EXISTS idx_urgency ON tasks(urgency);
      CREATE INDEX IF NOT EXISTS idx_project ON tasks(project);
      CREATE INDEX IF NOT EXISTS idx_blocked_by ON tasks(blocked_by);

      CREATE TABLE IF NOT EXISTS task_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        action TEXT NOT NULL,
        actor TEXT NOT NULL CHECK(actor IN ('human','agent')),
        timestamp TEXT NOT NULL,
        notes TEXT,
        session_id TEXT,
        session_log_path TEXT,
        old_value TEXT,
        new_value TEXT,
        tools_used TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_history_task ON task_history(task_id);
      CREATE INDEX IF NOT EXISTS idx_history_timestamp ON task_history(timestamp);

      -- Fallback table for failed audit writes
      CREATE TABLE IF NOT EXISTS _failed_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        task_id TEXT NOT NULL,
        details TEXT,
        error TEXT
      );

      INSERT OR IGNORE INTO config (key, value) VALUES ('heartbeat_lock', NULL);
      INSERT OR IGNORE INTO config (key, value) VALUES ('auto_execution_enabled', 'true');
    `);
  }

  // Audit log helper - batched async writes to prevent I/O blocking
  private audit(action: string, actor: AddedBy, taskId: string, details: any = {}): void {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      action,
      actor,
      taskId,
      ...details
    };
    
    // Add to queue
    this.auditQueue.push(JSON.stringify(entry) + '\n');
    
    // Flush immediately if batch size reached
    if (this.auditQueue.length >= this.AUDIT_BATCH_SIZE) {
      this.flushAudit();
      return;
    }
    
    // Otherwise schedule delayed flush
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushAudit();
      }, this.AUDIT_BATCH_MS);
    }
  }

  // Flush audit queue to disk (async, non-blocking)
  private flushAudit(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    if (this.auditQueue.length === 0) return;
    
    const batch = this.auditQueue.splice(0); // Drain queue
    const batchText = batch.join('');
    
    // Async write (non-blocking)
    appendFile(this.auditPath, batchText, { flag: 'a' }).catch((error) => {
      // Production: generic message, Dev: detailed error
      if (process.env.NODE_ENV === 'production') {
        console.warn('Warning: Audit log write failed');
      } else {
        console.warn(`Warning: Could not write to audit log: ${error}`);
      }
      
      // Fallback: store in database
      for (const line of batch) {
        try {
          const entry = JSON.parse(line);
          this.db.prepare(`
            INSERT INTO _failed_audits (timestamp, action, actor, task_id, details, error)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            entry.timestamp,
            entry.action,
            entry.actor,
            entry.taskId,
            JSON.stringify(entry),
            String(error)
          );
        } catch (dbError) {
          if (process.env.NODE_ENV !== 'production') {
            console.error(`CRITICAL: Could not write to audit fallback: ${dbError}`);
          }
        }
      }
    });
  }

  // Create task
  createTask(
    text: string,
    addedBy: AddedBy,
    options: {
      autonomy?: AutonomyLevel;
      urgency?: Urgency;
      project?: string | null;
      context?: string | null;
      dueDate?: string | null;
      blockedBy?: string | null;
      confirmed?: boolean;
    } = {}
  ): string {
    // Sanitize inputs (will throw if validation fails)
    const cleanText = sanitizeText(text);
    const cleanProject = sanitizeTag(options.project);
    const cleanContext = sanitizeTag(options.context);

    // Validate project/context format if provided
    if (cleanProject && !/^\+[a-z0-9-]+$/.test(cleanProject)) {
      throw new ClawdoError('INVALID_PROJECT_FORMAT', 'Project must start with + and contain only lowercase letters, numbers, and hyphens', { project: cleanProject });
    }
    if (cleanContext && !/^@[a-z0-9-]+$/.test(cleanContext)) {
      throw new ClawdoError('INVALID_PROJECT_FORMAT', 'Context must start with @ and contain only lowercase letters, numbers, and hyphens', { context: cleanContext });
    }

    // Validate due date format if provided
    if (options.dueDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.dueDate)) {
        throw new ClawdoError('INVALID_STATUS', 'Due date must be in YYYY-MM-DD format', { dueDate: options.dueDate });
      }
      // Verify it's a valid date
      const date = new Date(options.dueDate);
      if (isNaN(date.getTime())) {
        throw new ClawdoError('INVALID_STATUS', 'Due date is not a valid date', { dueDate: options.dueDate });
      }
    }

    // Generate unique ID first (needed for cycle detection)
    let id = generateTaskId();
    while (this.getTask(id)) {
      id = generateTaskId();
    }

    // Validate blocker exists and check for cycles if provided
    if (options.blockedBy) {
      if (!validateTaskId(options.blockedBy)) {
        throw new ClawdoError('BLOCKER_NOT_FOUND', 'Invalid blocker task ID format', { blockerId: options.blockedBy });
      }
      const blocker = this.getTask(options.blockedBy);
      if (!blocker) {
        throw new ClawdoError('BLOCKER_NOT_FOUND', `Blocker task not found: ${options.blockedBy}`, { blockerId: options.blockedBy });
      }
      
      // Check for circular dependency
      if (this.detectBlockerCycle(id, options.blockedBy)) {
        throw new ClawdoError('CIRCULAR_DEPENDENCY', 'Cannot block: would create circular dependency', { taskId: id, blockerId: options.blockedBy });
      }
    }

    // Rate limiting for agent proposals (DB-level enforcement)
    if (addedBy === 'agent') {
      const proposedCount = this.countProposed();
      if (proposedCount >= 5) {
        throw new ClawdoError('RATE_LIMIT_EXCEEDED', 
          'Too many proposed tasks (max 5 active). Confirm or reject existing proposals first.', 
          { proposedCount, limit: 5 });
      }
      
      // Enforce cooldown between agent proposals (60 seconds)
      const lastProposal = this.getConfig('last_agent_proposal');
      if (lastProposal) {
        const cooldownMs = 60000; // 60 seconds
        const elapsed = Date.now() - parseInt(lastProposal, 10);
        if (elapsed < cooldownMs) {
          throw new ClawdoError('RATE_LIMIT_EXCEEDED', 
            `Agent must wait ${Math.ceil((cooldownMs - elapsed) / 1000)}s between proposals`, 
            { cooldownSec: Math.ceil((cooldownMs - elapsed) / 1000) });
        }
      }
      this.setConfig('last_agent_proposal', Date.now().toString());
    }

    // Determine initial status
    // Agents always create proposed tasks (confirmed flag ignored for security)
    // Humans always create todo tasks
    const status: TaskStatus = (addedBy === 'agent') ? 'proposed' : 'todo';

    const now = new Date().toISOString();
    
    try {
      this.db.prepare(`
        INSERT INTO tasks (
          id, text, status, autonomy, urgency, project, context, due_date, 
          blocked_by, added_by, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        cleanText,
        status,
        options.autonomy || 'collab',
        options.urgency || 'whenever',
        cleanProject,
        cleanContext,
        options.dueDate || null,
        options.blockedBy || null,
        addedBy,
        now
      );
    } catch (error) {
      throw wrapSQLiteError(error);
    }

    // Log to history
    this.addHistory({
      taskId: id,
      action: 'created',
      actor: addedBy,
      timestamp: now,
      notes: status === 'proposed' ? 'Agent proposed task' : null,
    });

    // Audit log
    this.audit('create', addedBy, id, { text: cleanText, status, autonomy: options.autonomy || 'collab' });

    return id;
  }

  // Get task by ID
  getTask(id: string): Task | null {
    if (!validateTaskId(id)) return null;
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) return null;
    return this.rowToTask(row);
  }

  // Find tasks by ID prefix
  findTasksByPrefix(prefix: string): Task[] {
    if (!prefix || prefix.length === 0) return [];
    if (!/^[a-z0-9]+$/.test(prefix)) return [];
    
    const rows = this.db.prepare('SELECT * FROM tasks WHERE id LIKE ?').all(`${prefix}%`) as TaskRow[];
    return rows.map(row => this.rowToTask(row));
  }

  // Resolve task ID from prefix (returns full ID if unambiguous, null otherwise)
  resolveTaskId(idOrPrefix: string): string | null {
    // Guard against overly long prefixes (task IDs are exactly 8 chars)
    if (idOrPrefix.length > 8) {
      return null;
    }

    // If it's already a full ID, return it
    if (validateTaskId(idOrPrefix)) {
      return this.getTask(idOrPrefix) ? idOrPrefix : null;
    }
    
    // Try prefix matching
    const matches = this.findTasksByPrefix(idOrPrefix);
    
    if (matches.length === 0) {
      return null;
    }
    
    if (matches.length === 1) {
      return matches[0].id;
    }
    
    // Multiple matches - ambiguous
    throw new ClawdoError('AMBIGUOUS_ID', `Multiple tasks match '${idOrPrefix}'`, { 
      prefix: idOrPrefix, 
      matches: matches.map(t => t.id) 
    });
  }

  // Detect circular blocker dependency
  private detectBlockerCycle(taskId: string, blockerId: string): boolean {
    const visited = new Set<string>();
    let current: string | null = blockerId;
    
    while (current) {
      if (current === taskId) return true; // Cycle detected!
      if (visited.has(current)) return false; // Different cycle, not our problem
      visited.add(current);
      
      const task = this.getTask(current);
      current = task?.blockedBy || null;
    }
    
    return false;
  }

  // List tasks with filters
  listTasks(filters: {
    status?: TaskStatus | TaskStatus[];
    autonomy?: AutonomyLevel;
    urgency?: Urgency;
    project?: string;
    addedBy?: AddedBy;
    blocked?: boolean;
    ready?: boolean;
  } = {}): Task[] {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query += ` AND status IN (${filters.status.map(() => '?').join(',')})`;
        params.push(...filters.status);
      } else {
        query += ' AND status = ?';
        params.push(filters.status);
      }
    }

    if (filters.autonomy) {
      query += ' AND autonomy = ?';
      params.push(filters.autonomy);
    }

    if (filters.urgency) {
      query += ' AND urgency = ?';
      params.push(filters.urgency);
    }

    if (filters.project) {
      query += ' AND project = ?';
      params.push(filters.project);
    }

    if (filters.addedBy) {
      query += ' AND added_by = ?';
      params.push(filters.addedBy);
    }

    if (filters.blocked === true) {
      query += ' AND blocked_by IS NOT NULL';
    } else if (filters.blocked === false) {
      query += ' AND blocked_by IS NULL';
    }

    if (filters.ready) {
      query += ' AND status IN (?, ?) AND blocked_by IS NULL';
      params.push('todo', 'in_progress');
    }

    // Sort by urgency, then created_at
    query += ' ORDER BY CASE urgency WHEN \'now\' THEN 0 WHEN \'soon\' THEN 1 WHEN \'whenever\' THEN 2 WHEN \'someday\' THEN 3 END, created_at ASC';

    const rows = this.db.prepare(query).all(...params) as TaskRow[];
    return rows.map(this.rowToTask);
  }

  // Get next task (highest priority ready task)
  getNextTask(options: { auto?: boolean } = {}): Task | null {
    let query = 'SELECT * FROM tasks WHERE status = ? AND blocked_by IS NULL';
    const params: any[] = ['todo'];

    if (options.auto) {
      query += ' AND autonomy IN (?, ?)';
      params.push('auto', 'auto-notify');
    }

    query += ' ORDER BY CASE urgency WHEN \'now\' THEN 0 WHEN \'soon\' THEN 1 WHEN \'whenever\' THEN 2 WHEN \'someday\' THEN 3 END, created_at ASC LIMIT 1';

    const row = this.db.prepare(query).get(...params) as TaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  // Update task
  updateTask(id: string, updates: Partial<Task>, actor: AddedBy): void {
    if (!validateTaskId(id)) {
      throw new ClawdoError('TASK_NOT_FOUND', 'Invalid task ID format', { id });
    }

    const existing = this.getTask(id);
    if (!existing) {
      throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    }

    // Autonomy level changes are not allowed via edit - security gate
    // This prevents agents from escalating their own autonomy
    if (updates.autonomy !== undefined) {
      throw new ClawdoError('PERMISSION_DENIED', 'Autonomy level cannot be changed after task creation. This prevents agents from escalating their own permissions.', { 
        taskId: id, 
        currentAutonomy: existing.autonomy 
      });
    }

    const allowedFields = ['text', 'status', 'urgency', 'project', 'context', 'due_date', 'blocked_by', 'notes', 'started_at', 'completed_at'];
    const setClauses: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!allowedFields.includes(snakeKey)) continue;

      // Sanitize value based on field (will throw if validation fails)
      let cleanValue: any = value;
      if (key === 'text' && typeof value === 'string') {
        cleanValue = sanitizeText(value);
      } else if (key === 'notes') {
        cleanValue = sanitizeNotes(value as string);
      } else if (key === 'project' || key === 'context') {
        cleanValue = sanitizeTag(value as string);
      }

      setClauses.push(`${snakeKey} = ?`);
      params.push(cleanValue);
    }

    if (setClauses.length === 0) return;

    params.push(id);
    try {
      this.db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw wrapSQLiteError(error);
    }

    // Log to history
    const now = new Date().toISOString();
    this.addHistory({
      taskId: id,
      action: 'updated',
      actor,
      timestamp: now,
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(this.getTask(id)),
    });

    // Audit log
    this.audit('update', actor, id, { updates });
  }

  // Start task (marks in_progress)
  startTask(id: string, actor: AddedBy): void {
    const task = this.getTask(id);
    if (!task) {
      throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    }

    if (task.status === 'in_progress') {
      throw new ClawdoError('TASK_ALREADY_IN_PROGRESS', `Task already in progress: ${id}`, { id, status: task.status });
    }

    if (task.status !== 'todo') {
      throw new ClawdoError('INVALID_STATUS_TRANSITION', `Task must be in todo status to start (current: ${task.status})`, { id, status: task.status });
    }

    // Cannot start blocked tasks
    if (task.blockedBy) {
      const blocker = this.getTask(task.blockedBy);
      if (blocker && blocker.status !== 'done' && blocker.status !== 'archived') {
        throw new ClawdoError('TASK_BLOCKED', `Task is blocked by ${task.blockedBy}. Complete blocker first.`, { id, blockerId: task.blockedBy });
      }
    }

    const now = new Date().toISOString();
    this.db.prepare('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?').run('in_progress', now, id);

    this.addHistory({
      taskId: id,
      action: 'started',
      actor,
      timestamp: now,
    });

    this.audit('start', actor, id);
  }

  // Complete task (marks done)
  completeTask(id: string, actor: AddedBy, sessionId?: string, sessionLogPath?: string, toolsUsed?: string[]): void {
    const task = this.getTask(id);
    if (!task) {
      throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    }

    // Cannot complete proposed tasks - must be confirmed first
    if (task.status === 'proposed') {
      throw new ClawdoError('TASK_NOT_CONFIRMED', 
        `Task is proposed and must be confirmed first.\n  Run: clawdo confirm ${id}`, 
        { id, status: task.status });
    }

    // Cannot complete already done tasks
    if (task.status === 'done') {
      throw new ClawdoError('TASK_ALREADY_DONE', `Task already completed: ${id}`, { id });
    }

    // Cannot complete blocked tasks
    if (task.blockedBy) {
      const blocker = this.getTask(task.blockedBy);
      if (blocker && blocker.status !== 'done' && blocker.status !== 'archived') {
        throw new ClawdoError('TASK_BLOCKED', `Task is blocked by ${task.blockedBy}. Complete blocker first.`, { id, blockerId: task.blockedBy });
      }
    }

    const now = new Date().toISOString();
    
    // Atomic transaction for all DB operations
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?').run('done', now, id);

      this.addHistory({
        taskId: id,
        action: 'completed',
        actor,
        timestamp: now,
        sessionId,
        sessionLogPath,
        toolsUsed: toolsUsed ? JSON.stringify(toolsUsed) : null,
      });

      // Unblock any tasks that were waiting on this one
      this.db.prepare('UPDATE tasks SET blocked_by = NULL WHERE blocked_by = ?').run(id);
    });
    
    transaction(); // Execute atomically
    
    // Audit AFTER successful commit (can fail safely)
    this.audit('complete', actor, id, { sessionId, toolsUsed });
  }

  // Fail task attempt
  failTask(id: string, reason: string): void {
    const task = this.getTask(id);
    if (!task) {
      throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    }

    const now = new Date().toISOString();
    const newAttempts = task.attempts + 1;

    // Reset to todo for retry, unless max attempts reached
    if (newAttempts >= 3) {
      // Upgrade to collab after 3 failures
      this.db.prepare('UPDATE tasks SET status = ?, autonomy = ?, attempts = ?, last_attempt_at = ?, notes = ? WHERE id = ?')
        .run('todo', 'collab', newAttempts, now, `[Auto-failed 3 times] ${task.notes || ''}`.substring(0, LIMITS.notes), id);
    } else {
      this.db.prepare('UPDATE tasks SET status = ?, attempts = ?, last_attempt_at = ? WHERE id = ?')
        .run('todo', newAttempts, now, id);
    }

    this.addHistory({
      taskId: id,
      action: 'failed',
      actor: 'agent',
      timestamp: now,
      notes: reason,
    });

    this.audit('fail', 'agent', id, { reason, attempts: newAttempts });
  }

  // Archive task
  archiveTask(id: string, actor: AddedBy): void {
    const task = this.getTask(id);
    if (!task) {
      throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    }

    if (task.status === 'archived') {
      throw new ClawdoError('TASK_ALREADY_ARCHIVED', `Task already archived: ${id}`, { id });
    }

    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('archived', id);

    const now = new Date().toISOString();
    this.addHistory({
      taskId: id,
      action: 'archived',
      actor,
      timestamp: now,
    });

    this.audit('archive', actor, id);
  }

  // Unarchive task
  unarchiveTask(id: string, actor: AddedBy): void {
    const task = this.getTask(id);
    if (!task) {
      throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    }

    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('todo', id);

    const now = new Date().toISOString();
    this.addHistory({
      taskId: id,
      action: 'unarchived',
      actor,
      timestamp: now,
    });

    this.audit('unarchive', actor, id);
  }

  // Bulk complete tasks matching filters
  bulkComplete(filters: {
    status?: TaskStatus | TaskStatus[];
    project?: string;
    autonomy?: AutonomyLevel;
    urgency?: Urgency;
  }, actor: AddedBy): number {
    const tasks = this.listTasks(filters);
    const now = new Date().toISOString();
    
    let count = 0;
    
    // Atomic transaction for all bulk operations
    const transaction = this.db.transaction(() => {
      for (const task of tasks) {
        if (task.status === 'todo' || task.status === 'in_progress') {
          this.db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?').run('done', now, task.id);
          this.addHistory({
            taskId: task.id,
            action: 'bulk_completed',
            actor,
            timestamp: now,
          });
          
          // Unblock any tasks that were waiting on this one
          this.db.prepare('UPDATE tasks SET blocked_by = NULL WHERE blocked_by = ?').run(task.id);
          
          count++;
        }
      }
    });
    
    transaction(); // Execute atomically
    
    if (count > 0) {
      this.audit('bulk_complete', actor, 'multiple', { count, filters });
    }
    
    return count;
  }

  // Bulk archive tasks matching filters
  bulkArchive(filters: {
    status?: TaskStatus | TaskStatus[];
    project?: string;
    autonomy?: AutonomyLevel;
    urgency?: Urgency;
  }, actor: AddedBy): number {
    const tasks = this.listTasks(filters);
    const now = new Date().toISOString();
    
    let count = 0;
    
    // Atomic transaction for all bulk operations
    const transaction = this.db.transaction(() => {
      for (const task of tasks) {
        if (task.status !== 'archived') {
          this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('archived', task.id);
          this.addHistory({
            taskId: task.id,
            action: 'bulk_archived',
            actor,
            timestamp: now,
          });
          count++;
        }
      }
    });
    
    transaction(); // Execute atomically
    
    if (count > 0) {
      this.audit('bulk_archive', actor, 'multiple', { count, filters });
    }
    
    return count;
  }

  // Confirm proposed task
  confirmTask(id: string, actor: AddedBy): void {
    const task = this.getTask(id);
    if (!task) {
      throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    }

    if (task.status !== 'proposed') {
      throw new ClawdoError('INVALID_STATUS_TRANSITION', `Task is not in proposed status: ${id}`, { id, status: task.status });
    }

    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('todo', id);

    const now = new Date().toISOString();
    this.addHistory({
      taskId: id,
      action: 'confirmed',
      actor,
      timestamp: now,
    });

    this.audit('confirm', actor, id);
  }

  // Reject proposed task
  rejectTask(id: string, actor: AddedBy, reason?: string): void {
    const task = this.getTask(id);
    if (!task) {
      throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    }

    if (task.status !== 'proposed') {
      throw new ClawdoError('INVALID_STATUS_TRANSITION', `Task is not in proposed status: ${id}`, { id, status: task.status });
    }

    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('archived', id);

    const now = new Date().toISOString();
    this.addHistory({
      taskId: id,
      action: 'rejected',
      actor,
      timestamp: now,
      notes: reason || null,
    });

    this.audit('reject', actor, id, { reason });
  }

  // Block task
  blockTask(id: string, blockerId: string, actor: AddedBy): void {
    if (!validateTaskId(id) || !validateTaskId(blockerId)) {
      throw new ClawdoError('TASK_NOT_FOUND', 'Invalid task ID format', { id, blockerId });
    }

    const task = this.getTask(id);
    const blocker = this.getTask(blockerId);

    if (!task) throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    if (!blocker) throw new ClawdoError('BLOCKER_NOT_FOUND', `Blocker task not found: ${blockerId}`, { blockerId });

    if (blocker.status === 'done' || blocker.status === 'archived') {
      throw new ClawdoError('BLOCKER_ALREADY_DONE', 'Cannot block by a completed or archived task', { blockerId, status: blocker.status });
    }

    // Check for circular dependency
    if (this.detectBlockerCycle(id, blockerId)) {
      throw new ClawdoError('CIRCULAR_DEPENDENCY', 'Cannot block: would create circular dependency', { taskId: id, blockerId });
    }

    this.db.prepare('UPDATE tasks SET blocked_by = ? WHERE id = ?').run(blockerId, id);

    const now = new Date().toISOString();
    this.addHistory({
      taskId: id,
      action: 'blocked',
      actor,
      timestamp: now,
      notes: `Blocked by ${blockerId}`,
    });

    this.audit('block', actor, id, { blockerId });
  }

  // Unblock task
  unblockTask(id: string, actor: AddedBy): void {
    const task = this.getTask(id);
    if (!task) {
      throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    }

    this.db.prepare('UPDATE tasks SET blocked_by = NULL WHERE id = ?').run(id);

    const now = new Date().toISOString();
    this.addHistory({
      taskId: id,
      action: 'unblocked',
      actor,
      timestamp: now,
    });

    this.audit('unblock', actor, id);
  }

  // Add note to task
  addNote(id: string, note: string, actor: AddedBy): void {
    const task = this.getTask(id);
    if (!task) {
      throw new ClawdoError('TASK_NOT_FOUND', `Task not found: ${id}`, { id });
    }

    // Sanitize the new note (will throw if too long)
    const cleanNote = sanitizeNotes(note);
    const now = new Date().toISOString();
    const dateStamp = now.split('T')[0];
    const newNote = `[${dateStamp}] ${cleanNote}`;
    const updatedNotes = task.notes ? `${task.notes}\n${newNote}` : newNote;

    // Check combined length
    if (updatedNotes.length > LIMITS.notes) {
      throw new ClawdoError('TEXT_TOO_LONG', `Combined notes too long: ${updatedNotes.length} chars (max ${LIMITS.notes})`, { length: updatedNotes.length, max: LIMITS.notes });
    }

    this.db.prepare('UPDATE tasks SET notes = ? WHERE id = ?').run(updatedNotes, id);

    this.addHistory({
      taskId: id,
      action: 'note_added',
      actor,
      timestamp: now,
      notes: cleanNote,
    });

    this.audit('note', actor, id, { note: cleanNote });
  }

  // Get task history
  getHistory(id: string): TaskHistory[] {
    const rows = this.db.prepare('SELECT * FROM task_history WHERE task_id = ? ORDER BY timestamp DESC').all(id) as TaskHistoryRow[];
    return rows.map(row => ({
      id: row.id,
      taskId: row.task_id,
      action: row.action,
      actor: row.actor,
      timestamp: row.timestamp,
      notes: row.notes,
      sessionId: row.session_id,
      sessionLogPath: row.session_log_path,
      oldValue: row.old_value,
      newValue: row.new_value,
      toolsUsed: row.tools_used,
    }));
  }

  // Add history entry
  private addHistory(entry: {
    taskId: string;
    action: string;
    actor: AddedBy;
    timestamp: string;
    notes?: string | null;
    sessionId?: string | null;
    sessionLogPath?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
    toolsUsed?: string | null;
  }): void {
    this.db.prepare(`
      INSERT INTO task_history (task_id, action, actor, timestamp, notes, session_id, session_log_path, old_value, new_value, tools_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.taskId,
      entry.action,
      entry.actor,
      entry.timestamp,
      entry.notes || null,
      entry.sessionId || null,
      entry.sessionLogPath || null,
      entry.oldValue || null,
      entry.newValue || null,
      entry.toolsUsed || null
    );
  }

  // Config methods
  getConfig(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as ValueRow | undefined;
    return row ? row.value : null;
  }

  setConfig(key: string, value: string | null): void {
    this.db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
  }

  // Advisory lock for heartbeat
  acquireLock(lockId: string = 'heartbeat_lock'): boolean {
    const result = this.db.prepare('UPDATE config SET value = ? WHERE key = ? AND value IS NULL')
      .run(new Date().toISOString(), lockId);
    return result.changes > 0;
  }

  releaseLock(lockId: string = 'heartbeat_lock'): void {
    this.db.prepare('UPDATE config SET value = NULL WHERE key = ?').run(lockId);
  }

  // Check if task can be retried (< 3 attempts, 1hr cooldown)
  // Returns true if retry is allowed AND atomically marks the task for retry
  canRetry(id: string): boolean {
    if (!validateTaskId(id)) return false;
    
    // Atomic check and update - prevents race condition
    const result = this.db.prepare(`
      UPDATE tasks 
      SET status = 'in_progress'
      WHERE id = ?
        AND status = 'todo'
        AND attempts < 3
        AND (last_attempt_at IS NULL OR last_attempt_at < datetime('now', '-1 hour'))
    `).run(id);
    
    return result.changes > 0;
  }

  // Count proposed tasks (for limits)
  countProposed(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM tasks WHERE status = ? AND added_by = ?')
      .get('proposed', 'agent') as CountRow | undefined;
    return row ? row.count : 0;
  }

  // Count tasks completed in last N hours
  countCompletedInLast(hours: number): number {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const row = this.db.prepare('SELECT COUNT(*) as count FROM task_history WHERE action = ? AND timestamp > ?')
      .get('completed', since) as CountRow | undefined;
    return row ? row.count : 0;
  }

  // Get stats
  getStats(): {
    total: number;
    byStatus: Record<TaskStatus, number>;
    byAutonomy: Record<AutonomyLevel, number>;
  } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM tasks').get() as CountRow;
    const byStatus = this.db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all() as StatusCountRow[];
    const byAutonomy = this.db.prepare('SELECT autonomy, COUNT(*) as count FROM tasks WHERE status IN (?, ?) GROUP BY autonomy')
      .all('todo', 'in_progress') as AutonomyCountRow[];

    return {
      total: total.count,
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.count])) as Record<TaskStatus, number>,
      byAutonomy: Object.fromEntries(byAutonomy.map(r => [r.autonomy, r.count])) as Record<AutonomyLevel, number>,
    };
  }

  // Helper to convert DB row to Task object
  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      text: row.text,
      status: row.status,
      autonomy: row.autonomy,
      urgency: row.urgency,
      project: row.project,
      context: row.context,
      dueDate: row.due_date,
      blockedBy: row.blocked_by,
      addedBy: row.added_by,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      notes: row.notes,
      attempts: row.attempts,
      lastAttemptAt: row.last_attempt_at,
      tokensUsed: row.tokens_used,
      durationSec: row.duration_sec,
    };
  }

  close(): void {
    // Flush any pending audit entries synchronously before closing
    // (CLI exits immediately, so we need sync flush here)
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    if (this.auditQueue.length > 0) {
      const batch = this.auditQueue.splice(0);
      const batchText = batch.join('');
      
      try {
        appendFileSync(this.auditPath, batchText, { flag: 'a' });
      } catch (error) {
        // Fallback to DB on error
        for (const line of batch) {
          try {
            const entry = JSON.parse(line);
            this.db.prepare(`
              INSERT INTO _failed_audits (timestamp, action, actor, task_id, details, error)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              entry.timestamp,
              entry.action,
              entry.actor,
              entry.taskId,
              JSON.stringify(entry),
              String(error)
            );
          } catch {
            // Silent fail on close
          }
        }
      }
    }
    
    this.db.close();
  }
}
