import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runValidation } from '../lib/validator.js';

const TEST_DIR = join(tmpdir(), `ralph-test-validator-${Date.now()}`);

const SAMPLE_PRD = {
  userStories: [
    { id: 'US-001', title: 'Test story', passes: false, priority: 1 },
  ],
};

const DEFAULT_VALIDATION_CONFIG = {
  checkGitCommit: false,
  patchPrdPasses: true,
  validatePrdSchema: true,
};

function writePrd(dir, prd) {
  const path = join(dir, 'prd.json');
  writeFileSync(path, JSON.stringify(prd));
  return path;
}

describe('validator', () => {
  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns valid for valid PRD with sessionSuccess', () => {
    const prdPath = writePrd(TEST_DIR, SAMPLE_PRD);
    const result = runValidation({
      prdPath,
      storyId: 'US-001',
      sessionStart: new Date().toISOString(),
      sessionEnd: new Date().toISOString(),
      validationConfig: DEFAULT_VALIDATION_CONFIG,
      sessionSuccess: true,
    });
    assert.equal(result.valid, true);
    assert.equal(result.patched, true);
  });

  it('returns invalid for corrupted JSON', () => {
    const prdPath = join(TEST_DIR, 'bad.json');
    writeFileSync(prdPath, '{ not valid json }');
    const result = runValidation({
      prdPath,
      storyId: 'US-001',
      sessionStart: new Date().toISOString(),
      sessionEnd: new Date().toISOString(),
      validationConfig: DEFAULT_VALIDATION_CONFIG,
      sessionSuccess: true,
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid-json');
  });

  it('returns session-failed when session was not successful', () => {
    const prdPath = writePrd(TEST_DIR, SAMPLE_PRD);
    const result = runValidation({
      prdPath,
      storyId: 'US-001',
      sessionStart: new Date().toISOString(),
      sessionEnd: new Date().toISOString(),
      validationConfig: DEFAULT_VALIDATION_CONFIG,
      sessionSuccess: false,
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'session-failed');
  });

  it('does not patch when session failed', () => {
    const prd = { userStories: [{ id: 'US-001', title: 'Test', passes: false }] };
    const prdPath = writePrd(TEST_DIR, prd);
    runValidation({
      prdPath,
      storyId: 'US-001',
      sessionStart: new Date().toISOString(),
      sessionEnd: new Date().toISOString(),
      validationConfig: DEFAULT_VALIDATION_CONFIG,
      sessionSuccess: false,
    });
    const reloaded = JSON.parse(readFileSync(prdPath, 'utf-8'));
    assert.equal(reloaded.userStories[0].passes, false);
  });

  it('skips validation when all checks disabled', () => {
    const prdPath = writePrd(TEST_DIR, SAMPLE_PRD);
    const result = runValidation({
      prdPath,
      storyId: 'US-001',
      sessionStart: new Date().toISOString(),
      sessionEnd: new Date().toISOString(),
      validationConfig: {
        checkGitCommit: false,
        patchPrdPasses: false,
        validatePrdSchema: false,
      },
      sessionSuccess: true,
    });
    assert.equal(result.valid, true);
    assert.equal(result.patched, false);
  });

  it('returns invalid for no-commit when checkGitCommit is enabled', () => {
    const prdPath = writePrd(TEST_DIR, SAMPLE_PRD);
    const farFuture = new Date('2099-01-01').toISOString();
    const result = runValidation({
      prdPath,
      storyId: 'US-999-NONEXISTENT',
      sessionStart: farFuture,
      sessionEnd: farFuture,
      validationConfig: {
        checkGitCommit: true,
        patchPrdPasses: true,
        validatePrdSchema: true,
      },
      sessionSuccess: true,
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'no-commit');
  });
});
