# clawdo 🦞

[![npm](https://img.shields.io/npm/v/clawdo)](https://www.npmjs.com/package/clawdo)
[![CI](https://github.com/LePetitPince/clawdo/actions/workflows/ci.yml/badge.svg)](https://github.com/LePetitPince/clawdo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![ClawHub](https://img.shields.io/badge/ClawHub-skill-blue)](https://clawhub.com)

Your AI agent has memory files, cron jobs, and chat. It has no todo list.

clawdo is that missing piece — a persistent task queue for AI agents.

```bash
clawhub install clawdo    # if you're on OpenClaw
npm install -g clawdo     # standalone
```

## The gap

Think about what your agent framework gives you:

- **Memory** — context that persists between sessions
- **Cron** — do X at 3pm Tuesday
- **Chat** — talk to your human

Now think about what's missing: a way to say **"do this when you get to it."**

Not "do this at 14:00 UTC." Not "do this right now in this conversation." Just... remember to do it. Track it. Pick it up when there's a gap.

That's clawdo.

```bash
# Human or agent captures a task
clawdo add "update dependencies" --urgency soon

# Agent checks its queue (heartbeat, cron, conversation — wherever)
clawdo inbox --format json

# Agent works it
clawdo start a3f2
clawdo done a3f2 --json
```

`add → inbox → start → done`. Persistent state in SQLite. Every command has `--json` so agents parse structured output, not terminal art.

## Where it fits

clawdo works everywhere agents work:

- **Heartbeat loops** — "anything in my queue? let me do it between checks"
- **Cron jobs** — "every hour, process one task"
- **Conversations** — "J mentioned fixing the auth module, let me capture that"
- **Pipes and sub-agents** — non-TTY safe, no interactive prompts

The agent wakes up, checks `clawdo inbox`, knows what to do.

## Autonomy levels

Tasks can be tagged with permission tiers that control what the agent is allowed to do unsupervised:

| Level | Time limit | What it means |
|-------|-----------|---------------|
| **auto** | 10 min | Agent can do this silently. Fix a typo. Run tests. Small stuff. |
| **auto-notify** | 30 min | Agent can do this, but tell the human when it's done. Research, refactoring. |
| **collab** | No limit | Needs human involvement. Complex, risky, or ambiguous work. |

Default: `collab` (safe).

**The key rule:** autonomy is a permission, not a suggestion. Once set, the agent can't change it. The one exception: if an agent fails the same task 3 times, autonomy *demotes* to `collab`. Safety only moves down, never up.

**Agents propose, humans approve.** When an agent adds work, it goes to `proposed` status. The human runs `clawdo confirm <id>` or it doesn't happen.

## Install

**Via [ClawHub](https://clawhub.ai)** (recommended for OpenClaw agents):

```bash
clawhub install clawdo    # installs skill + docs into your workspace
npm install -g clawdo     # install the CLI binary
```

**Via npm only:**

```bash
npm install -g clawdo
```

**Requirements:** Node.js ≥ 18, build tools for better-sqlite3:
- Debian/Ubuntu: `apt install build-essential python3`
- macOS: `xcode-select --install`

Tasks live in `~/.config/clawdo/`.

## Usage

### For humans

```bash
# Add tasks — inline metadata is optional but fast
clawdo add "deploy new API +backend auto-notify now"
#           └── text ──────┘ └project┘ └─level──┘ └urg┘

# View
clawdo list                       # active tasks
clawdo list --status proposed     # what did the agent suggest?
clawdo list --ready               # unblocked, actionable
clawdo next                       # highest priority

# Work
clawdo start <id>
clawdo done <id>
clawdo done abc,def,ghi           # complete several at once
clawdo done                       # complete all in-progress

# Review agent proposals
clawdo confirm <id>               # approve → moves to todo
clawdo reject <id> --reason "too risky"

# Organize
clawdo edit <id> --urgency now
clawdo note <id> "blocked on API access"
clawdo block <id> by <other-id>
clawdo archive --status done      # clean up
```

### For agents

Every read command supports `--json`. Every write command does too.

```bash
# Check inbox (structured)
clawdo inbox --format json

# Propose work
clawdo propose "add input validation" --level auto --json

# Execute
TASK=$(clawdo next --auto --json | jq -r '.task.id // empty')
if [ -n "$TASK" ]; then
  clawdo start "$TASK" --json
  # ... do the work ...
  clawdo done "$TASK" --json
fi
```

The inbox returns categorized tasks: `autoReady`, `autoNotifyReady`, `urgent`, `overdue`, `proposed`, `stale`, `blocked`. Parse it, don't scrape it.

### Integration example: OpenClaw heartbeat

```bash
# In HEARTBEAT.md — runs every ~30 minutes
TASKS=$(clawdo inbox --format json)
AUTO=$(echo "$TASKS" | jq '.autoReady | length')

if [ "$AUTO" -gt 0 ]; then
  TASK=$(clawdo next --auto --json | jq -r '.task.id')
  clawdo start "$TASK" --json
  # ... do the work ...
  clawdo done "$TASK" --json
fi
```

## Urgency

| Level | Meaning |
|-------|---------|
| `now` | Drop everything. |
| `soon` | In the next day or two. |
| `whenever` | No rush. (default) |
| `someday` | Backlog. May never happen. |

Optional: `--due YYYY-MM-DD` for hard deadlines.

**Note:** Unlike autonomy, urgency is freely editable — including by agents. It's scheduling metadata, not a permission boundary. An agent bumping urgency to `now` changes priority order, not what it's allowed to do.

## Inline syntax

Quick metadata parsing for humans who type fast:

```bash
clawdo add "fix auth bug +backend @code auto soon"
```

- `+word` → project
- `@word` → context
- `auto` / `auto-notify` / `collab` → autonomy level
- `now` / `soon` / `whenever` / `someday` → urgency
- `due:YYYY-MM-DD` or `due:tomorrow` → due date

Flags always override inline parsing. If parsing fails, text is stored verbatim.

## Multi-agent setup

```bash
# Separate databases (isolation)
export CLAWDO_DB_PATH=/shared/agent-name.db
clawdo add "task"

# Shared database (coordination)
export CLAWDO_DB_PATH=/shared/team.db
# SQLite WAL mode: concurrent reads + 1 writer
```

Or per-command: `clawdo --db /path/to/db add "task"`

## Task lifecycle

```
proposed → todo → in_progress → done
   ↓
rejected (→ archived)
```

- Agents create → `proposed` (always, regardless of flags)
- Humans create → `todo` (directly)
- 3 agent failures → autonomy demotes to `collab`
- Completing a task auto-unblocks anything waiting on it

## Security

clawdo is built for the threat model where *your own agent is the attacker* — not maliciously, but through overconfidence, bugs, or prompt injection from untrusted data flowing through the task queue.

**What's enforced:**

- **Immutable autonomy** — agents cannot escalate their own permissions. The one mutation is demotion after 3 failures.
- **Proposal limits** — max 5 active proposals, 60-second cooldown. Prevents task-spam.
- **Prompt injection defense** — task text is sanitized before it can reach an LLM context. Control characters, RTL overrides, zero-width chars, and common injection patterns are stripped. Inbox JSON is wrapped in structural XML tags warning the consuming LLM not to execute task text as instructions.
- **Immutable audit trail** — every state change logged with timestamp, actor, and context. Append-only JSONL.
- **Uniform ID generation** — `crypto.randomInt()` (rejection sampling, no modulo bias).
- **Parameterized SQL everywhere** — zero string interpolation in queries.

**Provenance:** Published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), providing cryptographic proof it was built by GitHub Actions from this repo.

## Stats & history

```bash
clawdo stats                # summary counts (--json)
clawdo history <id>         # full audit trail (--json)
clawdo show <id>            # detailed view (--json)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, workflow, and code standards.

**Security issues:** Use [GitHub Security Advisories](https://github.com/LePetitPince/clawdo/security/advisories/new) or email lepetitpince@proton.me.

## License

MIT

---

Built by [LePetitPince](https://github.com/LePetitPince) 🌹

*Your agent finally has a todo list.*
