# Pipeline Guide

This guide describes the current and near-term contract for the Ralph pipeline.

## Contract

There are two separate surfaces:

- `skills/pipeline/SKILL.md` is the interactive, gated orchestration surface for Claude conversations.
- `ralph pipeline` is the project-side backend that stores pipeline state, inspects artifacts, and now generates review / convert artifacts when the required upstream inputs already exist.

The CLI still does not replace the skill layer with an automatic OpenSpec or Superpowers conversation. That approval-heavy workflow is still handled by the conversation layer.

## Phase Model

| Phase | What the backend expects | What the skill should say |
|------|---------------------------|---------------------------|
| `spec` | OpenSpec artifacts, or a degraded direct-PRD path when OpenSpec is unavailable | "The spec gate is ready. Approve or revise it?" |
| `review` | A matching PRD markdown artifact, or spec artifacts that can be turned into one | "The review gate is ready. Approve the PRD?" |
| `convert` | A valid `prd.json`, or a PRD markdown artifact that can be converted into one | "The conversion gate is ready. Approve the story breakdown?" |
| `execute` | Ralph execution handoff | "The execution gate is ready. Start or resume Ralph?" |

If a required upstream input is missing, the backend reports a blocked state instead of guessing what to do next.

## Recommended Use

Use the skill when you want the pipeline to be managed inside a Claude conversation:

```text
/ralph-skills:pipeline "add user notification system"
```

The skill should:

1. Summarize the current gate.
2. Ask for explicit approval.
3. Wait for a clear yes before moving on.
4. Use the backend commands below when the corresponding gate is approved.

Skill-level options like `--skip-spec`, `--skip-review`, and `--resume` are conversation-flow hints only. They are not `ralph pipeline` CLI flags.

## CLI Usage

The backend CLI is useful when you want to inspect or advance state from the shell.

```bash
ralph pipeline init <feature-name>   # Create state for a new feature
ralph pipeline run <feature-name>    # Initialize if needed and advance as far as available inputs allow
ralph pipeline resume                # Continue from the saved pipeline state
ralph pipeline advance <phase>       # Record a phase as complete: spec, review, convert, or execute
ralph pipeline status                # Show phase, state, and tool availability
ralph pipeline check                 # Run granularity checks on prd.json
ralph pipeline learnings             # Archive learnings from progress.txt
ralph pipeline reset                 # Clear pipeline state
```

Useful execution handoff:

```bash
ralph pipeline run <feature-name> --no-execute
```

That leaves the pipeline at the execution gate without launching Ralph. The same `--no-execute` flag also applies to `ralph pipeline resume`.

## Run, Resume, Advance

- `ralph pipeline run` is the normal entry point for a feature. It creates state if needed and then advances as far as the current inputs allow.
- `ralph pipeline resume` continues from the saved state when a pipeline was interrupted.
- `ralph pipeline advance <phase>` is manual bookkeeping for cases where the gate has already been satisfied.
- `ralph --resume` resumes Ralph execution, not the pipeline state machine.

## Gate Behavior

The skill should present gates and wait for approval:

1. Spec gate: summarize the proposed scope and ask whether it is ready for review.
2. Review gate: summarize the PRD and ask whether it is ready for conversion.
3. Conversion gate: summarize the `prd.json` split and ask whether execution can start.
4. Execution gate: hand off to Ralph or resume a previous execution.

The CLI does not ask these questions for you. It records state transitions, generates review / convert artifacts when it has enough inputs, and reports where human approval is still needed.

## Tool Availability

`ralph pipeline status` reports whether OpenSpec and Superpowers are available in the current project.

Treat that output as information, not as a promise that the CLI will directly invoke those tools conversationally. In the shipped behavior, the skill layer is still responsible for the human-facing review flow, while the CLI handles deterministic generation and validation steps.
