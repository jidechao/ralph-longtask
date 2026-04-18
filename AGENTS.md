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

# Resume from existing progress (skip archive check)
node ralph.js --resume

# Use a custom config file
node ralph.js --config ./path/to/ralph.config.json

# Pipeline orchestration
ralph pipeline init <feature-name>   # Initialize a new pipeline
ralph pipeline run <feature-name>    # Initialize if needed and advance until blocked/complete
ralph pipeline resume                # Continue from the current phase
ralph pipeline status                # Show pipeline state and tool availability
ralph pipeline advance <phase>       # Mark a phase as complete (spec|review|convert|execute)
ralph pipeline check                 # Run granularity checks on prd.json stories
ralph pipeline learnings             # Extract learnings from progress.txt and archive
ralph pipeline reset                 # Clear pipeline state

# Run tests
npm test
```

## Key Files

- `ralph.js` - Main entry point and iteration loop
- `ralph-pipeline.js` - Standalone pipeline CLI entry point
- `lib/config.js` - Three-layer config merge (defaults → file → env vars)
- `lib/prd.js` - PRD loading, validation, atomic save
- `lib/prompt-builder.js` - Six-layer prompt assembly
- `lib/executor.js` - Claude CLI session execution
- `lib/validator.js` - Post-session validation pipeline
- `lib/progress.js` - Progress log initialization and append
- `lib/archive.js` - Branch change detection and run archiving
- `lib/pipeline-state.js` - Pipeline phase state management (spec→review→convert→execute)
- `lib/pipeline-cli.js` - Pipeline orchestration, artifact detection, resume flow, and learnings archival
- `lib/granularity.js` - Story granularity checker (5 rules) and splitter
- `lib/learnings.js` - Learning extraction from progress.txt and markdown archiving
- `CLAUDE.md` - Instructions given to each Claude Code instance
- `templates/RALPH.md` - Agent instruction template
- `doc/USER_GUIDE.md` - Detailed usage guide
- `doc/ralph-cli.md` - Architecture documentation
- `doc/PIPELINE_GUIDE.md` - Pipeline orchestration guide

## Patterns

- Each iteration spawns a fresh Claude Code instance with clean context
- Memory persists via git history, `progress.txt`, and `prd.json`
- Stories should be small enough to complete in one context window
- Always update AGENTS.md with discovered patterns for future iterations
- Configuration supports defaults, `ralph.config.json`, and `RALPH_*` env vars
- Pipeline orchestrates four ordered phases: spec → review → convert → execute
- Story granularity is enforced by 5 rules: TOO_MANY_SENTENCES, TOO_MANY_CRITERIA, CROSS_LAYER, VAGUE_LANGUAGE, TOO_BROAD
- Branch changes auto-archive previous run (prd.json + progress.txt) to `archive/` directory
- Learnings are extracted from progress.txt (patterns, gotchas, recommendations) and archived to markdown
- Tool detection: OpenSpec and Superpowers skills are auto-detected for pipeline phase fallback
- Pipeline state is stored in `.pipeline-state.json` and advanced by ralph.js after all stories complete
- Pipeline orchestration is artifact-driven: OpenSpec `design.md` + `tasks.md` advance `spec`, `tasks/prd-*.md` advances `review`, and a passing `prd.json` advances `convert`
- `ralph --resume` defers to pipeline orchestration when the current phase is before `execute`; execution runs track `executionStartedAt` to decide between fresh run and resume
- Learnings archival is automatic after `execute` completes and persisted in pipeline metadata via `learningsPath`
- PRD backup/restore: `prd.json.bak` is created before each session and restored on corruption
