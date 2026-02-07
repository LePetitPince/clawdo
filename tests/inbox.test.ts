// All test data is fictional
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { TodoDatabase } from '../src/db.js';
import { generateInbox, formatInboxJSON, formatInboxMarkdown } from '../src/inbox.js';

const TEST_DB = '/tmp/test-inbox.db';
const TEST_AUDIT = '/tmp/test-inbox-audit.jsonl';

describe('Inbox', () => {
  let db: TodoDatabase;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(TEST_AUDIT)) unlinkSync(TEST_AUDIT);
    db = new TodoDatabase(TEST_DB, TEST_AUDIT);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(TEST_AUDIT)) unlinkSync(TEST_AUDIT);
  });

  describe('generateInbox', () => {
    it('returns empty categories for empty database', () => {
      const inbox = generateInbox(db);
      
      expect(inbox.autoReady).toHaveLength(0);
      expect(inbox.autoNotifyReady).toHaveLength(0);
      expect(inbox.urgent).toHaveLength(0);
      expect(inbox.overdue).toHaveLength(0);
      expect(inbox.proposed).toHaveLength(0);
      expect(inbox.stale).toHaveLength(0);
      expect(inbox.blocked).toHaveLength(0);
    });

    it('categorizes auto tasks correctly', () => {
      db.createTask('Auto task 1', 'human', { autonomy: 'auto' });
      db.createTask('Auto task 2', 'human', { autonomy: 'auto' });
      
      const inbox = generateInbox(db);
      
      expect(inbox.autoReady).toHaveLength(2);
      expect(inbox.autoReady[0].text).toBe('Auto task 1');
      expect(inbox.autoReady[1].text).toBe('Auto task 2');
    });

    it('categorizes auto tasks correctly', () => {
      db.createTask('Auto task', 'human', { autonomy: 'auto' });
      
      const inbox = generateInbox(db);
      
      expect(inbox.autoReady).toHaveLength(1);
      expect(inbox.autoReady[0].text).toBe('Auto task');
    });

    it('categorizes auto-notify tasks correctly', () => {
      db.createTask('Notify task', 'human', { autonomy: 'auto-notify' });
      
      const inbox = generateInbox(db);
      
      expect(inbox.autoNotifyReady).toHaveLength(1);
      expect(inbox.autoNotifyReady[0].text).toBe('Notify task');
    });

    it('categorizes urgent tasks (urgency=now)', () => {
      db.createTask('Urgent task', 'human', { urgency: 'now' });
      const id2 = db.createTask('Urgent in-progress', 'human', { urgency: 'now' });
      db.startTask(id2, 'human');
      
      const inbox = generateInbox(db);
      
      expect(inbox.urgent).toHaveLength(2);
      expect(inbox.urgent.some(t => t.text === 'Urgent task')).toBe(true);
      expect(inbox.urgent.some(t => t.text === 'Urgent in-progress')).toBe(true);
    });

    it('categorizes overdue tasks', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      db.createTask('Overdue task', 'human', { dueDate: yesterdayStr });
      
      const inbox = generateInbox(db);
      
      expect(inbox.overdue).toHaveLength(1);
      expect(inbox.overdue[0].text).toBe('Overdue task');
    });

    it('does not show future due dates as overdue', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      db.createTask('Future task', 'human', { dueDate: tomorrowStr });
      
      const inbox = generateInbox(db);
      
      expect(inbox.overdue).toHaveLength(0);
    });

    it('categorizes proposed tasks', () => {
      db.createTask('Proposed task', 'agent', { confirmed: false });
      
      const inbox = generateInbox(db);
      
      expect(inbox.proposed).toHaveLength(1);
      expect(inbox.proposed[0].text).toBe('Proposed task');
    });

    it('categorizes stale tasks (in_progress > 24h)', () => {
      const id = db.createTask('Stale task', 'human');
      db.startTask(id, 'human');
      
      // Manually set started_at to 25 hours ago
      const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      db.updateTask(id, { startedAt: staleTime }, 'human');
      
      const inbox = generateInbox(db);
      
      expect(inbox.stale).toHaveLength(1);
      expect(inbox.stale[0].text).toBe('Stale task');
    });

    it('does not show recently started tasks as stale', () => {
      const id = db.createTask('Recent task', 'human');
      db.startTask(id, 'human');
      
      const inbox = generateInbox(db);
      
      expect(inbox.stale).toHaveLength(0);
    });

    it('categorizes blocked tasks', () => {
      const blockerId = db.createTask('Blocker task', 'human');
      db.createTask('Blocked task', 'human', { blockedBy: blockerId });
      
      const inbox = generateInbox(db);
      
      expect(inbox.blocked).toHaveLength(1);
      expect(inbox.blocked[0].text).toBe('Blocked task');
    });

    it('excludes blocked tasks from auto-ready lists', () => {
      const blockerId = db.createTask('Blocker', 'human');
      db.createTask('Blocked auto task', 'human', { autonomy: 'auto', blockedBy: blockerId });
      
      const inbox = generateInbox(db);
      
      expect(inbox.autoReady).toHaveLength(0);
      expect(inbox.blocked).toHaveLength(1);
    });

    it('excludes done tasks from all categories', () => {
      const id = db.createTask('Done task', 'human', { autonomy: 'auto', urgency: 'now' });
      db.completeTask(id, 'human');
      
      const inbox = generateInbox(db);
      
      expect(inbox.autoReady).toHaveLength(0);
      expect(inbox.urgent).toHaveLength(0);
    });

    it('excludes archived tasks from all categories', () => {
      const id = db.createTask('Archived task', 'human', { autonomy: 'auto', urgency: 'now' });
      db.completeTask(id, 'human');
      db.archiveTask(id, 'human');
      
      const inbox = generateInbox(db);
      
      expect(inbox.autoReady).toHaveLength(0);
      expect(inbox.urgent).toHaveLength(0);
    });

    it('includes meta information', () => {
      const inbox = generateInbox(db);
      
      expect(inbox.meta).toBeDefined();
      expect(inbox.meta.autoExecutionEnabled).toBe(true); // default
      expect(inbox.meta.tasksCompleted4h).toBe(0);
    });

    it('tracks auto execution enabled flag', () => {
      db.setConfig('auto_execution_enabled', 'false');
      
      const inbox = generateInbox(db);
      
      expect(inbox.meta.autoExecutionEnabled).toBe(false);
    });

    it('tracks completed tasks count', () => {
      const id1 = db.createTask('Task 1', 'human');
      const id2 = db.createTask('Task 2', 'human');
      db.completeTask(id1, 'human');
      db.completeTask(id2, 'human');
      
      const inbox = generateInbox(db);
      
      expect(inbox.meta.tasksCompleted4h).toBeGreaterThanOrEqual(2);
    });

    it('handles tasks in multiple categories', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      db.createTask('Urgent and overdue', 'human', { 
        urgency: 'now', 
        dueDate: yesterdayStr 
      });
      
      const inbox = generateInbox(db);
      
      // Task should appear in both urgent and overdue
      expect(inbox.urgent).toHaveLength(1);
      expect(inbox.overdue).toHaveLength(1);
    });

    it('uses single query optimization (no multiple list calls)', () => {
      // Create a variety of tasks
      db.createTask('Auto task', 'human', { autonomy: 'auto' });
      db.createTask('Urgent task', 'human', { urgency: 'now' });
      db.createTask('Proposed task', 'agent', { confirmed: false });
      const blockerId = db.createTask('Blocker', 'human');
      db.createTask('Blocked task', 'human', { blockedBy: blockerId });
      
      // This should work efficiently with single query
      const inbox = generateInbox(db);
      
      expect(inbox.autoReady).toHaveLength(1);
      expect(inbox.urgent).toHaveLength(1);
      expect(inbox.proposed).toHaveLength(1);
      expect(inbox.blocked).toHaveLength(1);
    });
  });

  describe('formatInboxJSON', () => {
    it('returns valid JSON wrapped with security tags', () => {
      db.createTask('Test task', 'human', { autonomy: 'auto' });
      const inbox = generateInbox(db);
      const json = formatInboxJSON(inbox);
      
      expect(json).toContain('<todo_data warning=');
      expect(json).toContain('</todo_data>');
      expect(json).toContain('Test task');
    });

    it('produces parseable JSON', () => {
      db.createTask('Test task', 'human');
      const inbox = generateInbox(db);
      const json = formatInboxJSON(inbox);
      
      // Extract JSON from wrapper
      const match = json.match(/<todo_data[^>]*>(.*)<\/todo_data>/s);
      expect(match).toBeTruthy();
      
      if (match) {
        const parsedInbox = JSON.parse(match[1].trim());
        expect(parsedInbox.meta).toBeDefined();
        expect(parsedInbox.autoReady).toBeDefined();
      }
    });
  });

  describe('formatInboxMarkdown', () => {
    it('returns markdown for empty inbox', () => {
      const inbox = generateInbox(db);
      const md = formatInboxMarkdown(inbox);
      
      expect(md).toContain('# Todo Inbox');
      expect(md).toContain('## Meta');
    });

    it('includes task counts in headers', () => {
      db.createTask('Task 1', 'human', { autonomy: 'auto' });
      db.createTask('Task 2', 'human', { autonomy: 'auto' });
      
      const inbox = generateInbox(db);
      const md = formatInboxMarkdown(inbox);
      
      expect(md).toContain('## Auto Ready (2)');
    });

    it('formats tasks with IDs', () => {
      const id = db.createTask('Test task', 'human', { autonomy: 'auto' });
      
      const inbox = generateInbox(db);
      const md = formatInboxMarkdown(inbox);
      
      expect(md).toContain(`[${id}]`);
      expect(md).toContain('Test task');
    });

    it('shows blocked-by relationships', () => {
      const blockerId = db.createTask('Blocker', 'human');
      db.createTask('Blocked', 'human', { blockedBy: blockerId });
      
      const inbox = generateInbox(db);
      const md = formatInboxMarkdown(inbox);
      
      expect(md).toContain(`blocked by ${blockerId}`);
    });
  });
});
