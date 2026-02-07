---
name: clawdo
version: 1.1.0
author: LePetitPince <lepetitpince@proton.me>
homepage: https://github.com/LePetitPince/clawdo
description: Agent-first task queue with autonomous execution levels. Agents propose tasks, humans approve, agents execute. Security-first design with prompt injection defense, immutable autonomy levels, and multi-agent database isolation.
tags:
  - task-management
  - autonomous
  - agent-first
  - security
  - workflow
  - collaboration
keywords:
  - task queue
  - autonomous execution
  - agent collaboration
  - todo
  - security
  - multi-agent
categories:
  - productivity
  - agent-tools
  - workflow
metadata:
  {
    "openclaw":
      {
        "emoji": "🦞",
        "requires": { "bins": ["clawdo"] },
        "install":
          [
            {
              "id": "npm",
              "kind": "npm",
              "package": "clawdo",
              "bins": ["clawdo"],
              "label": "Install clawdo (npm global)",
            },
          ],
      },
  }
---

# 🦞 clawdo - Agent-First Task Queue

**Task management CLI designed for autonomous AI agents.**

Agents propose work, humans approve, agents execute. Built-in autonomy levels, security guardrails, and multi-agent support.

## Why clawdo?

🤖 **Agent-First Design** — Agents propose tasks, check their inbox, execute autonomously  
🔒 **Security Guardrails** — Prompt injection defense, immutable autonomy, rate limiting  
⚡ **Autonomy Levels** — `auto` (10min), `auto-notify` (30min), `collab` (unlimited)  
🗄️ **Multi-Agent Ready** — SQLite WAL mode for concurrent access  
📊 **Structured Output** — Every command has `--json` mode

## Installation

```bash
npm install -g clawdo
```

**Requirements:** Node.js ≥18

## Quick Start

```bash
# Agent workflow
clawdo inbox --format json              # Check what needs attention
clawdo propose "Task idea" --level auto # Propose work
clawdo next --auto --json               # Get next approved task
clawdo start <id>                       # Start working
clawdo done <id>                        # Mark complete

# Human workflow
clawdo add "Fix bug +backend auto soon" # Add task (inline metadata)
clawdo list --status proposed           # Review agent proposals
clawdo confirm <id>                     # Approve proposal
clawdo list --json                      # View all tasks
```

## Core Concepts

### Autonomy Levels: The Safety Contract

| Level | Time Limit | Use Case | Human Involvement |
|-------|------------|----------|-------------------|
| **auto** | 10 min | Small fixes, tests, docs | Silent execution |
| **auto-notify** | 30 min | Multi-step work, research | Notify on completion |
| **collab** | Unlimited | Complex features, risky ops | Real-time collaboration |

**Key constraint:** Autonomy levels are **immutable** after creation. Agents cannot escalate permissions.

### Task Lifecycle

```
proposed → todo → in_progress → done
   ↓
rejected
```

- **Agents propose** → `proposed` status (max 5 active, 60s cooldown)
- **Humans approve** → `confirm` → `todo` status
- **Agents execute** → `start` → `in_progress` → `done`

### Inbox: Agent Command Center

```bash
clawdo inbox --format json
```

Returns structured data with:
- `autoReady` — Tasks approved and ready for autonomous execution
- `autoNotifyReady` — Auto-notify tasks ready to execute
- `proposed` — Tasks awaiting human approval
- `urgent` — Tasks marked `urgency=now`
- `overdue` — Tasks past their due date
- `blocked` — Tasks blocked by unfinished dependencies
- `stale` — Tasks in-progress for >24 hours

**Agent pattern:** Check inbox → execute auto tasks → propose new work.

## Agent Usage Patterns

### Basic Agent Loop

```bash
# Get next auto task
TASK=$(clawdo next --auto --json | jq -r '.task.id // empty')
if [ -n "$TASK" ]; then
  clawdo start "$TASK"
  # ... do work ...
  clawdo done "$TASK"
fi
```

### Smart Proposals

```bash
# Propose with appropriate autonomy level
clawdo propose "Update API docs" --level auto --urgency soon --project api

# Link to parent task
clawdo note current-task "Proposed follow-up: docs update"
```

### Bulk Operations

```bash
# Complete multiple tasks
clawdo done abc,def,ghi

# Get all tasks by project
clawdo list --json | jq -r '.tasks[] | select(.project=="api") | .id'
```

## Multi-Agent Setup

### Option 1: Separate Databases (Isolation)

```bash
# Agent 1
export CLAWDO_DB_PATH=/shared/agent1.db
clawdo inbox --format json

# Agent 2
export CLAWDO_DB_PATH=/shared/agent2.db
clawdo inbox --format json
```

### Option 2: Shared Database (Collaboration)

```bash
# All agents use same database
export CLAWDO_DB_PATH=/shared/team.db

# Filter by project/context
clawdo list --json | jq '.tasks[] | select(.project=="backend")'
```

SQLite WAL mode supports concurrent reads + 1 writer.

## Security Features

🛡️ **Prompt Injection Defense** — All user input sanitized to prevent LLM manipulation  
🔒 **Immutable Autonomy** — Agents cannot escalate their own permissions  
⏱️ **Rate Limiting** — Max 5 proposals, 60-second cooldown  
📝 **Audit Logs** — Append-only cryptographic audit trail  
🎲 **Secure IDs** — Cryptographically random, not sequential

## Command Reference

**For detailed command documentation, use:**

```bash
clawdo --help              # Full CLI overview with examples
clawdo <command> --help    # Command-specific options
```

**Key commands:**

- `clawdo add` — Add task (inline metadata: `+project @context auto soon`)
- `clawdo list` — List tasks (`--status`, `--level`, `--json` filters)
- `clawdo next` — Get next task (`--auto` flag for agents)
- `clawdo propose` — Agent proposes task (max 5 active proposals)
- `clawdo confirm/reject` — Human approves/rejects proposals
- `clawdo start/done` — Task lifecycle (supports bulk: `done abc,def,ghi`)
- `clawdo inbox` — Agent's command center (`--format json|markdown`)
- `clawdo show` — Full task details (`--json` for programmatic use)
- `clawdo stats` — Task statistics (`--json` output)
- `clawdo history` — Task history log (`--json` output)

**All read commands support `--json` for agents.**

## Real-World Scenarios

### Scenario 1: Autonomous Maintenance

Agent checks inbox during heartbeat, executes approved auto tasks silently, proposes follow-up work.

### Scenario 2: Research with Oversight

Agent takes auto-notify tasks, conducts research (30min max), notifies human on completion with findings.

### Scenario 3: Multi-Agent Team

Multiple agents share a database, filter by project tags, coordinate via blocking dependencies.

## Best Practices

✅ **Use appropriate autonomy levels** — Don't mark risky work as `auto`  
✅ **Check inbox regularly** — Agents should poll `inbox --format json`  
✅ **Propose granular tasks** — Better to propose 3 small tasks than 1 large  
✅ **Use blocking dependencies** — `clawdo block <id> <blocker-id>`  
✅ **Parse JSON output** — Don't scrape text, use `--json` flags  
✅ **Respect rate limits** — Max 5 active proposals prevents spam

## Examples

**Human adds task with inline metadata:**

```bash
clawdo add "Fix login bug +backend @coding auto soon"
#           └─text─────┘ └project┘ └context┘ └lv┘ └urg┘
```

**Agent proposes and executes:**

```bash
# Propose
clawdo propose "Run test suite" --level auto --urgency now

# Human confirms
clawdo confirm abc123

# Agent executes
clawdo start abc123
npm test
clawdo done abc123
```

**Agent filters inbox:**

```bash
clawdo inbox --format json | jq '.autoReady[] | select(.urgency=="now")'
```

## Resources

- **GitHub:** https://github.com/LePetitPince/clawdo
- **npm:** https://www.npmjs.com/package/clawdo
- **Full Documentation:** Run `clawdo --help`
- **Issues:** https://github.com/LePetitPince/clawdo/issues

## License

MIT — See LICENSE file in the repository.
