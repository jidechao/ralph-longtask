# Ralph Agent Instructions

## Overview

Ralph is a cross-platform Node.js CLI that runs Claude Code repeatedly until all PRD items are complete. Each iteration is a fresh instance with clean context.

## Commands

```bash
# Install dependencies
npm install

# Run Ralph (default 10 iterations)
node ralph.js

# Specify max iterations
node ralph.js 20

# Use a custom config file
node ralph.js --config ./path/to/ralph.config.json

# Run tests
npm test
```

## Key Files

- `ralph.js` - Main entry point and iteration loop
- `lib/config.js` - Three-layer config merge (defaults → file → env vars)
- `lib/prd.js` - PRD loading, validation, atomic save
- `lib/prompt-builder.js` - Six-layer prompt assembly
- `lib/executor.js` - Claude CLI session execution
- `lib/validator.js` - Post-session validation pipeline
- `lib/progress.js` - Progress log initialization and append
- `CLAUDE.md` - Instructions given to each Claude Code instance
- `templates/RALPH.md` - Agent instruction template
- `doc/USER_GUIDE.md` - Detailed usage guide
- `doc/ralph-cli.md` - Architecture documentation

## Patterns

- Each iteration spawns a fresh Claude Code instance with clean context
- Memory persists via git history, `progress.txt`, and `prd.json`
- Stories should be small enough to complete in one context window
- Always update AGENTS.md with discovered patterns for future iterations
- Configuration supports defaults, `ralph.config.json`, and `RALPH_*` env vars
