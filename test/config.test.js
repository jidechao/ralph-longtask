import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, DEFAULTS } from '../lib/config.js';

const TEST_DIR = join(tmpdir(), `ralph-test-config-${Date.now()}`);

describe('config', () => {
  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clean env overrides between tests
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('RALPH_')) delete process.env[key];
    }
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig(TEST_DIR);
    assert.equal(config.maxIterations, DEFAULTS.maxIterations);
    assert.equal(config.cooldownSeconds, DEFAULTS.cooldownSeconds);
    assert.equal(config.permissionsMode, 'full');
    assert.equal(config.claude.maxTurns, DEFAULTS.claude.maxTurns);
    assert.equal(config.validation.checkGitCommit, true);
  });

  it('merges file config over defaults', () => {
    writeFileSync(join(TEST_DIR, 'ralph.config.json'), JSON.stringify({
      maxIterations: 5,
      permissionsMode: 'restricted',
    }));

    try {
      const config = loadConfig(TEST_DIR);
      assert.equal(config.maxIterations, 5);
      assert.equal(config.permissionsMode, 'restricted');
      assert.equal(config.cooldownSeconds, DEFAULTS.cooldownSeconds);
    } finally {
      rmSync(join(TEST_DIR, 'ralph.config.json'), { force: true });
    }
  });

  it('env vars override file config', () => {
    writeFileSync(join(TEST_DIR, 'ralph.config.json'), JSON.stringify({
      maxIterations: 5,
    }));

    process.env.RALPH_MAX_ITERATIONS = '20';

    try {
      const config = loadConfig(TEST_DIR);
      assert.equal(config.maxIterations, 20);
    } finally {
      rmSync(join(TEST_DIR, 'ralph.config.json'), { force: true });
    }
  });

  it('coerces env vars to numbers', () => {
    process.env.RALPH_COOLDOWN_SECONDS = '10';
    const config = loadConfig(TEST_DIR);
    assert.equal(config.cooldownSeconds, 10);
    assert.equal(typeof config.cooldownSeconds, 'number');
  });

  it('coerces env vars to booleans', () => {
    process.env.RALPH_PROMPTS_STRICT_SINGLE_STORY = 'false';
    const config = loadConfig(TEST_DIR);
    assert.equal(config.prompts.strictSingleStory, false);
  });

  it('falls back to full on invalid permissionsMode', () => {
    writeFileSync(join(TEST_DIR, 'ralph.config.json'), JSON.stringify({
      permissionsMode: 'invalid',
    }));

    try {
      const config = loadConfig(TEST_DIR);
      assert.equal(config.permissionsMode, 'full');
    } finally {
      rmSync(join(TEST_DIR, 'ralph.config.json'), { force: true });
    }
  });

  it('resolves relative paths against config dir', () => {
    writeFileSync(join(TEST_DIR, 'ralph.config.json'), JSON.stringify({
      prdPath: './data/prd.json',
    }));

    try {
      const config = loadConfig(TEST_DIR);
      assert.equal(config.prdPath, join(TEST_DIR, 'data', 'prd.json'));
    } finally {
      rmSync(join(TEST_DIR, 'ralph.config.json'), { force: true });
    }
  });

  it('throws on non-integer maxIterations', () => {
    writeFileSync(join(TEST_DIR, 'ralph.config.json'), JSON.stringify({
      maxIterations: 3.5,
    }));

    try {
      assert.throws(() => loadConfig(TEST_DIR), /must be an integer/);
    } finally {
      rmSync(join(TEST_DIR, 'ralph.config.json'), { force: true });
    }
  });

  it('throws on negative cooldownSeconds', () => {
    writeFileSync(join(TEST_DIR, 'ralph.config.json'), JSON.stringify({
      cooldownSeconds: -1,
    }));

    try {
      assert.throws(() => loadConfig(TEST_DIR), /non-negative/);
    } finally {
      rmSync(join(TEST_DIR, 'ralph.config.json'), { force: true });
    }
  });

  it('accepts permissionsMode restricted', () => {
    writeFileSync(join(TEST_DIR, 'ralph.config.json'), JSON.stringify({
      permissionsMode: 'restricted',
    }));

    try {
      const config = loadConfig(TEST_DIR);
      assert.equal(config.permissionsMode, 'restricted');
    } finally {
      rmSync(join(TEST_DIR, 'ralph.config.json'), { force: true });
    }
  });
});
