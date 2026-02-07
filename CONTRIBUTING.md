# Contributing to clawdo 🦞

Thanks for contributing! This guide covers setup, testing, and code standards.

## Quick Start

### Development Setup

```bash
# Fork on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/clawdo.git
cd clawdo

# Add upstream remote
git remote add upstream https://github.com/LePetitPince/clawdo.git

# Install dependencies
npm install

# Build and test
npm run build
npm test
```

**Requirements:** Node.js ≥18

### Testing Locally

```bash
# Build the project
npm run build

# Link for local testing
npm link

# Now 'clawdo' is available globally
clawdo add "test task"

# Unlink when done
npm unlink -g clawdo
```

Or run directly: `node dist/index.js <command>`

---

## Project Structure

```
clawdo/
├── src/              # TypeScript source
│   ├── index.ts      # CLI entry (commander.js)
│   ├── db.ts         # SQLite database (better-sqlite3)
│   ├── sanitize.ts   # Security: prompt injection defense
│   ├── parser.ts     # Inline metadata parsing
│   ├── inbox.ts      # Agent-facing structured output
│   ├── render.ts     # Output formatting (text/JSON)
│   ├── errors.ts     # Error codes & types
│   └── types.ts      # TypeScript interfaces
├── tests/            # Test files (vitest)
└── dist/             # Compiled JavaScript (git-ignored)
```

**Key concepts:**
- **Security-first:** All user input is sanitized (prompt injection defense)
- **SQLite backend:** Simple, portable, WAL mode for concurrency
- **Inline metadata:** `+project @context !priority #tags` parsed from text
- **Agent-friendly:** `--json` output on all read commands

---

## Development Workflow

### Branch Naming

- `feat/recurring-tasks` — new features
- `fix/race-condition` — bug fixes
- `docs/improve-readme` — documentation
- `test/parser-coverage` — test additions

### Commit Messages

Use conventional commits:

```
feat: add recurring task support
fix: prevent race condition in db writes
docs: clarify autonomy level examples
test: add parser edge case coverage
```

**Format:** `type: description` (lowercase, no period)

### Pull Request Checklist

Before submitting:

- [ ] Tests pass locally (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Added tests for new functionality
- [ ] Updated documentation if needed
- [ ] Followed code style guidelines
- [ ] No security issues introduced

---

## Testing

```bash
npm test              # Run all tests (195 tests in 7 files)
npm run test:watch    # Watch mode for development
```

**Test structure:**
- `tests/db.test.ts` — Database operations
- `tests/sanitize.test.ts` — Input sanitization
- `tests/pentest.test.ts` — Security & injection attacks
- `tests/security.test.ts` — Integration security tests
- `tests/parser.test.ts` — Metadata parsing
- `tests/inbox.test.ts` — Agent inbox logic
- `tests/cli.test.ts` — CLI integration tests

**Writing tests:**
- Security tests go in `pentest.test.ts`
- Use in-memory database: `new TodoDatabase(':memory:')`
- CLI tests use temp directories
- All test data must be fictional

**Coverage:** We use vitest for testing. Aim for 80%+ coverage on new code.

---

## Code Style

### TypeScript Standards

- **Strict mode** — no `any` types (use `unknown` + type guards)
- **Functional style** — prefer pure functions, avoid mutation
- **Explicit types** — don't rely on inference for public APIs
- **Comments for "why"** not "what" — code should be self-documenting

### Security Guidelines

**Critical rules:**

1. **Sanitize all user input** — use `sanitizeText()` from `sanitize.ts`
2. **No command injection** — never pass user input to `exec()` without validation
3. **No SQL injection** — use prepared statements (better-sqlite3 handles this)
4. **Path traversal protection** — validate file paths before use
5. **Immutable constraints** — autonomy levels cannot be changed after creation

### Code Examples

**Good:**

```typescript
// Clear function with explicit types
function sanitizeTaskText(input: string): string {
  return stripControlChars(stripInjectionPatterns(input));
}

// Prepared statements (safe)
const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
```

**Bad:**

```typescript
// Unsafe: user input in SQL (even though better-sqlite3 escapes)
const task = db.prepare(`SELECT * FROM tasks WHERE id = '${taskId}'`).get();

// Unclear: what does this do?
function process(x: any) { ... }
```

---

## Documentation

Update docs when you:

- Add new commands → update `README.md` and `skill/SKILL.md`
- Change CLI behavior → update `--help` text in `src/index.ts`
- Add security features → update `SECURITY_AUDIT_REPORT.md`
- Fix bugs → add entry to `CHANGELOG.md`
- Change API → update `README.md` examples

**Documentation locations:**
- `README.md` — User-facing documentation
- `skill/SKILL.md` — ClawHub skill manifest
- `CONTRIBUTING.md` — This file
- `CHANGELOG.md` — Version history

---

## Security

### Reporting Vulnerabilities

**Use GitHub Security Advisories:**  
https://github.com/LePetitPince/clawdo/security/advisories/new

For private/sensitive reports: lepetitpince@proton.me

**Do not** open public issues for security vulnerabilities.

### Security Considerations for Contributors

When reviewing or writing code, watch for:

- **Prompt injection** — can user input manipulate LLM behavior?
- **Command injection** — does user input reach shell commands?
- **Path traversal** — can user input escape intended directories?
- **Autonomy escalation** — can agents bypass permission boundaries?
- **Rate limit bypass** — can agents create unlimited proposals?

**Test security changes** with `tests/pentest.test.ts` and `tests/security.test.ts`.

---

## Submitting Changes

1. **Fork and create a branch** from `master`
2. **Make your changes** with clear commits
3. **Write tests** for new functionality
4. **Run tests** (`npm test`) and **build** (`npm run build`)
5. **Push to your fork** and open a Pull Request
6. **Describe your changes** — link issues, explain rationale

### PR Guidelines

- **Keep it focused** — one feature/fix per PR
- **Small is better** — easier to review 100 lines than 1000
- **Write clear descriptions** — what, why, how
- **Respond to feedback** — reviews are collaborative

---

## Getting Help

- **Issues:** https://github.com/LePetitPince/clawdo/issues
- **Discussions:** https://github.com/LePetitPince/clawdo/discussions
- **Email:** lepetitpince@proton.me

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
