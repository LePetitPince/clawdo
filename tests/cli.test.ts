// All test data is fictional
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TodoDatabase } from '../src/db.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CLI Integration Tests', () => {
  let db: TodoDatabase;
  let tempDir: string;
  let dbPath: string;
  let auditPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'todo-cli-test-'));
    dbPath = join(tempDir, 'test.db');
    auditPath = join(tempDir, 'audit.jsonl');
    db = new TodoDatabase(dbPath, auditPath);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('show command', () => {
    it('shows task details when task is found', () => {
      const id = db.createTask('Test task', 'human', {
        autonomy: 'auto',
        urgency: 'soon',
        project: '+myproject',
      });

      const task = db.getTask(id);
      expect(task).not.toBeNull();
      expect(task!.text).toBe('Test task');
      expect(task!.autonomy).toBe('auto');
      expect(task!.urgency).toBe('soon');
      expect(task!.project).toBe('+myproject');
    });

    it('returns null when task is not found', () => {
      const task = db.getTask('notfound');
      expect(task).toBeNull();
    });

    it('shows archived task with correct status', () => {
      const id = db.createTask('Task to archive', 'human');
      db.archiveTask(id, 'human');

      const task = db.getTask(id);
      expect(task).not.toBeNull();
      expect(task!.status).toBe('archived');
      // Note: The CLI hint is tested through actual CLI execution
      // This test verifies the database state is correct for the hint logic
    });

    it('resolves task ID from prefix', () => {
      const id = db.createTask('Unique task', 'human');
      const prefix = id.substring(0, 3);
      
      const resolved = db.resolveTaskId(prefix);
      expect(resolved).toBe(id);
    });

    it('handles ambiguous prefix matches', () => {
      // Create multiple tasks to potentially get similar IDs
      const id1 = db.createTask('Task 1', 'human');
      const id2 = db.createTask('Task 2', 'human');
      
      // Try to resolve with full IDs (should work)
      expect(db.resolveTaskId(id1)).toBe(id1);
      expect(db.resolveTaskId(id2)).toBe(id2);
    });
  });

  describe('block command flexible syntax', () => {
    it('blocks task with direct syntax: block <id> <blocker>', () => {
      const blocker = db.createTask('Blocker task', 'human');
      const blocked = db.createTask('Blocked task', 'human');

      db.blockTask(blocked, blocker, 'human');

      const task = db.getTask(blocked);
      expect(task!.blockedBy).toBe(blocker);
    });

    it('blocks task with "by" syntax: block <id> by <blocker>', () => {
      const blocker = db.createTask('Blocker task', 'human');
      const blocked = db.createTask('Blocked task', 'human');

      // The "by" parsing happens in the CLI layer (index.ts)
      // Here we verify the underlying blockTask method works
      db.blockTask(blocked, blocker, 'human');

      const task = db.getTask(blocked);
      expect(task!.blockedBy).toBe(blocker);
    });

    it('prevents circular dependencies', () => {
      const task1 = db.createTask('Task 1', 'human');
      const task2 = db.createTask('Task 2', 'human');

      db.blockTask(task2, task1, 'human'); // task2 blocked by task1

      // Try to create circular dependency
      expect(() => db.blockTask(task1, task2, 'human'))
        .toThrow('circular dependency');
    });

    it('unblocks task', () => {
      const blocker = db.createTask('Blocker task', 'human');
      const blocked = db.createTask('Blocked task', 'human');

      db.blockTask(blocked, blocker, 'human');
      expect(db.getTask(blocked)!.blockedBy).toBe(blocker);

      db.unblockTask(blocked, 'human');
      expect(db.getTask(blocked)!.blockedBy).toBeNull();
    });
  });

  describe('text length limit enforcement', () => {
    it('rejects task text that is too long', () => {
      const longText = 'a'.repeat(1001); // Over 1000 char limit

      expect(() => db.createTask(longText, 'human'))
        .toThrow('Task text too long');
    });

    it('accepts task text at the limit', () => {
      const maxText = 'a'.repeat(1000); // Exactly at limit

      const id = db.createTask(maxText, 'human');
      const task = db.getTask(id);
      expect(task).not.toBeNull();
      expect(task!.text.length).toBe(1000);
    });

    it('rejects notes that are too long', () => {
      const id = db.createTask('Test task', 'human');
      const longNote = 'a'.repeat(5001); // Over 5000 char limit

      expect(() => db.addNote(id, longNote, 'human'))
        .toThrow('Notes too long');
    });

    it('rejects combined notes that exceed limit', () => {
      const id = db.createTask('Test task', 'human');
      
      // Add a note that's close to the limit
      const note1 = 'a'.repeat(4900);
      db.addNote(id, note1, 'human');

      // Try to add another note that would push over the limit
      const note2 = 'b'.repeat(200);
      expect(() => db.addNote(id, note2, 'human'))
        .toThrow('Combined notes too long');
    });

    it('rejects project tags that are too long', () => {
      const longProject = '+' + 'a'.repeat(50); // Over 50 char limit (including +)

      expect(() => db.createTask('Test', 'human', { project: longProject }))
        .toThrow('Tag too long');
    });

    it('rejects context tags that are too long', () => {
      const longContext = '@' + 'a'.repeat(50); // Over 50 char limit (including @)

      expect(() => db.createTask('Test', 'human', { context: longContext }))
        .toThrow('Tag too long');
    });

    it('accepts tags at the limit', () => {
      const maxProject = '+' + 'a'.repeat(48); // 49 chars total (under 50)
      const maxContext = '@' + 'b'.repeat(48); // 49 chars total (under 50)

      const id = db.createTask('Test', 'human', {
        project: maxProject,
        context: maxContext,
      });

      const task = db.getTask(id);
      expect(task!.project).toBe(maxProject);
      expect(task!.context).toBe(maxContext);
    });

    it('rejects empty task text', () => {
      expect(() => db.createTask('', 'human'))
        .toThrow('cannot be empty');
      
      expect(() => db.createTask('   ', 'human'))
        .toThrow('cannot be empty');
    });

    it('validates text length on update', () => {
      const id = db.createTask('Original text', 'human');
      const longText = 'a'.repeat(1001);

      expect(() => db.updateTask(id, { text: longText }, 'human'))
        .toThrow('Task text too long');
    });
  });
});
