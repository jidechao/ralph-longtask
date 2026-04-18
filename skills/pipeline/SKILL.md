---
name: pipeline
description: "Interactive, gated orchestration surface for Claude conversations. Use it to guide a feature through spec, review, prd.json conversion, and Ralph execution with explicit approval at each gate."
user-invocable: true
argument-hint: "[--skip-spec] [--skip-review] [--resume] <feature description>"
---

# Pipeline

This skill is the conversation-facing layer of the Ralph workflow.

It does not replace the `ralph pipeline` backend. Instead, it helps a person move through the workflow in a Claude conversation, summarize the current gate, and pause for approval before continuing.

## Responsibilities

- Gather the feature description.
- Summarize the current gate in plain language.
- Ask for explicit approval before moving to the next gate.
- Call out when OpenSpec or Superpowers are available, and distinguish between built-in CLI automation versus conversation-only approvals.
- Use backend `ralph pipeline` commands when the saved project state needs to be advanced or resumed.

## What this skill is not

- It is not a promise that the CLI will automatically run OpenSpec or Superpowers conversations.
- It is not a replacement for `ralph pipeline`.
- It is not allowed to skip the user's approval at a gate.

## Gate Flow

1. Spec gate
   - Summarize the requested feature.
   - Ask whether the scope is ready for review.
2. Review gate
   - Summarize the PRD or review output.
   - Ask whether the PRD is ready for conversion.
3. Convert gate
   - Summarize the `prd.json` breakdown.
   - Ask whether execution can start.
4. Execution gate
   - Hand off to Ralph or resume an interrupted execution loop.

Skill-level flags such as `--skip-spec`, `--skip-review`, and `--resume` are conversation-flow hints only. They help the skill decide which gate to discuss next, but they do not change the `ralph pipeline` CLI contract.

## Backend Alignment

Use these commands when the project state should be recorded or inspected:

```bash
ralph pipeline init <feature-name>
ralph pipeline run <feature-name>
ralph pipeline resume
ralph pipeline advance <spec|review|convert|execute>
ralph pipeline status
ralph pipeline check
ralph pipeline learnings
ralph pipeline reset
```

Important distinctions:

- `ralph pipeline run` starts or reuses pipeline state and advances as far as the available inputs allow.
- `ralph pipeline resume` continues from saved pipeline state.
- `ralph pipeline advance <phase>` should only be used after the corresponding gate has been reviewed and approved.
- `ralph --resume` resumes Ralph execution, not the pipeline state machine.

If the required upstream input for a phase does not exist yet, say so plainly and stop at the gate instead of implying the workflow is already automated.

## Suggested Wording

- "The spec gate is ready. Do you want to approve it?"
- "The review gate is ready. Should we move to conversion?"
- "The `prd.json` gate passed. Ready to start execution?"
- "The CLI can generate the next artifact, but the conversation still needs your approval before we advance."
