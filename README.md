# Ralph

Ralph is a cross-platform Node.js CLI that repeatedly runs Claude Code until the items in a PRD are complete.

It is designed for project-local use: you describe work in `prd.json`, and Ralph iterates through the stories, hands each one to Claude, verifies the result, and records progress in your project.

## What Ralph Is

Ralph is a standalone automation tool for one project at a time.

- It reads `prd.json` from the project you point it at.
- It starts a fresh Claude Code session for each iteration.
- It tracks progress in `progress.txt` and git history.
- It can resume from prior state when a run is interrupted.

## Install

```bash
npm install
```

Optional global install:

```bash
npm link
```

After linking, `ralph` is available from any project directory.

## Quick Start

1. Open the project you want Ralph to work on.
2. Make sure that project contains a `prd.json`.
3. Run Ralph:

```bash
ralph
```

If you prefer not to install globally, you can run the local script directly:

```bash
node /path/to/ralph-longtask/ralph.js
```

## Basic Usage

```bash
ralph              # Run up to 10 iterations
ralph 20           # Run up to 20 iterations
ralph --resume     # Resume an interrupted Ralph execution loop
ralph --config ./path/to/project
```

Notes:

- `ralph --resume` is context-sensitive: it resumes Ralph execution, and if the pipeline is paused before `execute`, it first hands off to `ralph pipeline resume`.
- `ralph --config` points Ralph at a project directory that contains the PRD and related files.

## Pipeline Contract

Ralph also ships with a pipeline workflow, but the responsibilities are split:

- `skills/pipeline/SKILL.md` is the interactive, gated orchestration surface for Claude conversations.
- `ralph pipeline` is the project-side state and orchestration backend. It tracks phase state, inspects available artifacts, and now fills in the review and convert outputs when enough upstream inputs already exist.

The CLI still does not replace the skill layer for human approvals or full OpenSpec / Superpowers conversations end to end.

### Pipeline Commands

```bash
ralph pipeline init <feature-name>   # Create pipeline state for a feature
ralph pipeline run <feature-name>    # Initialize if needed and advance as far as available inputs allow
ralph pipeline resume                # Continue from the saved pipeline state
ralph pipeline advance <phase>       # Mark a gate complete after it has already been reviewed and approved
ralph pipeline status                # Show state, phase, and tool availability
ralph pipeline check                 # Run granularity checks on prd.json
ralph pipeline learnings             # Archive learnings from progress.txt
ralph pipeline reset                 # Clear pipeline state
```

Useful execution handoff:

```bash
ralph pipeline run <feature-name> --no-execute
```

That stops after the pipeline reaches the execution handoff instead of launching Ralph immediately.

### Current Behavior

The shipped backend is now partially generative:

- `spec` advances when the expected OpenSpec artifacts are present, or degrades to an existing matching PRD markdown path when OpenSpec is unavailable.
- `review` advances from an existing matching PRD markdown artifact or generates one from spec artifacts with the built-in review checklist.
- `convert` advances from an existing `prd.json`, or generates one from PRD markdown, validates it, and then runs the granularity check.
- `execute` launches Ralph unless `--no-execute` was provided.

If a required upstream input is missing, the pipeline reports that it is blocked instead of pretending the missing step was completed.

## Project Files

These are the main files Ralph cares about in your project:

```text
your-project/
├── prd.json
├── prd.json.bak
├── progress.txt
├── RALPH.md
├── CLAUDE.md
├── ralph.config.json
└── archive/
```

Quick definitions:

- `prd.json` is the PRD Ralph executes.
- `progress.txt` stores progress notes and learnings.
- `RALPH.md` is optional agent guidance for each Claude iteration.
- `CLAUDE.md` is optional project guidance for Claude Code.
- `ralph.config.json` is optional configuration.
- `archive/` stores old runs when the branch changes.

## More Docs

- [Pipeline Guide](doc/PIPELINE_GUIDE.md)
- [Ralph CLI architecture](doc/ralph-cli.md)
- [User Guide](doc/USER_GUIDE.md)

## Reference

- [Geoffrey Huntley’s Ralph article](https://ghuntley.com/ralph/)
- [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code)
