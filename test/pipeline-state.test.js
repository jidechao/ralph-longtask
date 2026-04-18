import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STATE_FILE,
  PHASES,
  loadPipelineState,
  savePipelineState,
  advancePhase,
  clearPipelineState,
  getCurrentPhase,
} from '../lib/pipeline-state.js';

describe('pipeline-state', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'ralph-pipeline-test-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('loadPipelineState returns null when no state file exists', () => {
    const state = loadPipelineState(projectDir);
    assert.equal(state, null);
  });

  it('savePipelineState creates valid JSON file', () => {
    const state = { feature: 'test', completedPhases: [] };
    savePipelineState(projectDir, state);

    const filePath = join(projectDir, STATE_FILE);
    assert.ok(existsSync(filePath));

    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    assert.deepEqual(parsed, state);
  });

  it('savePipelineState creates parent directories if needed', () => {
    const nestedDir = join(projectDir, 'deep', 'nested');
    const state = { feature: 'test' };
    savePipelineState(nestedDir, state);

    const filePath = join(nestedDir, STATE_FILE);
    assert.ok(existsSync(filePath));
  });

  it('advancePhase adds phase to completedPhases in correct order', () => {
    const state1 = advancePhase(projectDir, 'spec');
    assert.deepEqual(state1.completedPhases, ['spec']);

    const state2 = advancePhase(projectDir, 'review');
    assert.deepEqual(state2.completedPhases, ['spec', 'review']);

    const state3 = advancePhase(projectDir, 'convert');
    assert.deepEqual(state3.completedPhases, ['spec', 'review', 'convert']);

    const state4 = advancePhase(projectDir, 'execute');
    assert.deepEqual(state4.completedPhases, ['spec', 'review', 'convert', 'execute']);
  });

  it('advancePhase rejects out-of-order phase', () => {
    assert.throws(
      () => advancePhase(projectDir, 'execute'),
      /Phase order violation/,
    );
  });

  it('advancePhase rejects invalid phase name', () => {
    assert.throws(
      () => advancePhase(projectDir, 'invalid'),
      /Invalid phase "invalid"/,
    );
  });

  it('advancePhase merges metadata into state.metadata', () => {
    const state1 = advancePhase(projectDir, 'spec', { prdPath: '/tmp/prd.json' });
    assert.equal(state1.metadata.prdPath, '/tmp/prd.json');

    const state2 = advancePhase(projectDir, 'review', { reviewer: 'bot' });
    assert.equal(state2.metadata.prdPath, '/tmp/prd.json');
    assert.equal(state2.metadata.reviewer, 'bot');
  });

  it('clearPipelineState removes the state file', () => {
    advancePhase(projectDir, 'spec');
    const filePath = join(projectDir, STATE_FILE);
    assert.ok(existsSync(filePath));

    clearPipelineState(projectDir);
    assert.ok(!existsSync(filePath));
  });

  it('clearPipelineState does not throw when no file exists', () => {
    assert.doesNotThrow(() => clearPipelineState(projectDir));
  });

  it('getCurrentPhase returns first incomplete phase', () => {
    const state = { completedPhases: ['spec'] };
    assert.equal(getCurrentPhase(state), 'review');
  });

  it('getCurrentPhase returns null when all phases complete', () => {
    const state = { completedPhases: ['spec', 'review', 'convert', 'execute'] };
    assert.equal(getCurrentPhase(state), null);
  });

  it('getCurrentPhase returns null when state is null', () => {
    assert.equal(getCurrentPhase(null), null);
  });

  it('advancePhase creates initial state if none exists', () => {
    const state = advancePhase(projectDir, 'spec', { feature: 'my-feature' });

    assert.equal(state.feature, '');
    assert.deepEqual(state.completedPhases, ['spec']);
    assert.equal(state.prdPath, null);
    assert.ok(state.lastUpdated);
    assert.equal(state.metadata.feature, 'my-feature');

    // Verify persisted state matches
    const loaded = loadPipelineState(projectDir);
    assert.deepEqual(loaded.completedPhases, ['spec']);
  });

  it('state file has correct schema after advancePhase', () => {
    advancePhase(projectDir, 'spec');
    const loaded = loadPipelineState(projectDir);

    assert.ok(typeof loaded.feature === 'string');
    assert.ok(Array.isArray(loaded.completedPhases));
    assert.ok(loaded.prdPath === null || typeof loaded.prdPath === 'string');
    assert.ok(typeof loaded.lastUpdated === 'string');
    assert.ok(typeof loaded.metadata === 'object');
    assert.ok(loaded.metadata !== null);
  });
});
