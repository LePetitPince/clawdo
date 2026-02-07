/**
 * Stable error codes for programmatic error handling.
 * Agents should match on these codes, not error message strings.
 */
export type ErrorCode =
  | 'TASK_NOT_FOUND'
  | 'TASK_NOT_CONFIRMED'
  | 'TASK_BLOCKED'
  | 'TASK_ALREADY_DONE'
  | 'TASK_ALREADY_ARCHIVED'
  | 'TASK_ALREADY_IN_PROGRESS'
  | 'INVALID_STATUS_TRANSITION'
  | 'PERMISSION_DENIED'
  | 'TASK_IMMUTABLE'
  | 'BLOCKER_NOT_FOUND'
  | 'BLOCKER_ALREADY_DONE'
  | 'CIRCULAR_DEPENDENCY'
  | 'INVALID_PROJECT_FORMAT'
  | 'TEXT_TOO_LONG'
  | 'AMBIGUOUS_ID'
  | 'INVALID_URGENCY'
  | 'INVALID_AUTONOMY'
  | 'INVALID_STATUS'
  | 'RATE_LIMIT_EXCEEDED';

/**
 * ClawdoError - Error class with stable error codes for agent error handling.
 * 
 * @example
 * ```typescript
 * throw new ClawdoError(
 *   'TASK_NOT_FOUND',
 *   `Task not found: ${id}`,
 *   { id, suggestions: findSimilarIds(id) }
 * );
 * ```
 * 
 * @example Agent error handling
 * ```typescript
 * try {
 *   db.completeTask(id, 'agent');
 * } catch (err) {
 *   if (err.code === 'TASK_BLOCKED') {
 *     // Handle blocked task
 *   } else if (err.code === 'TASK_NOT_CONFIRMED') {
 *     // Prompt human to confirm
 *   }
 * }
 * ```
 */
export class ClawdoError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'ClawdoError';
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ClawdoError.prototype);
  }

  /**
   * Returns a JSON representation of the error for --json output.
   */
  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      context: this.context
    };
  }
}
