# Pipeline Automation And Ralph Completion Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenSpec + Superpowers + Ralph pipeline actually automate Phase 1-3 end to end, then harden Ralph so a story is marked complete only when completion is explicitly signaled and minimally validated.

**Architecture:** Split the work into two batches. Batch 1 introduces explicit pipeline action handlers and PRD conversion so `ralph pipeline run` can progress from feature input to `execute` without manual artifact creation. Batch 2 upgrades Ralph session output handling and post-session validation so completion is driven by evidence instead of a loose "commit exists" heuristic.

**Tech Stack:** Node.js 18+, ESM modules, built-in `node:test`, `glob`, `chalk`, Ralph CLI, OpenSpec/Superpowers integration points

---

## Scope And Constraints

- The current codebase already has a good state-machine core in [lib/pipeline-state.js](D:/project/AI-Coding/ralph-longtask/lib/pipeline-state.js) and orchestration shell in [lib/pipeline-cli.js](D:/project/AI-Coding/ralph-longtask/lib/pipeline-cli.js).
- The biggest gap is not state tracking. It is the missing action layer between "phase selected" and "artifact produced".
- Do not overbuild a generic workflow engine. Keep the pipeline action API narrow and specific to `spec`, `review`, `convert`, and `execute`.
- Preserve existing CLI semantics unless a change is necessary to remove a false promise in docs or skills.
- Prefer small, testable modules over adding more branching to [lib/pipeline-cli.js](D:/project/AI-Coding/ralph-longtask/lib/pipeline-cli.js).

## File Structure

**Create:**
- `D:/project/AI-Coding/ralph-longtask/lib/pipeline-actions.js`
- `D:/project/AI-Coding/ralph-longtask/lib/prd-converter.js`
- `D:/project/AI-Coding/ralph-longtask/lib/acceptance-runner.js`
- `D:/project/AI-Coding/ralph-longtask/test/prd-converter.test.js`
- `D:/project/AI-Coding/ralph-longtask/test/executor.test.js`

**Modify:**
- `D:/project/AI-Coding/ralph-longtask/lib/pipeline-cli.js`
- `D:/project/AI-Coding/ralph-longtask/lib/config.js`
- `D:/project/AI-Coding/ralph-longtask/lib/executor.js`
- `D:/project/AI-Coding/ralph-longtask/lib/validator.js`
- `D:/project/AI-Coding/ralph-longtask/lib/prompt-builder.js`
- `D:/project/AI-Coding/ralph-longtask/ralph.js`
- `D:/project/AI-Coding/ralph-longtask/test/pipeline-cli.test.js`
- `D:/project/AI-Coding/ralph-longtask/test/pipeline-orchestration.test.js`
- `D:/project/AI-Coding/ralph-longtask/test/validator.test.js`
- `D:/project/AI-Coding/ralph-longtask/test/prompt-builder.test.js`
- `D:/project/AI-Coding/ralph-longtask/README.md`
- `D:/project/AI-Coding/ralph-longtask/doc/PIPELINE_GUIDE.md`
- `D:/project/AI-Coding/ralph-longtask/doc/USER_GUIDE.md`
- `D:/project/AI-Coding/ralph-longtask/doc/ralph-cli.md`
- `D:/project/AI-Coding/ralph-longtask/skills/pipeline/SKILL.md`
- `D:/project/AI-Coding/ralph-longtask/skills/ralph/SKILL.md`
- `D:/project/AI-Coding/ralph-longtask/skills/prd/SKILL.md`

**Primary test targets:**
- `D:/project/AI-Coding/ralph-longtask/test/pipeline-cli.test.js`
- `D:/project/AI-Coding/ralph-longtask/test/pipeline-orchestration.test.js`
- `D:/project/AI-Coding/ralph-longtask/test/prd-converter.test.js`
- `D:/project/AI-Coding/ralph-longtask/test/executor.test.js`
- `D:/project/AI-Coding/ralph-longtask/test/validator.test.js`

---

## Batch 1: Make Pipeline Actually Automate

### Task 1: Align Product Surface Before Refactor

**Files:**
- Modify: `D:/project/AI-Coding/ralph-longtask/README.md`
- Modify: `D:/project/AI-Coding/ralph-longtask/doc/PIPELINE_GUIDE.md`
- Modify: `D:/project/AI-Coding/ralph-longtask/skills/pipeline/SKILL.md`

- [ ] Define the intended contract for `pipeline skill` vs `ralph pipeline` CLI in one short design note at the top of the plan branch or in working notes.
- [ ] Update wording in the touched docs so current behavior is described honestly before code changes start, or add "planned behavior" labels where temporary mismatch is unavoidable during implementation.
- [ ] Decide whether interactive gates are skill-only or also a CLI concern, and keep that decision consistent across all touched docs.
- [ ] Run: `npm test`
Expected: existing suite still passes before refactor begins.

### Task 2: Extract Pipeline Phase Actions

**Files:**
- Create: `D:/project/AI-Coding/ralph-longtask/lib/pipeline-actions.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/pipeline-cli.js`
- Test: `D:/project/AI-Coding/ralph-longtask/test/pipeline-cli.test.js`

- [ ] Write failing tests for the new action boundary: one action per phase, each returning a normalized result object.
- [ ] Move phase-specific behavior out of `orchestratePipeline()` into helpers such as `runSpecPhase`, `runReviewPhase`, `runConvertPhase`, and `runExecutePhase`.
- [ ] Keep `orchestratePipeline()` responsible only for state loading, phase selection, phase execution, and state advancement.
- [ ] Run: `node --test test/pipeline-cli.test.js test/pipeline-orchestration.test.js`
Expected: refactor preserves current green behavior.

### Task 3: Implement Real Spec Phase Execution

**Files:**
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/pipeline-actions.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/pipeline-cli.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/skills/pipeline/SKILL.md`
- Test: `D:/project/AI-Coding/ralph-longtask/test/pipeline-orchestration.test.js`

- [ ] Add a spec-phase execution path that does more than artifact detection when OpenSpec is available.
- [ ] Support degraded behavior that explicitly creates or delegates toward a PRD path when OpenSpec is unavailable, instead of silently blocking.
- [ ] Ensure the result records produced artifact paths in pipeline metadata for later phases.
- [ ] Add tests for both "OpenSpec available" and "OpenSpec unavailable" branches.
- [ ] Run: `node --test test/pipeline-orchestration.test.js`
Expected: a fresh pipeline can reach `review` or an equivalent degraded next step without manual file placement.

### Task 4: Implement Real Review Phase And PRD Generation

**Files:**
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/pipeline-actions.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/pipeline-cli.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/skills/pipeline/SKILL.md`
- Modify: `D:/project/AI-Coding/ralph-longtask/skills/prd/SKILL.md`
- Test: `D:/project/AI-Coding/ralph-longtask/test/pipeline-orchestration.test.js`

- [ ] Add a review-phase path that can synthesize a PRD markdown file from spec artifacts using either Superpowers-enhanced review or the built-in checklist.
- [ ] Normalize PRD output location so later phases can trust one metadata field rather than re-globbing ad hoc.
- [ ] Make failure modes explicit: missing design/tasks, ambiguous feature match, generation failure.
- [ ] Add tests that prove review no longer depends on a pre-existing manually created `tasks/prd-*.md`.
- [ ] Run: `node --test test/pipeline-orchestration.test.js test/pipeline-cli.test.js`
Expected: pipeline can reach `convert` after review execution.

### Task 5: Add PRD Markdown To prd.json Conversion

**Files:**
- Create: `D:/project/AI-Coding/ralph-longtask/lib/prd-converter.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/pipeline-actions.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/pipeline-cli.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/skills/ralph/SKILL.md`
- Test: `D:/project/AI-Coding/ralph-longtask/test/prd-converter.test.js`
- Test: `D:/project/AI-Coding/ralph-longtask/test/pipeline-orchestration.test.js`

- [ ] Write failing parser tests for extracting user stories, acceptance criteria, and non-goals from the expected PRD markdown shape.
- [ ] Convert PRD markdown into canonical `prd.json` fields: `project`, `branchName`, `description`, `userStories`, `priority`, `passes`, and `notes`.
- [ ] Apply granularity checks during conversion and split oversized stories before saving.
- [ ] Preserve traceability by writing `parentTask` when a story is split during conversion.
- [ ] Update the convert phase so it generates `prd.json` if absent, then validates the result before advancing to `execute`.
- [ ] Run: `node --test test/prd-converter.test.js test/pipeline-orchestration.test.js`
Expected: pipeline reaches `ready_to_execute` from a PRD markdown input alone.

### Task 6: Lock In Batch 1 With End-To-End Tests

**Files:**
- Modify: `D:/project/AI-Coding/ralph-longtask/test/pipeline-cli.test.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/test/pipeline-orchestration.test.js`

- [ ] Add a happy-path test for `run` from feature input to `ready_to_execute`.
- [ ] Add degraded-path coverage for "no OpenSpec" and "no Superpowers".
- [ ] Add a resume-path test that proves pipeline state is enough to continue after interruption.
- [ ] Run: `npm test`
Expected: full suite passes and proves Batch 1 behavior.

**Batch 1 exit criteria**
- `ralph pipeline run <feature-name>` can progress to `execute` without manual creation of OpenSpec artifacts, PRD markdown, or `prd.json`.
- The docs no longer promise behavior the code does not implement.

---

## Batch 2: Harden Ralph Completion Semantics

### Task 7: Capture Claude Output And Completion Signal

**Files:**
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/executor.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/prompt-builder.js`
- Test: `D:/project/AI-Coding/ralph-longtask/test/executor.test.js`

- [ ] Write failing tests that simulate Claude output containing and not containing `<promise>COMPLETE</promise>`.
- [ ] Change the executor contract so it can stream to the terminal and still retain enough output for downstream validation.
- [ ] Return structured execution metadata such as `completionSignaled`, `capturedStdout`, and `exitCode`.
- [ ] Keep the terminal UX real-time; do not regress inherited display behavior just to gain captured output.
- [ ] Run: `node --test test/executor.test.js`
Expected: completion signal detection is covered by tests and surfaced to callers.

### Task 8: Tighten Validator Pass Conditions

**Files:**
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/validator.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/ralph.js`
- Test: `D:/project/AI-Coding/ralph-longtask/test/validator.test.js`

- [ ] Write failing tests for these cases: commit exists but no completion signal, completion signal exists but no commit, session failed, wrong story commit.
- [ ] Update `runValidation()` to require session success, commit evidence, completion signal, and valid PRD structure before auto-patching `passes`.
- [ ] Pass the new executor metadata from `ralph.js` into `runValidation()`.
- [ ] Keep validation reasons specific so failures are actionable in `progress.txt`.
- [ ] Run: `node --test test/validator.test.js`
Expected: stories are no longer marked complete on commit evidence alone.

### Task 9: Add Minimal Executable Acceptance Checks

**Files:**
- Create: `D:/project/AI-Coding/ralph-longtask/lib/acceptance-runner.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/validator.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/config.js`
- Test: `D:/project/AI-Coding/ralph-longtask/test/validator.test.js`

- [ ] Introduce config-backed commands for at least `typecheck` and `tests`.
- [ ] Teach validation to recognize `Typecheck passes` and `Tests pass` acceptance criteria and run the corresponding commands when present.
- [ ] Keep the first implementation intentionally narrow; unsupported natural-language criteria should remain informational rather than pretending to be enforced.
- [ ] Add tests for command success, command failure, and stories with no executable criteria.
- [ ] Run: `node --test test/validator.test.js`
Expected: at least the two most common acceptance criteria become real checks.

### Task 10: Remove Dead Config And Add Prompt Size Guardrails

**Files:**
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/config.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/executor.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/lib/prompt-builder.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/ralph.js`
- Modify: `D:/project/AI-Coding/ralph-longtask/test/prompt-builder.test.js`

- [ ] Decide whether `claude.outputFormat` should be implemented or removed. Prefer removal unless there is a concrete near-term use for `stream-json`.
- [ ] Add a hard policy for oversized prompts: block execution with a clear error, or trim lower-priority context deterministically.
- [ ] Update tests so `oversized` is no longer a dead return value.
- [ ] Run: `node --test test/prompt-builder.test.js test/validator.test.js`
Expected: no config field remains documented without runtime effect, and prompt size risk is explicitly handled.

### Task 11: Documentation And Regression Sweep

**Files:**
- Modify: `D:/project/AI-Coding/ralph-longtask/README.md`
- Modify: `D:/project/AI-Coding/ralph-longtask/doc/USER_GUIDE.md`
- Modify: `D:/project/AI-Coding/ralph-longtask/doc/ralph-cli.md`
- Modify: `D:/project/AI-Coding/ralph-longtask/doc/PIPELINE_GUIDE.md`
- Modify: `D:/project/AI-Coding/ralph-longtask/skills/pipeline/SKILL.md`
- Modify: `D:/project/AI-Coding/ralph-longtask/skills/ralph/SKILL.md`

- [ ] Update all user-facing docs so they describe the new completion rules and Batch 1 automation behavior precisely.
- [ ] Add one short section explaining what evidence is required before Ralph marks a story complete.
- [ ] Remove or rewrite any instruction that still implies commit-only completion or manual artifact dependencies that no longer exist.
- [ ] Run: `npm test`
Expected: docs match behavior and the suite stays green.

**Batch 2 exit criteria**
- A story is not auto-patched to `passes: true` unless completion is explicitly signaled and minimally validated.
- Prompt oversize handling and runtime config behavior are explicit, tested, and documented.

---

## Verification Matrix

- `npm test`
- `node --test test/pipeline-cli.test.js test/pipeline-orchestration.test.js`
- `node --test test/prd-converter.test.js`
- `node --test test/executor.test.js`
- `node --test test/validator.test.js`
- Manual smoke:
  - `ralph pipeline run <feature-name>`
  - `ralph pipeline resume`
  - `ralph pipeline status`

## Final Definition Of Done

- `ralph pipeline run <feature-name>` can move from feature input to `execute` without requiring a human to manually create intermediate artifacts.
- `ralph --resume` and `ralph pipeline resume` behave predictably at pre-execute and execute stages.
- Ralph no longer marks a story complete based solely on a matching commit subject.
- The test suite proves the new automation and completion semantics.
- README, guides, and skills describe exactly what the shipped code does.
