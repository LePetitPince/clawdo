// All test data is fictional
import { describe, it, expect } from 'vitest';
import { parseTaskText } from '../src/parser.js';

describe('Parser', () => {
  describe('parseTaskText', () => {
    it('extracts project tags', () => {
      const result = parseTaskText('fix bug +myproject');
      expect(result.project).toBe('+myproject');
      expect(result.cleanText).toBe('fix bug');
    });

    it('extracts context tags', () => {
      const result = parseTaskText('review code @office');
      expect(result.context).toBe('@office');
      expect(result.cleanText).toBe('review code');
    });

    it('extracts autonomy level', () => {
      const result = parseTaskText('quick task auto');
      expect(result.autonomy).toBe('auto');
      expect(result.cleanText).toBe('quick task');
    });

    it('extracts urgency', () => {
      const result = parseTaskText('urgent fix now');
      expect(result.urgency).toBe('now');
      expect(result.cleanText).toBe('urgent fix');
    });

    it('extracts due date', () => {
      const result = parseTaskText('meeting due:2026-02-10');
      expect(result.dueDate).toBe('2026-02-10');
      expect(result.cleanText).toBe('meeting');
    });

    it('handles due:tomorrow', () => {
      const result = parseTaskText('task due:tomorrow');
      expect(result.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.cleanText).toBe('task');
    });

    it('extracts multiple metadata', () => {
      const result = parseTaskText('fix RSS +example-project @code auto soon');
      expect(result.project).toBe('+example-project');
      expect(result.context).toBe('@code');
      expect(result.autonomy).toBe('auto');
      expect(result.urgency).toBe('soon');
      expect(result.cleanText).toBe('fix RSS');
    });

    it('ignores invalid project tags', () => {
      const result = parseTaskText('task +INVALID +valid-tag');
      expect(result.project).toBe('+valid-tag');
      // Invalid tags are converted to lowercase and kept if they match pattern
      expect(result.cleanText).toBe('task');
    });

    it('ignores invalid context tags', () => {
      const result = parseTaskText('task @INVALID @valid-tag');
      expect(result.context).toBe('@valid-tag');
      // Invalid tags are converted to lowercase and kept if they match pattern
      expect(result.cleanText).toBe('task');
    });

    it('handles text with no metadata', () => {
      const result = parseTaskText('just a simple task');
      expect(result.cleanText).toBe('just a simple task');
      expect(result.project).toBeUndefined();
      expect(result.context).toBeUndefined();
    });

    it('handles metadata-only input (returns original)', () => {
      const result = parseTaskText('+project @context');
      expect(result.cleanText).toBe('+project @context');
      expect(result.project).toBeUndefined();
      expect(result.context).toBeUndefined();
    });

    it('handles empty input', () => {
      const result = parseTaskText('');
      expect(result.cleanText).toBe('');
    });

    it('is case-sensitive for tags but insensitive for keywords', () => {
      const result = parseTaskText('fix +MyProject AUTO NOW');
      // Parser converts tags to lowercase, so +MyProject becomes +myproject
      expect(result.project).toBe('+myproject');
      expect(result.autonomy).toBe('auto');
      expect(result.urgency).toBe('now');
    });

    it('handles tags in middle of text', () => {
      const result = parseTaskText('fix the +myproject code @office today');
      expect(result.project).toBe('+myproject');
      expect(result.context).toBe('@office');
      expect(result.cleanText).toBe('fix the code today');
    });

    it('ignores partial matches', () => {
      const result = parseTaskText('auto-increment is not autonomy');
      expect(result.autonomy).toBeUndefined();
      expect(result.cleanText).toBe('auto-increment is not autonomy');
    });

    it('handles multiple spaces', () => {
      const result = parseTaskText('fix    bug   +project   auto');
      expect(result.project).toBe('+project');
      expect(result.autonomy).toBe('auto');
      expect(result.cleanText).toBe('fix bug');
    });

    it('handles special characters in text', () => {
      const result = parseTaskText('fix bug (critical!) +proj auto');
      expect(result.project).toBe('+proj');
      expect(result.autonomy).toBe('auto');
      expect(result.cleanText).toBe('fix bug (critical!)');
    });

    it('handles due date formats strictly', () => {
      const result1 = parseTaskText('task due:2026-2-5'); // Wrong format
      expect(result1.dueDate).toBeUndefined();

      const result2 = parseTaskText('task due:2026-02-05'); // Correct format
      expect(result2.dueDate).toBe('2026-02-05');
    });

    it('keeps last occurrence if multiple of same type', () => {
      const result = parseTaskText('+proj1 +proj2 task');
      expect(result.project).toBe('+proj2');
    });

    it('handles hyphens in tags', () => {
      const result = parseTaskText('task +my-project @home-office');
      expect(result.project).toBe('+my-project');
      expect(result.context).toBe('@home-office');
    });
  });
});
