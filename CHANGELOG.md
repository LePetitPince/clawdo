# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [1.1.0] - 2026-02-07

### Added
- `--json` flag on all mutation commands: `add`, `start`, `done`, `edit`, `confirm`, `reject`, `block`, `unblock`, `note`, `propose`, `archive`, `unarchive`. Agents can now parse structured output from every command.

### Fixed
- CLI `--version` now correctly reports the package.json version (was hardcoded to 1.0.0).
- Task ID generation uses `crypto.randomInt()` instead of `randomBytes % n`, eliminating modulo bias.

### Changed
- README rewritten with origin story, explicit design rationale, and honest documentation of what is and isn't enforced.
- Repo description updated.
- Added design decision comments throughout codebase: urgency editability vs autonomy immutability, failTask autonomy bypass rationale, non-TTY auto-confirm behavior.

## [1.0.1] - 2026-02-07

### Fixed
- ClawHub authentication step in publish workflow (use `CLAWHUB_TOKEN` env var).

## [1.0.0] - 2026-02-07

### Added
- Initial release.
- Task CRUD with inline metadata parsing (`+project @context auto soon`).
- Three autonomy levels: `auto` (10min), `auto-notify` (30min), `collab` (unlimited).
- Four urgency levels: `now`, `soon`, `whenever`, `someday`.
- Agent proposal workflow: `propose` → `confirm`/`reject`.
- Structured agent inbox (`clawdo inbox --format json`) with categorized output.
- Task dependencies with circular dependency detection.
- Prompt injection defense and input sanitization.
- Immutable autonomy levels (cannot escalate after creation).
- Rate limiting on agent proposals (max 5 active, 60s cooldown).
- Auto-demotion to `collab` after 3 agent failures.
- Append-only audit trail (JSONL with SQLite fallback).
- Prefix-based task ID resolution.
- Bulk complete/archive operations.
- Multi-agent database support via `CLAWDO_DB_PATH` or `--db` flag.
- CI workflow (Node 18/20/22 matrix) and publish workflow (npm + ClawHub).
- ClawHub skill manifest.
