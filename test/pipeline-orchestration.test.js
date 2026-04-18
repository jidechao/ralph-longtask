import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../lib/config.js';
import { orchestratePipeline, archivePipelineLearnings } from '../lib/pipeline-cli.js';
import { savePipelineState, loadPipelineState } from '../lib/pipeline-state.js';
import {
  runSpecPhase,
  runReviewPhase,
  runConvertPhase,
  runExecutePhase,
} from '../lib/pipeline-actions.js';

function makeRalphConfig(dir, overrides = {}) {
  const config = {
    prdPath: './prd.json',
    progressPath: './progress.txt',
    ...overrides,
  };
  writeFileSync(join(dir, 'ralph.config.json'), JSON.stringify(config, null, 2), 'utf-8');
}

function makeProgressFile(dir) {
  writeFileSync(
    join(dir, 'progress.txt'),
    `# Ralph Progress Log
Started: 2026-04-18T11:00:00
---

## Codebase Patterns
- Prefer service-layer validation

## 2026-04-18T11:30:00 - US-001
- Implemented orchestration
- **Learnings for future iterations:**
  - Warning: keep phase transitions deterministic
  - Should archive learnings automatically
`,
    'utf-8',
  );
}

function makeSpecArtifacts(dir, feature = 'notifications') {
  const changeDir = join(dir, 'openspec', 'changes', feature);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(
    join(changeDir, 'design.md'),
    `# ${feature} design

## Summary
Add ${feature} controls for users.

## Goals
- Let users manage ${feature}
`,
    'utf-8',
  );
  writeFileSync(
    join(changeDir, 'tasks.md'),
    `# Tasks

- [ ] Create data model
- [ ] Add API endpoint
- [ ] Add UI flow
`,
    'utf-8',
  );
}

function makePrdMarkdown(dir, feature = 'notifications') {
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(
    join(dir, 'tasks', `prd-${feature}.md`),
    `# PRD: Notifications

## Introduction

Add notifications for users.

## User Stories

### US-001: Render notifications
**Description:** As a user, I want to view notifications so that I can stay updated.

**Acceptance Criteria:**
- [ ] Notifications list renders
- [ ] Empty state is shown
`,
    'utf-8',
  );
}

describe('pipeline orchestration', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'ralph-pipeline-orchestration-'));
    makeRalphConfig(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('auto-advances from spec into execute-ready when OpenSpec artifacts are already present', () => {
    mkdirSync(join(projectDir, 'openspec', 'changes', 'notifications'), { recursive: true });
    writeFileSync(join(projectDir, 'openspec', 'changes', 'notifications', 'design.md'), '# design', 'utf-8');
    writeFileSync(join(projectDir, 'openspec', 'changes', 'notifications', 'tasks.md'), '# tasks', 'utf-8');
    savePipelineState(projectDir, {
      feature: 'notifications',
      completedPhases: [],
      prdPath: null,
      lastUpdated: new Date().toISOString(),
      metadata: {},
    });

    const result = orchestratePipeline(projectDir, loadConfig(projectDir), { execute: false });
    const state = loadPipelineState(projectDir);

    assert.equal(result.status, 'ready_to_execute');
    assert.equal(result.phase, 'execute');
    assert.deepEqual(state.completedPhases, ['spec', 'review', 'convert']);
    assert.equal(state.metadata.specDir, 'openspec/changes/notifications');
    assert.equal(state.prdPath, 'tasks/prd-notifications.md');
    assert.ok(existsSync(join(projectDir, 'prd.json')));
  });

  it('auto-advances review and convert when a PRD markdown already exists', () => {
    makePrdMarkdown(projectDir, 'notifications');
    savePipelineState(projectDir, {
      feature: 'notifications',
      completedPhases: ['spec'],
      prdPath: null,
      lastUpdated: new Date().toISOString(),
      metadata: {},
    });

    const result = orchestratePipeline(projectDir, loadConfig(projectDir), { execute: false });
    const state = loadPipelineState(projectDir);

    assert.equal(result.status, 'ready_to_execute');
    assert.equal(result.phase, 'execute');
    assert.deepEqual(state.completedPhases, ['spec', 'review', 'convert']);
    assert.equal(state.prdPath, 'tasks/prd-notifications.md');
    assert.ok(existsSync(join(projectDir, 'prd.json')));
  });

  it('auto-generates PRD markdown during review when spec artifacts exist', () => {
    makeSpecArtifacts(projectDir);
    savePipelineState(projectDir, {
      feature: 'notifications',
      completedPhases: ['spec'],
      prdPath: null,
      lastUpdated: new Date().toISOString(),
      metadata: {
        specDir: 'openspec/changes/notifications',
      },
    });

    const result = orchestratePipeline(projectDir, loadConfig(projectDir), { execute: false });
    const state = loadPipelineState(projectDir);
    const prdPath = join(projectDir, 'tasks', 'prd-notifications.md');

    assert.equal(result.status, 'ready_to_execute');
    assert.equal(result.phase, 'execute');
    assert.deepEqual(state.completedPhases, ['spec', 'review', 'convert']);
    assert.equal(state.prdPath, 'tasks/prd-notifications.md');
    assert.equal(state.metadata.reviewMode, 'built-in-checklist');
    assert.ok(existsSync(prdPath));
    assert.ok(existsSync(join(projectDir, 'prd.json')));

    const content = readFileSync(prdPath, 'utf-8');
    assert.ok(content.includes('# PRD: Notifications'));
    assert.ok(content.includes('## User Stories'));
    assert.ok(content.includes('## Functional Requirements'));
  });

  it('ignores a mismatched single PRD markdown and generates one for the active feature', () => {
    makeSpecArtifacts(projectDir);
    mkdirSync(join(projectDir, 'tasks'), { recursive: true });
    writeFileSync(join(projectDir, 'tasks', 'prd-billing.md'), '# PRD: Billing', 'utf-8');
    savePipelineState(projectDir, {
      feature: 'notifications',
      completedPhases: ['spec'],
      prdPath: null,
      lastUpdated: new Date().toISOString(),
      metadata: {
        specDir: 'openspec/changes/notifications',
      },
    });

    const result = orchestratePipeline(projectDir, loadConfig(projectDir), { execute: false });
    const state = loadPipelineState(projectDir);

    assert.equal(result.status, 'ready_to_execute');
    assert.equal(result.phase, 'execute');
    assert.equal(state.prdPath, 'tasks/prd-notifications.md');
    assert.ok(existsSync(join(projectDir, 'tasks', 'prd-notifications.md')));
    assert.ok(existsSync(join(projectDir, 'prd.json')));
  });

  it('auto-advances convert and stops at execute when prd.json is ready', () => {
    writeFileSync(
      join(projectDir, 'prd.json'),
      JSON.stringify({
        project: 'test-project',
        branchName: 'ralph/notifications',
        description: 'Test project',
        userStories: [
          {
            id: 'US-001',
            title: 'Small task',
            description: 'Do one thing',
            acceptanceCriteria: ['Typecheck passes'],
            priority: 1,
            passes: false,
            notes: '',
          },
        ],
      }, null, 2),
      'utf-8',
    );
    savePipelineState(projectDir, {
      feature: 'notifications',
      completedPhases: ['spec', 'review'],
      prdPath: 'tasks/prd-notifications.md',
      lastUpdated: new Date().toISOString(),
      metadata: {},
    });

    const result = orchestratePipeline(projectDir, loadConfig(projectDir), { execute: false });
    const state = loadPipelineState(projectDir);

    assert.equal(result.status, 'ready_to_execute');
    assert.equal(result.phase, 'execute');
    assert.deepEqual(state.completedPhases, ['spec', 'review', 'convert']);
    assert.equal(state.metadata.storyCount, 1);
  });

  it('auto-generates prd.json during convert when review PRD markdown exists', () => {
    makePrdMarkdown(projectDir);
    savePipelineState(projectDir, {
      feature: 'notifications',
      completedPhases: ['spec', 'review'],
      prdPath: 'tasks/prd-notifications.md',
      lastUpdated: new Date().toISOString(),
      metadata: {},
    });

    const result = orchestratePipeline(projectDir, loadConfig(projectDir), { execute: false });
    const state = loadPipelineState(projectDir);
    const prd = JSON.parse(readFileSync(join(projectDir, 'prd.json'), 'utf-8'));

    assert.equal(result.status, 'ready_to_execute');
    assert.equal(result.phase, 'execute');
    assert.deepEqual(state.completedPhases, ['spec', 'review', 'convert']);
    assert.equal(state.metadata.storyCount, 1);
    assert.equal(prd.branchName, 'ralph/notifications');
    assert.equal(prd.userStories[0].passes, false);
  });

  it('archives learnings and records the output path in pipeline metadata', () => {
    makeProgressFile(projectDir);
    savePipelineState(projectDir, {
      feature: 'notifications',
      completedPhases: ['spec', 'review', 'convert', 'execute'],
      prdPath: 'tasks/prd-notifications.md',
      lastUpdated: new Date().toISOString(),
      metadata: {},
    });

    const result = archivePipelineLearnings(projectDir, loadConfig(projectDir));
    const state = loadPipelineState(projectDir);

    assert.equal(result.status, 'archived');
    assert.ok(result.path.endsWith('learnings.md'));
    assert.ok(existsSync(result.path));
    assert.equal(state.metadata.learningsPath, result.path);

    const content = readFileSync(result.path, 'utf-8');
    assert.ok(content.includes('# Learnings: notifications'));
    assert.ok(content.includes('## Codebase Patterns'));
  });
});

describe('pipeline phase actions', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'ralph-pipeline-actions-'));
    makeRalphConfig(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('runSpecPhase returns advance when expected artifacts exist', () => {
    mkdirSync(join(projectDir, 'openspec', 'changes', 'notifications'), { recursive: true });
    writeFileSync(join(projectDir, 'openspec', 'changes', 'notifications', 'design.md'), '# design', 'utf-8');
    writeFileSync(join(projectDir, 'openspec', 'changes', 'notifications', 'tasks.md'), '# tasks', 'utf-8');

    const result = runSpecPhase(projectDir, { feature: 'notifications' });

    assert.deepEqual(result, {
      status: 'advance',
      phase: 'spec',
      metadata: { specDir: 'openspec/changes/notifications' },
    });
  });

  it('runSpecPhase degrades to direct-prd when OpenSpec is unavailable and PRD markdown exists', () => {
    mkdirSync(join(projectDir, 'tasks'), { recursive: true });
    writeFileSync(join(projectDir, 'tasks', 'prd-notifications.md'), '# PRD', 'utf-8');

    const result = runSpecPhase(projectDir, { feature: 'notifications', prdPath: null }, {
      openSpec: { cliAvailable: false, skillsAvailable: false, changesDir: null },
    });

    assert.deepEqual(result, {
      status: 'advance',
      phase: 'spec',
      metadata: { specMode: 'direct-prd', specDir: null },
    });
  });

  it('runSpecPhase blocks with needs_prd_markdown when OpenSpec is unavailable and PRD markdown is missing', () => {
    const result = runSpecPhase(projectDir, { feature: 'notifications', prdPath: null }, {
      openSpec: { cliAvailable: false, skillsAvailable: false, changesDir: null },
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.phase, 'spec');
    assert.equal(result.reason, 'needs_prd_markdown');
    assert.deepEqual(result.candidates, []);
  });

  it('runSpecPhase attempts bootstrap when OpenSpec CLI is available and changes dir is missing', () => {
    const bootstrapCalls = [];
    const result = runSpecPhase(projectDir, { feature: 'notifications' }, {
      openSpec: { cliAvailable: true, skillsAvailable: false, changesDir: null },
      bootstrapOpenSpecProject: (dir) => {
        bootstrapCalls.push(dir);
        return { status: 'failed', error: 'simulated bootstrap failure' };
      },
    });

    assert.deepEqual(bootstrapCalls, [projectDir]);
    assert.equal(result.status, 'blocked');
    assert.equal(result.phase, 'spec');
    assert.equal(result.reason, 'spec_generation_required');
    assert.equal(result.metadata.specBootstrap, 'failed');
    assert.equal(result.metadata.bootstrapError, 'simulated bootstrap failure');
  });

  it('runSpecPhase re-detects artifacts after bootstrap and advances when generated', () => {
    const result = runSpecPhase(projectDir, { feature: 'notifications' }, {
      openSpec: { cliAvailable: true, skillsAvailable: false, changesDir: null },
      bootstrapOpenSpecProject: (dir) => {
        const changeDir = join(dir, 'openspec', 'changes', 'notifications');
        mkdirSync(changeDir, { recursive: true });
        writeFileSync(join(changeDir, 'design.md'), '# design', 'utf-8');
        writeFileSync(join(changeDir, 'tasks.md'), '# tasks', 'utf-8');
        return { status: 'initialized' };
      },
    });

    assert.deepEqual(result, {
      status: 'advance',
      phase: 'spec',
      metadata: {
        specDir: 'openspec/changes/notifications',
        specBootstrap: 'initialized',
      },
    });
  });

  it('runReviewPhase returns blocked when no PRD artifact exists', () => {
    const result = runReviewPhase(projectDir, { feature: 'notifications', prdPath: null });

    assert.equal(result.status, 'blocked');
    assert.equal(result.phase, 'review');
    assert.equal(result.reason, 'missing_spec_artifacts');
    assert.deepEqual(result.candidates, []);
  });

  it('runReviewPhase generates PRD markdown from spec artifacts when no PRD markdown exists', () => {
    makeSpecArtifacts(projectDir);

    const result = runReviewPhase(projectDir, {
      feature: 'notifications',
      prdPath: null,
      metadata: {
        specDir: 'openspec/changes/notifications',
      },
    }, {
      superpowers: { available: false, skills: [] },
    });

    assert.equal(result.status, 'advance');
    assert.equal(result.phase, 'review');
    assert.equal(result.metadata.prdPath, 'tasks/prd-notifications.md');
    assert.equal(result.metadata.reviewMode, 'built-in-checklist');
    assert.ok(existsSync(join(projectDir, 'tasks', 'prd-notifications.md')));
  });

  it('runReviewPhase blocks with generation_failed when PRD generation fails', () => {
    makeSpecArtifacts(projectDir);

    const result = runReviewPhase(projectDir, {
      feature: 'notifications',
      prdPath: null,
      metadata: {
        specDir: 'openspec/changes/notifications',
      },
    }, {
      generatePrdFromSpec: () => ({ status: 'failed', error: 'simulated failure' }),
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.phase, 'review');
    assert.equal(result.reason, 'generation_failed');
    assert.equal(result.metadata.generationError, 'simulated failure');
  });

  it('runReviewPhase blocks when multiple PRD candidates match ambiguously', () => {
    mkdirSync(join(projectDir, 'tasks'), { recursive: true });
    writeFileSync(join(projectDir, 'tasks', 'prd-notifications.md'), '# PRD', 'utf-8');
    writeFileSync(join(projectDir, 'tasks', 'prd-notifications-v2.md'), '# PRD', 'utf-8');

    const result = runReviewPhase(projectDir, {
      feature: 'notifications',
      prdPath: null,
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.phase, 'review');
    assert.equal(result.reason, 'ambiguous');
    assert.deepEqual(result.candidates, [
      'tasks/prd-notifications.md',
      'tasks/prd-notifications-v2.md',
    ]);
  });

  it('runConvertPhase returns advance when prd.json exists and passes granularity checks', () => {
    writeFileSync(
      join(projectDir, 'prd.json'),
      JSON.stringify({
        project: 'test-project',
        branchName: 'ralph/notifications',
        description: 'Test project',
        userStories: [
          {
            id: 'US-001',
            title: 'Small task',
            description: 'Do one thing',
            acceptanceCriteria: ['Typecheck passes'],
            priority: 1,
            passes: false,
            notes: '',
          },
        ],
      }, null, 2),
      'utf-8',
    );

    const result = runConvertPhase(projectDir, loadConfig(projectDir));

    assert.deepEqual(result, {
      status: 'advance',
      phase: 'convert',
      metadata: { storyCount: 1 },
    });
  });

  it('runConvertPhase auto-generates prd.json from PRD markdown when missing', () => {
    mkdirSync(join(projectDir, 'tasks'), { recursive: true });
    writeFileSync(
      join(projectDir, 'tasks', 'prd-notifications.md'),
      `# PRD: Notifications

## Introduction

Add notifications.

## User Stories

### US-001: Render notifications
**Description:** As a user, I want notifications so that I stay updated.

**Acceptance Criteria:**
- [ ] Notifications list renders
`,
      'utf-8',
    );

    const result = runConvertPhase(projectDir, loadConfig(projectDir), {
      feature: 'notifications',
      prdPath: 'tasks/prd-notifications.md',
    });

    assert.deepEqual(result, {
      status: 'advance',
      phase: 'convert',
      metadata: { storyCount: 1 },
    });
    assert.ok(existsSync(join(projectDir, 'prd.json')));

    const generated = JSON.parse(readFileSync(join(projectDir, 'prd.json'), 'utf-8'));
    assert.equal(generated.branchName, 'ralph/notifications');
    assert.equal(generated.userStories[0].priority, 1);
    assert.equal(generated.userStories[0].passes, false);
    assert.equal(generated.userStories[0].notes, '');
    assert.ok(generated.userStories[0].acceptanceCriteria.includes('Typecheck passes'));
  });

  it('runConvertPhase generates prd.json from PRD markdown when needed', () => {
    makePrdMarkdown(projectDir);

    const result = runConvertPhase(projectDir, loadConfig(projectDir), {
      feature: 'notifications',
      prdPath: 'tasks/prd-notifications.md',
      metadata: {},
    });

    assert.equal(result.status, 'advance');
    assert.equal(result.phase, 'convert');
    assert.equal(result.metadata.storyCount, 1);
    assert.ok(existsSync(join(projectDir, 'prd.json')));
  });

  it('runExecutePhase returns a normalized execute action when execution should start', () => {
    const result = runExecutePhase(projectDir, { metadata: {} }, true);

    assert.equal(result.status, 'launch');
    assert.equal(result.phase, 'execute');
    assert.equal(result.resumeExecution, false);
    assert.equal(typeof result.metadata.executionStartedAt, 'string');
  });
});

describe('pipeline orchestration OpenSpec injection', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'ralph-pipeline-open-spec-injection-'));
    makeRalphConfig(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('uses injected OpenSpec detection in spec phase', () => {
    makePrdMarkdown(projectDir, 'notifications');
    savePipelineState(projectDir, {
      feature: 'notifications',
      completedPhases: [],
      prdPath: null,
      lastUpdated: new Date().toISOString(),
      metadata: {},
    });

    const result = orchestratePipeline(projectDir, loadConfig(projectDir), {
      execute: false,
      openSpec: { cliAvailable: false, skillsAvailable: false, changesDir: null },
    });
    const state = loadPipelineState(projectDir);

    assert.equal(result.status, 'ready_to_execute');
    assert.equal(result.phase, 'execute');
    assert.deepEqual(state.completedPhases, ['spec', 'review', 'convert']);
    assert.equal(state.metadata.specMode, 'direct-prd');
    assert.equal(state.metadata.specDir, null);
    assert.ok(existsSync(join(projectDir, 'prd.json')));
  });
});
