# Ralph

![Ralph](ralph.webp)

Ralph is an autonomous AI agent loop that runs [Claude Code](https://docs.anthropic.com/en/docs/claude-code) repeatedly until all PRD items are complete. Each iteration is a fresh instance with clean context. Memory persists via git history, `progress.txt`, and `prd.json`. This is a cross-platform Node.js implementation supporting Windows, macOS, and Linux.

Based on [Geoffrey Huntley's Ralph pattern](https://ghuntley.com/ralph/).

[Read my in-depth article on how I use Ralph](https://x.com/ryancarson/status/2008548371712135632)

## Prerequisites

- **Node.js >= 18**
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- A git repository for your project

## Setup

### Install

```bash
cd ralph-longtask
npm install
```

### Global install (optional)

```bash
npm link
```

After linking, you can run `ralph` in any project directory.

### Local run (no install)

```bash
node ralph.js [参数]
```

## Workflow

### 1. Create a PRD

Use the PRD skill to generate a detailed requirements document:

```
Load the prd skill and create a PRD for [your feature description]
```

Answer the clarifying questions. The skill saves output to `tasks/prd-[feature-name].md`.

### 2. Convert PRD to Ralph format

Use the Ralph skill to convert the markdown PRD to JSON:

```
Load the ralph skill and convert tasks/prd-[feature-name].md to prd.json
```

This creates `prd.json` with user stories structured for autonomous execution.

### 3. (Optional) Customize instructions

Copy and edit the agent instruction template:

```bash
cp templates/RALPH.md ./RALPH.md
```

Edit `RALPH.md` to add project-specific rules and conventions.

### 4. Run Ralph

```bash
# Default: 10 iterations
ralph

# Specify max iterations
ralph 20

# Use a custom config file
ralph --config ./path/to/ralph.config.json

# Or run directly without global install
node ralph.js
```

Ralph will:
1. Create a feature branch (from PRD `branchName`)
2. Pick the highest priority story where `passes: false`
3. Implement that single story
4. Run quality checks (typecheck, tests)
5. Commit if checks pass
6. Update `prd.json` to mark story as `passes: true`
7. Append learnings to `progress.txt`
8. Repeat until all stories pass or max iterations reached

## Key Files

| File | Purpose |
|------|---------|
| `ralph.js` | Main entry point - CLI argument parsing and iteration loop |
| `lib/config.js` | Three-layer config merge (defaults → file → env vars) |
| `lib/prd.js` | PRD loading, validation, atomic save |
| `lib/prompt-builder.js` | Six-layer prompt assembly with glob context loading |
| `lib/executor.js` | Claude CLI session execution (Windows/macOS/Linux) |
| `lib/validator.js` | Post-session validation pipeline (JSON, git commit, auto-patch) |
| `lib/progress.js` | Progress log initialization and append |
| `templates/RALPH.md` | Agent instruction template |
| `prd.json` | User stories with `passes` status (the task list) |
| `progress.txt` | Append-only learnings for future iterations |
| `doc/USER_GUIDE.md` | Detailed usage guide |
| `doc/ralph-cli.md` | Architecture and design documentation |

## Critical Concepts

### Each Iteration = Fresh Context

Each iteration spawns a **new Claude Code instance** with clean context. The only memory between iterations is:
- Git history (commits from previous iterations)
- `progress.txt` (learnings and context)
- `prd.json` (which stories are done)

### Small Tasks

Each PRD item should be small enough to complete in one context window. If a task is too big, the LLM runs out of context before finishing and produces poor code.

Right-sized stories:
- Add a database column and migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

Too big (split these):
- "Build the entire dashboard"
- "Add authentication"
- "Refactor the API"

### AGENTS.md Updates Are Critical

After each iteration, Ralph updates the relevant `AGENTS.md` files with learnings. This is key because AI coding tools automatically read these files, so future iterations (and future human developers) benefit from discovered patterns, gotchas, and conventions.

Examples of what to add to AGENTS.md:
- Patterns discovered ("this codebase uses X for Y")
- Gotchas ("do not forget to update Z when changing W")
- Useful context ("the settings panel is in component X")

### Feedback Loops

Ralph only works if there are feedback loops:
- Typecheck catches type errors
- Tests verify behavior
- CI must stay green (broken code compounds across iterations)

### Browser Verification for UI Stories

Frontend stories must include "Verify in browser using dev-browser skill" in acceptance criteria. Ralph will use the dev-browser skill to navigate to the page, interact with the UI, and confirm changes work.

### Stop Condition

When all stories have `passes: true`, Ralph outputs `<promise>COMPLETE</promise>` and the loop exits.

## Debugging

Check current state:

```bash
# See which stories are done
node -e "const p=require('./prd.json'); p.userStories.forEach(s => console.log(s.id, s.passes))"

# See learnings from previous iterations
cat progress.txt

# Check git history
git log --oneline -10
```

## Customizing the Prompt

Edit `RALPH.md` to customize agent behavior for your project:
- Add project-specific quality check commands
- Include codebase conventions
- Add common gotchas for your stack

Configuration is managed via `ralph.config.json` (see `doc/USER_GUIDE.md` for all options).

## References

- [Geoffrey Huntley's Ralph article](https://ghuntley.com/ralph/)
- [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code)
- [User Guide](doc/USER_GUIDE.md) — Detailed usage and configuration
- [Architecture](doc/ralph-cli.md) — Design and internals
