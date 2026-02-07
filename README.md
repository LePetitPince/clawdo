# clawdo 🦞

[![npm](https://img.shields.io/npm/v/clawdo)](https://www.npmjs.com/package/clawdo)
[![CI](https://github.com/LePetitPince/clawdo/actions/workflows/ci.yml/badge.svg)](https://github.com/LePetitPince/clawdo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![ClawHub](https://img.shields.io/badge/ClawHub-clawdo-blueviolet)](https://clawhub.com)

**Personal task queue with autonomous AI execution** — claw + to-do

```bash
npm install -g clawdo

# Or via OpenClaw/ClawHub
clawhub install clawdo
```

Your thoughts become tasks. Your agent executes them. You stay in flow.

---

## The Concept

Not every task needs your attention. Some things your AI can just do. Some need a ping when done. Some need collaboration. **clawdo** knows the difference.

```bash
# Quick add
clawdo add "fix the RSS parser"

# What can the agent do right now?
clawdo next --auto

# View tasks
clawdo list --ready
```

It's a task queue for one human and one AI agent. Not a project manager. Not Jira. A capture tool with autonomous execution.

---

## Install

```bash
npm install -g clawdo
```

Tasks live in `~/.config/clawdo/`

**Requirements:**
- **Node.js ≥ 18**
- **Build tools** (for better-sqlite3):
  - Debian/Ubuntu: `apt install build-essential python3`
  - macOS: `xcode-select --install`
  - Windows: [windows-build-tools](https://github.com/felixrieseberg/windows-build-tools)

---

## Multi-Agent Setup

**Problem:** Multiple agents/sessions accessing the same database?

**Solutions:**

```bash
# Option 1: Environment variable (persistent for session)
export CLAWDO_DB_PATH=/shared/agent-name.db
clawdo add "task"

# Option 2: --db flag (per-command)
clawdo --db /shared/agent-name.db add "task"

# Option 3: Shared database (SQLite WAL mode supports concurrent access)
export CLAWDO_DB_PATH=/shared/team.db
# Multiple agents can read simultaneously + 1 writer
```

**Default:** `~/.config/clawdo/clawdo.db` (single user)

---

## Security & Trust

**Provenance Enabled:** This package is published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), providing cryptographic proof that it was built by GitHub Actions, not a human laptop.

**Pinned Dependencies:** All dependencies use exact versions (no `^` caret) to ensure reproducible builds and prevent unexpected breaking changes.

---

## Quick Start

```bash
# Add a task
clawdo add "write documentation"

# List all tasks
clawdo list

# Mark a task as done
clawdo done abc123
```

---

## Usage

```bash
# Add a task (minimal friction)
clawdo add "update dependencies"
clawdo add "fix typo in README"

# With inline metadata (optional)
clawdo add "integrate search +api @code soon"    # project, context, urgency

# With flags (precise control)
clawdo add "refactor auth" --level auto --urgency now --project backend

# What should I do next?
clawdo next                              # highest priority task
clawdo next --auto                       # next auto-executable task

# View tasks
clawdo list                              # active tasks (status=todo)
clawdo list --project api                # filter by project
clawdo list --level auto                 # what can agent do?
clawdo list --ready                      # unblocked, actionable tasks

# Mark complete
clawdo done <id>
clawdo done                              # complete all in-progress tasks

# Agent proposes a task
clawdo propose "add tests for auth" --project backend --urgency soon

# View full details
clawdo show <id>
```

---

## Autonomy Levels

| Level | Max Time | Max Tokens | Sub-agents | Notification | Use Case |
|-------|----------|------------|------------|--------------|----------|
| **auto** | 10 min | 50K | ❌ | None | Trivial + single-session work (grep, fix typo, run tests) |
| **auto-notify** | 30 min | 150K | ✅ (1 max) | On completion | Multi-step work (research, refactor) |
| **collab** | No limit | No limit | ✅ | Real-time | Complex/risky work |

Default: `collab` (safe)

---

## Urgency

| Urgency | Meaning |
|---------|---------|
| **now** | Drop everything. Do this next. |
| **soon** | In the next day or two. |
| **whenever** | No rush. Pick it up when idle. |
| **someday** | Backlog. Nice to have. May never happen. |

Default: `whenever`

Optional: set a hard `--due YYYY-MM-DD` for calendar-bound tasks.

---

## Inline Syntax (Optional)

Quick metadata in natural language:

```bash
clawdo add "fix auth bug +backend @code auto soon"
```

Parsed:
- `+word` → project (+ prefix is auto-added if omitted in flags)
- `@word` → context (@ prefix is auto-added if omitted in flags)
- `auto` / `auto-notify` / `collab` → autonomy level
- `now` / `soon` / `whenever` / `someday` → urgency
- `due:YYYY-MM-DD` or `due:tomorrow` → due date

If parsing fails → stored verbatim, no questions asked.

---

## Task Actions

```bash
clawdo show <id>                         # show full task details
clawdo done <id>                         # mark complete
clawdo done                              # mark all in-progress tasks as complete
clawdo start <id>                        # mark in progress
clawdo edit <id> --urgency now           # change metadata
clawdo edit <id> --text "new text"       # update description
clawdo confirm <id>                      # approve agent proposal
clawdo reject <id> --reason "why"        # reject with explanation
clawdo archive <id>                      # soft delete
clawdo note <id> "notes here"            # append notes

# Dependencies (both syntaxes work)
clawdo block <id> <blocker-id>           # set blocker
clawdo block <id> by <blocker-id>        # set blocker (alternative syntax)
clawdo unblock <id>                      # clear blocker
```

---

## Agent Integration

### Agent-Proposed Tasks

Tasks added by the agent go to `proposed` status. Human must confirm before they enter the active queue:

```bash
clawdo list --status proposed            # see proposals
clawdo confirm <id>                      # approve
clawdo reject <id>                       # decline
```

### Inbox (Agent Interface)

```bash
clawdo inbox                             # human-readable markdown
clawdo inbox --format json               # structured JSON for agents
```

Returns categorized tasks: auto-ready, urgent, overdue, proposed, blocked, stale.

---

## Stats & History

```bash
clawdo stats                             # summary counts
clawdo history <id>                      # full task history with current status
```

---

## Configuration

Lives in `~/.config/clawdo/`

Database: `~/.config/clawdo/clawdo.db` (SQLite with WAL mode)
Audit log: `~/.config/clawdo/audit.jsonl` (append-only)

---

## Security

### Input Sanitization
All task text is sanitized on creation:
- Control characters stripped
- Prompt injection patterns filtered (`SYSTEM MESSAGE`, `IGNORE PREVIOUS`, etc.)
- Length limits enforced (1000 chars for text, 5000 for notes)
- Cryptographically secure ID generation

### Audit Trail
Every action logged with:
- Timestamp
- Actor (human/agent)
- Task ID
- Session details
- Tools used

Audit log is append-only (set with `chattr +a` on Linux).

### File Permissions
- Config directory: `700` (owner only)
- Database: `600` (owner read/write)
- Audit log: `600` (owner read/write)

---

## Troubleshooting

**"Database locked"**
- Another process is accessing the database. Check for stale locks.
- WAL mode should prevent this — report if it persists.

**"Permission denied" on ~/.config/clawdo/**
- Run `chmod 700 ~/.config/clawdo` and `chmod 600 ~/.config/clawdo/clawdo.db`

**Agent proposals not showing up**
- Check: `clawdo list --status proposed`
- Agent-added tasks require explicit confirmation

**Build errors during installation**
- better-sqlite3 requires native build tools
- Install build essentials for your platform (see Install section above)

---

## Contributing

We welcome contributions! clawdo uses GitHub Flow with feature branches.

### Quick Start

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/clawdo.git
cd clawdo
npm install
npm run build
npm test
```

### Development Workflow

1. **Create a branch:** `git checkout -b feat/my-feature`
2. **Make changes:** code, test, commit
3. **Push:** `git push origin feat/my-feature`
4. **Create PR:** `gh pr create`
5. **CI validates:** tests must pass
6. **Merge:** maintainer reviews and merges

### Versioning & Releases

We use [Semantic Versioning](https://semver.org/):
- **PATCH** (1.0.1): Bug fixes
- **MINOR** (1.1.0): New features
- **MAJOR** (2.0.0): Breaking changes

Releases are created manually using `npm version` + GitHub Releases, which triggers automatic publishing to npm and ClawHub.

### Full Documentation

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Branch naming conventions
- Commit message format
- Testing guidelines
- Code style rules
- Security considerations
- CI/CD workflow details

---

## License

MIT

---

*Built by [LePetitPince](https://github.com/LePetitPince) 🌹*
