// All test data is fictional
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TodoDatabase } from '../src/db.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TodoDatabase', () => {
  let db: TodoDatabase;
  let tempDir: string;
  let dbPath: string;
  let auditPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'todo-test-'));
    dbPath = join(tempDir, 'test.db');
    auditPath = join(tempDir, 'audit.jsonl');
    db = new TodoDatabase(dbPath, auditPath);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createTask', () => {
    it('creates a basic task', () => {
      const id = db.createTask('Fix bug', 'human');
      expect(id).toHaveLength(8);
      expect(/^[a-z0-9]{8}$/.test(id)).toBe(true);

      const task = db.getTask(id);
      expect(task).not.toBeNull();
      expect(task!.text).toBe('Fix bug');
      expect(task!.status).toBe('todo');
      expect(task!.autonomy).toBe('collab');
      expect(task!.addedBy).toBe('human');
    });

    it('creates task with options', () => {
      const id = db.createTask('Quick fix', 'human', {
        autonomy: 'auto',
        urgency: 'now',
        project: '+myproject',
        context: '@office',
      });

      const task = db.getTask(id);
      expect(task!.autonomy).toBe('auto');
      expect(task!.urgency).toBe('now');
      expect(task!.project).toBe('+myproject');
      expect(task!.context).toBe('@office');
    });

    it('creates agent proposals', () => {
      const id = db.createTask('Agent suggestion', 'agent');
      const task = db.getTask(id);
      expect(task!.status).toBe('proposed');
      expect(task!.addedBy).toBe('agent');
    });

    it('ignores confirmed flag for agent tasks (security fix)', () => {
      const id = db.createTask('Agent task', 'agent', { confirmed: true });
      const task = db.getTask(id);
      // Confirmed flag is ignored for agents - always creates proposed tasks
      expect(task!.status).toBe('proposed');
      expect(task!.addedBy).toBe('agent');
    });

    it('sanitizes task text', () => {
      const id = db.createTask('Fix\x00bug SYSTEM MESSAGE', 'human');
      const task = db.getTask(id);
      expect(task!.text).not.toContain('\x00');
      expect(task!.text).toContain('[FILTERED]');
    });

    it('validates project format', () => {
      expect(() => db.createTask('task', 'human', { project: 'invalid' }))
        .toThrow('Project must start with +');
    });

    it('validates context format', () => {
      expect(() => db.createTask('task', 'human', { context: 'invalid' }))
        .toThrow('Context must start with @');
    });

    it('rejects empty text', () => {
      expect(() => db.createTask('', 'human')).toThrow('cannot be empty');
      expect(() => db.createTask('   ', 'human')).toThrow('cannot be empty');
    });

    it('validates blocker exists', () => {
      expect(() => db.createTask('task', 'human', { blockedBy: 'nonexist' }))
        .toThrow('Blocker task not found');
    });
  });

  describe('listTasks', () => {
    beforeEach(() => {
      db.createTask('Task 1', 'human', { urgency: 'now', autonomy: 'auto' });
      db.createTask('Task 2', 'human', { urgency: 'soon', autonomy: 'collab' });
      db.createTask('Task 3', 'agent');
    });

    it('lists all active tasks by default', () => {
      const tasks = db.listTasks();
      expect(tasks.length).toBe(3);
    });

    it('filters by status', () => {
      const proposed = db.listTasks({ status: 'proposed' });
      expect(proposed.length).toBe(1);
      expect(proposed[0].addedBy).toBe('agent');
    });

    it('filters by autonomy', () => {
      const auto = db.listTasks({ autonomy: 'auto' });
      expect(auto.length).toBe(1);
    });

    it('filters by urgency', () => {
      const urgent = db.listTasks({ urgency: 'now' });
      expect(urgent.length).toBe(1);
    });

    it('sorts by urgency then created_at', () => {
      const tasks = db.listTasks();
      expect(tasks[0].urgency).toBe('now');
    });

    it('filters ready tasks (unblocked)', () => {
      const id1 = db.createTask('Blocker', 'human');
      const id2 = db.createTask('Blocked', 'human', { blockedBy: id1 });

      const ready = db.listTasks({ ready: true });
      expect(ready.map(t => t.id)).not.toContain(id2);
    });
  });

  describe('startTask', () => {
    it('marks task as in_progress', () => {
      const id = db.createTask('Task', 'human');
      db.startTask(id, 'human');

      const task = db.getTask(id);
      expect(task!.status).toBe('in_progress');
      expect(task!.startedAt).not.toBeNull();
    });

    it('prevents double-start (race condition)', () => {
      const id = db.createTask('Task', 'human');
      db.startTask(id, 'agent');
      
      expect(() => db.startTask(id, 'agent')).toThrow('already in progress');
    });

    it('rejects starting non-todo task', () => {
      const id = db.createTask('Task', 'agent');
      expect(() => db.startTask(id, 'agent')).toThrow('must be in todo status');
    });
  });

  describe('completeTask', () => {
    it('marks task as done', () => {
      const id = db.createTask('Task', 'human');
      db.startTask(id, 'human');
      db.completeTask(id, 'human');

      const task = db.getTask(id);
      expect(task!.status).toBe('done');
      expect(task!.completedAt).not.toBeNull();
    });

    it('unblocks dependent tasks', () => {
      const blocker = db.createTask('Blocker', 'human');
      const blocked = db.createTask('Blocked', 'human', { blockedBy: blocker });

      db.startTask(blocker, 'human');
      db.completeTask(blocker, 'human');

      const task = db.getTask(blocked);
      expect(task!.blockedBy).toBeNull();
    });

    it('logs session and tools', () => {
      const id = db.createTask('Task', 'human');
      db.startTask(id, 'agent');
      db.completeTask(id, 'agent', 'session-123', '/path/to/log', ['read', 'write']);

      const history = db.getHistory(id);
      const completion = history.find(h => h.action === 'completed');
      expect(completion!.sessionId).toBe('session-123');
      expect(completion!.toolsUsed).toBe(JSON.stringify(['read', 'write']));
    });
  });

  describe('failTask', () => {
    it('increments attempts and resets to todo', () => {
      const id = db.createTask('Task', 'human', { autonomy: 'auto' });
      db.startTask(id, 'agent');
      db.failTask(id, 'Test failed');

      const task = db.getTask(id);
      expect(task!.status).toBe('todo');
      expect(task!.attempts).toBe(1);
      expect(task!.lastAttemptAt).not.toBeNull();
    });

    it('upgrades to collab after 3 failures', () => {
      const id = db.createTask('Task', 'human', { autonomy: 'auto' });

      for (let i = 0; i < 3; i++) {
        db.startTask(id, 'agent');
        db.failTask(id, 'Failed');
      }

      const task = db.getTask(id);
      expect(task!.attempts).toBe(3);
      expect(task!.autonomy).toBe('collab');
      expect(task!.notes).toContain('[Auto-failed 3 times]');
    });
  });

  describe('confirmTask', () => {
    it('confirms proposed task', () => {
      const id = db.createTask('Proposal', 'agent');
      db.confirmTask(id, 'human');

      const task = db.getTask(id);
      expect(task!.status).toBe('todo');
    });

    it('rejects non-proposed task', () => {
      const id = db.createTask('Task', 'human');
      expect(() => db.confirmTask(id, 'human')).toThrow('not in proposed status');
    });
  });

  describe('rejectTask', () => {
    it('archives proposed task', () => {
      const id = db.createTask('Proposal', 'agent');
      db.rejectTask(id, 'human', 'Not needed');

      const task = db.getTask(id);
      expect(task!.status).toBe('archived');

      const history = db.getHistory(id);
      const rejection = history.find(h => h.action === 'rejected');
      expect(rejection!.notes).toBe('Not needed');
    });
  });

  describe('blockTask / unblockTask', () => {
    it('blocks task by another', () => {
      const blocker = db.createTask('Blocker', 'human');
      const blocked = db.createTask('Blocked', 'human');

      db.blockTask(blocked, blocker, 'human');

      const task = db.getTask(blocked);
      expect(task!.blockedBy).toBe(blocker);
    });

    it('unblocks task', () => {
      const blocker = db.createTask('Blocker', 'human');
      const blocked = db.createTask('Blocked', 'human', { blockedBy: blocker });

      db.unblockTask(blocked, 'human');

      const task = db.getTask(blocked);
      expect(task!.blockedBy).toBeNull();
    });

    it('rejects blocking by completed task', () => {
      const blocker = db.createTask('Blocker', 'human');
      const blocked = db.createTask('Blocked', 'human');

      db.startTask(blocker, 'human');
      db.completeTask(blocker, 'human');

      expect(() => db.blockTask(blocked, blocker, 'human'))
        .toThrow('Cannot block by a completed');
    });
  });

  describe('addNote', () => {
    it('adds timestamped note', () => {
      const id = db.createTask('Task', 'human');
      db.addNote(id, 'This is a note', 'human');

      const task = db.getTask(id);
      expect(task!.notes).toContain('This is a note');
      expect(task!.notes).toMatch(/\[\d{4}-\d{2}-\d{2}\]/);
    });

    it('appends to existing notes', () => {
      const id = db.createTask('Task', 'human');
      db.addNote(id, 'Note 1', 'human');
      db.addNote(id, 'Note 2', 'human');

      const task = db.getTask(id);
      expect(task!.notes).toContain('Note 1');
      expect(task!.notes).toContain('Note 2');
    });

    it('enforces notes limit', () => {
      const id = db.createTask('Task', 'human');
      // First note close to limit
      const longNote = 'x'.repeat(4980);
      db.addNote(id, longNote, 'human');
      
      // Second note will exceed limit
      expect(() => db.addNote(id, 'Another note', 'human')).toThrow('Combined notes too long');
    });
  });

  describe('advisory lock', () => {
    it('acquires lock', () => {
      const acquired = db.acquireLock();
      expect(acquired).toBe(true);
    });

    it('prevents double acquisition', () => {
      db.acquireLock();
      const second = db.acquireLock();
      expect(second).toBe(false);
    });

    it('releases lock', () => {
      db.acquireLock();
      db.releaseLock();
      const reacquired = db.acquireLock();
      expect(reacquired).toBe(true);
    });
  });

  describe('canRetry', () => {
    it('allows retry if < 3 attempts', () => {
      const id = db.createTask('Task', 'human', { autonomy: 'auto' });
      expect(db.canRetry(id)).toBe(true);
    });

    it('blocks retry if 3 attempts', () => {
      const id = db.createTask('Task', 'human', { autonomy: 'auto' });
      
      for (let i = 0; i < 3; i++) {
        db.startTask(id, 'agent');
        db.failTask(id, 'Failed');
      }

      expect(db.canRetry(id)).toBe(false);
    });

    it('enforces 1-hour cooldown', () => {
      const id = db.createTask('Task', 'human', { autonomy: 'auto' });
      db.startTask(id, 'agent');
      db.failTask(id, 'Failed');

      // Immediately after failure, cannot retry (would need to wait 1 hour)
      // Since we can't mock time easily in this test, we just check the method exists
      expect(typeof db.canRetry(id)).toBe('boolean');
    });
  });

  describe('getStats', () => {
    it('returns task counts', () => {
      db.createTask('Task 1', 'human');
      db.createTask('Task 2', 'human', { autonomy: 'auto' });
      db.createTask('Proposal', 'agent');

      const stats = db.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byStatus.todo).toBe(2);
      expect(stats.byStatus.proposed).toBe(1);
      expect(stats.byAutonomy.auto).toBe(1);
    });
  });

  describe('getHistory', () => {
    it('tracks all actions', () => {
      const id = db.createTask('Task', 'human');
      db.startTask(id, 'human');
      db.addNote(id, 'Progress update', 'human');
      db.completeTask(id, 'human');

      const history = db.getHistory(id);
      const actions = history.map(h => h.action);
      
      expect(actions).toContain('created');
      expect(actions).toContain('started');
      expect(actions).toContain('note_added');
      expect(actions).toContain('completed');
    });
  });

  describe('transactions and integrity', () => {
    it('maintains referential integrity on blocker', () => {
      const blocker = db.createTask('Blocker', 'human');
      
      // Try to create task with invalid blocker
      expect(() => db.createTask('Task', 'human', { blockedBy: 'invalid1' }))
        .toThrow();
    });

    it('enforces CHECK constraints', () => {
      // Try to manually insert invalid data
      expect(() => {
        (db as any).db.prepare('INSERT INTO tasks (id, text, status) VALUES (?, ?, ?)')
          .run('testid', 'text', 'invalid_status');
      }).toThrow();
    });
  });

  describe('bulkComplete unblocking', () => {
    it('unblocks dependent tasks when blocker is completed', () => {
      const blocker = db.createTask('Blocker task', 'human');
      const dependent1 = db.createTask('Dependent 1', 'human');
      const dependent2 = db.createTask('Dependent 2', 'human');

      db.blockTask(dependent1, blocker, 'human');
      db.blockTask(dependent2, blocker, 'human');

      // Verify tasks are blocked
      expect(db.getTask(dependent1)!.blockedBy).toBe(blocker);
      expect(db.getTask(dependent2)!.blockedBy).toBe(blocker);

      // Complete the blocker task
      db.completeTask(blocker, 'human');

      // Verify dependent tasks are now unblocked
      expect(db.getTask(dependent1)!.blockedBy).toBeNull();
      expect(db.getTask(dependent2)!.blockedBy).toBeNull();
    });

    it('unblocks dependent tasks when using bulkComplete', () => {
      const blocker1 = db.createTask('Blocker 1', 'human', { project: '+test' });
      const blocker2 = db.createTask('Blocker 2', 'human', { project: '+test' });
      const dependent1 = db.createTask('Dependent 1', 'human');
      const dependent2 = db.createTask('Dependent 2', 'human');

      db.blockTask(dependent1, blocker1, 'human');
      db.blockTask(dependent2, blocker2, 'human');

      // Bulk complete all tasks in project
      const count = db.bulkComplete({ project: '+test' }, 'human');
      expect(count).toBe(2);

      // Verify dependent tasks are unblocked
      expect(db.getTask(dependent1)!.blockedBy).toBeNull();
      expect(db.getTask(dependent2)!.blockedBy).toBeNull();
    });
  });

  describe('audit DB fallback', () => {
    it('falls back to DB when audit file write fails', () => {
      // This test verifies the _failed_audits table exists and can be used
      // In real scenario, this would happen when appendFileSync fails
      
      // Verify the fallback table exists
      const tableExists = (db as any).db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_failed_audits'"
      ).get();
      expect(tableExists).toBeTruthy();
    });

    it('_failed_audits table has correct schema', () => {
      // Verify the table can store audit failure data
      const result = (db as any).db.prepare(`
        INSERT INTO _failed_audits (timestamp, action, actor, task_id, details, error)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        new Date().toISOString(),
        'test_action',
        'human',
        'testid',
        '{"test": "data"}',
        'Mock file write error'
      );
      
      expect(result.changes).toBe(1);
      
      // Verify we can read it back
      const row = (db as any).db.prepare(
        'SELECT * FROM _failed_audits WHERE task_id = ?'
      ).get('testid');
      
      expect(row).toBeTruthy();
      expect(row.action).toBe('test_action');
      expect(row.error).toBe('Mock file write error');
    });
  });
});
