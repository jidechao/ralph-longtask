import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Functions under test
import { detectOpenSpec, detectSuperpowers, runPipelineCommand } from '../lib/pipeline-cli.js';
import {
  runSpecPhase,
  runReviewPhase,
  runConvertPhase,
  runExecutePhase,
} from '../lib/pipeline-actions.js';
import { loadPipelineState } from '../lib/pipeline-state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'ralph-pipeline-cli-test-'));
}

function makePrdJson(dir, stories = []) {
  const prd = {
    project: 'test-project',
    branchName: 'feature/test',
    description: 'Test project',
    userStories: stories,
  };
  writeFileSync(join(dir, 'prd.json'), JSON.stringify(prd, null, 2), 'utf-8');
}

function makeRalphConfig(dir, overrides = {}) {
  const config = {
    prdPath: './prd.json',
    progressPath: './progress.txt',
    ...overrides,
  };
  writeFileSync(join(dir, 'ralph.config.json'), JSON.stringify(config, null, 2), 'utf-8');
}

function makeSpecArtifacts(dir, feature = 'notifications') {
  const changeDir = join(dir, 'openspec', 'changes', feature);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'design.md'), '# design', 'utf-8');
  writeFileSync(join(changeDir, 'tasks.md'), '# tasks', 'utf-8');
}

function makePrdMarkdown(dir, feature = 'notifications') {
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(
    join(dir, 'tasks', `prd-${feature}.md`),
    `# PRD: Notifications

## Introduction

Add notifications so users can stay updated.

## User Stories

### US-001: Render notifications
**Description:** As a user, I want notifications so that I can stay updated.

**Acceptance Criteria:**
- [ ] Notifications list renders
`,
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// detectOpenSpec
// ---------------------------------------------------------------------------

describe('detectOpenSpec', () => {
  it('returns cliAvailable false when openspec CLI is not installed', () => {
    const dir = makeTmpDir();
    try {
      const result = detectOpenSpec(dir);
      // In test environments openspec is typically not installed
      assert.equal(typeof result.cliAvailable, 'boolean');
      assert.equal(typeof result.skillsAvailable, 'boolean');
      assert.equal(result.changesDir, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects openspec/changes/ directory', () => {
    const dir = makeTmpDir();
    try {
      mkdirSync(join(dir, 'openspec', 'changes'), { recursive: true });
      const result = detectOpenSpec(dir);
      assert.notEqual(result.changesDir, null);
      assert.ok(result.changesDir.includes('openspec'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null changesDir when directory does not exist', () => {
    const dir = makeTmpDir();
    try {
      const result = detectOpenSpec(dir);
      assert.equal(result.changesDir, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// detectSuperpowers
// ---------------------------------------------------------------------------

describe('detectSuperpowers', () => {
  it('returns an object with available boolean and skills array', () => {
    const result = detectSuperpowers();
    assert.equal(typeof result.available, 'boolean');
    assert.ok(Array.isArray(result.skills));
  });
});

// ---------------------------------------------------------------------------
// pipeline actions
// ---------------------------------------------------------------------------

describe('pipeline actions', () => {
  it('returns an advance action for spec when OpenSpec artifacts already exist', () => {
    const dir = makeTmpDir();
    try {
      mkdirSync(join(dir, 'openspec', 'changes', 'notifications'), { recursive: true });
      writeFileSync(join(dir, 'openspec', 'changes', 'notifications', 'design.md'), '# design', 'utf-8');
      writeFileSync(join(dir, 'openspec', 'changes', 'notifications', 'tasks.md'), '# tasks', 'utf-8');

      const result = runSpecPhase(dir, { feature: 'notifications' });

      assert.equal(result.status, 'advance');
      assert.equal(result.metadata.specDir, 'openspec/changes/notifications');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an advance action for review when a PRD markdown already exists', () => {
    const dir = makeTmpDir();
    try {
      mkdirSync(join(dir, 'tasks'), { recursive: true });
      writeFileSync(join(dir, 'tasks', 'prd-notifications.md'), '# PRD', 'utf-8');

      const result = runReviewPhase(dir, {
        feature: 'notifications',
        prdPath: null,
      });

      assert.equal(result.status, 'advance');
      assert.equal(result.metadata.prdPath, 'tasks/prd-notifications.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates a PRD markdown during review when spec artifacts exist', () => {
    const dir = makeTmpDir();
    try {
      makeSpecArtifacts(dir);

      const result = runReviewPhase(dir, {
        feature: 'notifications',
        prdPath: null,
        metadata: {
          specDir: 'openspec/changes/notifications',
        },
      }, {
        superpowers: { available: true, skills: ['superpowers:write-plan'] },
      });

      assert.equal(result.status, 'advance');
      assert.equal(result.metadata.prdPath, 'tasks/prd-notifications.md');
      assert.equal(result.metadata.reviewMode, 'superpowers-assisted');

      const content = readFileSync(join(dir, 'tasks', 'prd-notifications.md'), 'utf-8');
      assert.ok(content.includes('# PRD: Notifications'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a single mismatched PRD markdown and generates one for the active feature', () => {
    const dir = makeTmpDir();
    try {
      makeSpecArtifacts(dir);
      mkdirSync(join(dir, 'tasks'), { recursive: true });
      writeFileSync(join(dir, 'tasks', 'prd-billing.md'), '# PRD', 'utf-8');

      const result = runReviewPhase(dir, {
        feature: 'notifications',
        prdPath: null,
        metadata: {
          specDir: 'openspec/changes/notifications',
        },
      });

      assert.equal(result.status, 'advance');
      assert.equal(result.metadata.prdPath, 'tasks/prd-notifications.md');
      assert.ok(readFileSync(join(dir, 'tasks', 'prd-notifications.md'), 'utf-8').includes('# PRD: Notifications'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks convert when prd.json is missing', () => {
    const dir = makeTmpDir();
    try {
      const result = runConvertPhase(dir, { prdPath: './prd.json' });

      assert.equal(result.status, 'blocked');
      assert.equal(result.reason, 'missing_prd_json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns a launch action for execute when execution should start', () => {
    const dir = makeTmpDir();
    try {
      const result = runExecutePhase(dir, {
        metadata: {},
      }, true);

      assert.equal(result.status, 'launch');
      assert.equal(result.resumeExecution, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runPipelineCommand - status
// ---------------------------------------------------------------------------

describe('pipeline status', () => {
  it('shows "no pipeline" message when no state file exists', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    try {
      // Capture stdout
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      try {
        runPipelineCommand(['status', '--config', dir]);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      assert.ok(output.includes('No pipeline in progress'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runPipelineCommand - init
// ---------------------------------------------------------------------------

describe('pipeline init', () => {
  it('creates a pipeline state file', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    try {
      runPipelineCommand(['init', 'my-feature', '--config', dir]);

      const state = loadPipelineState(dir);
      assert.notEqual(state, null);
      assert.equal(state.feature, 'my-feature');
      assert.deepEqual(state.completedPhases, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects init without feature name', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    try {
      // Stub process.exit to prevent test termination
      const originalExit = process.exit;
      let exitCode = null;
      process.exit = (code) => { exitCode = code; };

      try {
        runPipelineCommand(['init', '--config', dir]);
      } finally {
        process.exit = originalExit;
      }

      assert.equal(exitCode, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runPipelineCommand - advance
// ---------------------------------------------------------------------------

describe('pipeline advance', () => {
  it('advances phase from spec to review', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    try {
      runPipelineCommand(['init', 'my-feature', '--config', dir]);
      runPipelineCommand(['advance', 'spec', '--config', dir]);

      const state = loadPipelineState(dir);
      assert.deepEqual(state.completedPhases, ['spec']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects out-of-order phase advance', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    try {
      runPipelineCommand(['init', 'my-feature', '--config', dir]);

      const originalExit = process.exit;
      let exitCode = null;
      process.exit = (code) => { exitCode = code; };

      try {
        runPipelineCommand(['advance', 'execute', '--config', dir]);
      } finally {
        process.exit = originalExit;
      }

      assert.equal(exitCode, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runPipelineCommand - check
// ---------------------------------------------------------------------------

describe('pipeline check', () => {
  it('reports all stories passing', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    makePrdJson(dir, [
      { id: 'US-001', title: 'Small task', description: 'Do one thing', acceptanceCriteria: ['A passes'], priority: 1, passes: false },
    ]);
    try {
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      try {
        runPipelineCommand(['check', '--config', dir]);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      assert.ok(output.includes('OK'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports violations for oversized stories', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    makePrdJson(dir, [
      {
        id: 'US-001',
        title: 'Big task',
        description: 'Add database table and API endpoint and UI component for notifications',
        acceptanceCriteria: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
        priority: 1,
        passes: false,
      },
    ]);
    try {
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      const originalExit = process.exit;
      let exitCode = null;
      process.exit = (code) => { exitCode = code; };

      try {
        runPipelineCommand(['check', '--config', dir]);
      } finally {
        console.log = originalLog;
        process.exit = originalExit;
      }

      const output = logs.join('\n');
      assert.ok(output.includes('FAIL') || output.includes('WARN'));
      assert.equal(exitCode, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runPipelineCommand - reset
// ---------------------------------------------------------------------------

describe('pipeline reset', () => {
  it('removes pipeline state file', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    try {
      runPipelineCommand(['init', 'my-feature', '--config', dir]);
      assert.notEqual(loadPipelineState(dir), null);

      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      try {
        runPipelineCommand(['reset', '--config', dir]);
      } finally {
        console.log = originalLog;
      }

      assert.equal(loadPipelineState(dir), null);
      const output = logs.join('\n');
      assert.ok(output.includes('cleared'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles reset when no state exists', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    try {
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      try {
        runPipelineCommand(['reset', '--config', dir]);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      assert.ok(output.includes('No pipeline state'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runPipelineCommand - unknown command
// ---------------------------------------------------------------------------

describe('pipeline unknown command', () => {
  it('shows help for unknown commands', () => {
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; };

    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));

    try {
      runPipelineCommand(['unknown-command']);
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }

    assert.equal(exitCode, 1);
    const output = errors.join('\n');
    assert.ok(output.includes('Unknown command'));
  });
});

// ---------------------------------------------------------------------------
// runPipelineCommand - blocked messaging
// ---------------------------------------------------------------------------

describe('pipeline blocked messaging', () => {
  it('prints guidance for needs_prd_markdown when OpenSpec is unavailable', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);

    const originalPath = process.env.PATH;
    process.env.PATH = '';

    try {
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      try {
        runPipelineCommand(['run', 'notifications', '--config', dir, '--no-execute']);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      assert.ok(output.includes('Pipeline paused at phase: spec'));
      assert.ok(output.includes('no PRD markdown artifact was found'));
      assert.ok(output.includes('tasks/prd-*.md'));
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints guidance for spec_generation_required when OpenSpec is available but artifacts are missing', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    mkdirSync(join(dir, '.claude', 'skills', 'openspec-test'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'openspec-test', 'SKILL.md'), '# openspec', 'utf-8');

    try {
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      try {
        runPipelineCommand(['run', 'notifications', '--config', dir, '--no-execute']);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      assert.ok(output.includes('Pipeline paused at phase: spec'));
      assert.ok(output.includes('spec artifacts are missing'));
      assert.ok(output.includes('Generate OpenSpec design/tasks artifacts'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runPipelineCommand - end-to-end happy paths
// ---------------------------------------------------------------------------

describe('pipeline end-to-end paths', () => {
  it('run initializes and reaches execute-ready through the direct-prd degraded path', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(
      join(dir, 'tasks', 'prd-notifications.md'),
      `# PRD: Notifications

## Introduction

Add notifications so users can stay updated.

## User Stories

### US-001: Render notifications
**Description:** As a user, I want notifications so that I can stay updated.

**Acceptance Criteria:**
- [ ] Notifications list renders
`,
      'utf-8',
    );

    const originalPath = process.env.PATH;
    process.env.PATH = '';

    try {
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      try {
        runPipelineCommand(['run', 'notifications', '--config', dir, '--no-execute']);
      } finally {
        console.log = originalLog;
      }

      const state = loadPipelineState(dir);
      const output = logs.join('\n');

      assert.deepEqual(state.completedPhases, ['spec', 'review', 'convert']);
      assert.equal(state.metadata.specMode, 'direct-prd');
      assert.ok(output.includes('ready to launch Ralph'));
      assert.ok(readFileSync(join(dir, 'prd.json'), 'utf-8').includes('"branchName": "ralph/notifications"'));
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('run reaches execute-ready without Superpowers by using the built-in review checklist', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    makeSpecArtifacts(dir);

    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;

    try {
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      try {
        runPipelineCommand(['run', 'notifications', '--config', dir, '--no-execute']);
      } finally {
        console.log = originalLog;
      }

      const state = loadPipelineState(dir);
      const output = logs.join('\n');

      assert.deepEqual(state.completedPhases, ['spec', 'review', 'convert']);
      assert.equal(state.metadata.reviewMode, 'built-in-checklist');
      assert.ok(output.includes('ready to launch Ralph'));
    } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resume continues a pre-execute pipeline to execute-ready', () => {
    const dir = makeTmpDir();
    makeRalphConfig(dir);
    makePrdMarkdown(dir);
    runPipelineCommand(['init', 'notifications', '--config', dir]);
    runPipelineCommand(['advance', 'spec', '--config', dir]);

    const originalLog = console.log;
    const logs = [];
    console.log = (...args) => logs.push(args.join(' '));

    try {
      runPipelineCommand(['resume', '--config', dir, '--no-execute']);
    } finally {
      console.log = originalLog;
    }

    const state = loadPipelineState(dir);
    const output = logs.join('\n');

    assert.deepEqual(state.completedPhases, ['spec', 'review', 'convert']);
    assert.ok(output.includes('ready to launch Ralph'));

    rmSync(dir, { recursive: true, force: true });
  });
});
