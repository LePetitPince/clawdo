/**
 * Type definitions for the todo CLI
 */

export type TaskStatus = 'proposed' | 'todo' | 'in_progress' | 'done' | 'archived';
export type AutonomyLevel = 'auto' | 'auto-notify' | 'collab';
export type Urgency = 'now' | 'soon' | 'whenever' | 'someday';
export type AddedBy = 'human' | 'agent';

export interface Task {
  id: string;
  text: string;
  status: TaskStatus;
  autonomy: AutonomyLevel;
  urgency: Urgency;
  project: string | null;
  context: string | null;
  dueDate: string | null;
  blockedBy: string | null;
  addedBy: AddedBy;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  tokensUsed: number;
  durationSec: number;
}

export interface TaskHistory {
  id: number;
  taskId: string;
  action: string;
  actor: AddedBy;
  timestamp: string;
  notes: string | null;
  sessionId: string | null;
  sessionLogPath: string | null;
  oldValue: string | null;
  newValue: string | null;
  toolsUsed: string | null; // JSON array
}

export interface Config {
  key: string;
  value: string | null;
}

export interface InboxResult {
  meta: {
    autoExecutionEnabled: boolean;
    tasksCompleted4h: number;
  };
  autoReady: Task[];
  autoNotifyReady: Task[];
  urgent: Task[];
  overdue: Task[];
  proposed: Task[];
  stale: Task[];
  blocked: Task[];
}

export interface ParsedMetadata {
  project?: string;
  context?: string;
  autonomy?: AutonomyLevel;
  urgency?: Urgency;
  dueDate?: string;
  cleanText: string;
}
