/**
 * Parse inline metadata from task text
 * Examples:
 *   "fix RSS +rss4molties @code" -> project: +rss4molties, context: @code
 *   "quick fix auto" -> autonomy: auto
 *   "urgent task now" -> urgency: now
 *   "meeting due:2026-02-10" -> dueDate: 2026-02-10
 */

import type { ParsedMetadata, AutonomyLevel, Urgency } from './types.js';

const AUTONOMY_KEYWORDS: AutonomyLevel[] = ['auto-notify', 'auto', 'collab'];
const URGENCY_KEYWORDS: Urgency[] = ['now', 'soon', 'whenever', 'someday'];

export function parseTaskText(text: string): ParsedMetadata {
  const result: ParsedMetadata = {
    cleanText: text,
  };

  // Split into words
  const words = text.split(/\s+/);
  const cleanWords: string[] = [];

  for (const word of words) {
    let matched = false;

    // Check for project (+word)
    if (word.startsWith('+') && word.length > 1) {
      const project = word.toLowerCase();
      if (/^\+[a-z0-9-]+$/.test(project)) {
        result.project = project;
        matched = true;
      }
    }

    // Check for context (@word)
    else if (word.startsWith('@') && word.length > 1) {
      const context = word.toLowerCase();
      if (/^@[a-z0-9-]+$/.test(context)) {
        result.context = context;
        matched = true;
      }
    }

    // Check for due date (due:YYYY-MM-DD or due:tomorrow)
    else if (word.toLowerCase().startsWith('due:')) {
      const datePart = word.substring(4);
      if (datePart === 'tomorrow') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        result.dueDate = tomorrow.toISOString().split('T')[0];
        matched = true;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        result.dueDate = datePart;
        matched = true;
      }
    }

    // Check for autonomy level
    else if (AUTONOMY_KEYWORDS.includes(word.toLowerCase() as AutonomyLevel)) {
      result.autonomy = word.toLowerCase() as AutonomyLevel;
      matched = true;
    }

    // Check for urgency
    else if (URGENCY_KEYWORDS.includes(word.toLowerCase() as Urgency)) {
      result.urgency = word.toLowerCase() as Urgency;
      matched = true;
    }

    // If not matched, keep in clean text
    if (!matched) {
      cleanWords.push(word);
    }
  }

  // Rebuild clean text without metadata tags
  result.cleanText = cleanWords.join(' ').trim();

  // If we extracted everything and cleanText is empty, use original
  if (result.cleanText.length === 0) {
    result.cleanText = text;
    // Clear all extracted metadata since it's ambiguous
    delete result.project;
    delete result.context;
    delete result.autonomy;
    delete result.urgency;
    delete result.dueDate;
  }

  return result;
}
