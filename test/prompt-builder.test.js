import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPrompt, ensureStoryWithinLimit } from '../lib/prompt-builder.js';

/** Convert a local path to forward-slash form for glob patterns (Windows compat) */
function toPosix(p) { return p.split(sep).join('/'); }

const TEST_DIR = join(tmpdir(), `ralph-test-prompt-${Date.now()}`);

const SAMPLE_STORY = {
  id: 'US-001',
  title: 'Test story',
  description: 'A test story description',
  acceptanceCriteria: ['Criteria 1', 'Criteria 2'],
  priority: 1,
  notes: 'Some notes',
};

const DEFAULT_PROMPTS_CONFIG = {
  agentInstructionPath: null,
  extraContextPaths: [],
  extraInstructions: '',
  strictSingleStory: true,
};

describe('prompt-builder', () => {
  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('includes task section with story details', async () => {
    const { prompt } = await buildPrompt(SAMPLE_STORY, DEFAULT_PROMPTS_CONFIG);
    assert.ok(prompt.includes('US-001'));
    assert.ok(prompt.includes('Test story'));
    assert.ok(prompt.includes('A test story description'));
    assert.ok(prompt.includes('Criteria 1'));
  });

  it('includes strict single-story header by default', async () => {
    const { prompt } = await buildPrompt(SAMPLE_STORY, DEFAULT_PROMPTS_CONFIG);
    assert.ok(prompt.includes('STRICT SINGLE-STORY PROTOCOL'));
  });

  it('omits strict header when disabled', async () => {
    const { prompt } = await buildPrompt(SAMPLE_STORY, {
      ...DEFAULT_PROMPTS_CONFIG,
      strictSingleStory: false,
    });
    assert.ok(!prompt.includes('STRICT SINGLE-STORY PROTOCOL'));
  });

  it('includes project context from PRD', async () => {
    const prd = {
      project: 'test-project',
      branchName: 'feature/test',
      description: 'A test project',
    };
    const { prompt } = await buildPrompt(SAMPLE_STORY, DEFAULT_PROMPTS_CONFIG, prd);
    assert.ok(prompt.includes('test-project'));
    assert.ok(prompt.includes('feature/test'));
    assert.ok(prompt.includes('A test project'));
  });

  it('loads global instructions from file', async () => {
    const instrPath = join(TEST_DIR, 'instructions.md');
    writeFileSync(instrPath, 'Custom agent instructions here');
    const { prompt } = await buildPrompt(SAMPLE_STORY, {
      ...DEFAULT_PROMPTS_CONFIG,
      agentInstructionPath: instrPath,
    });
    assert.ok(prompt.includes('Custom agent instructions here'));
  });

  it('loads extra context via glob patterns', async () => {
    const ctxDir = join(TEST_DIR, 'ctx');
    mkdirSync(ctxDir, { recursive: true });
    writeFileSync(join(ctxDir, 'a.md'), 'Context A');
    writeFileSync(join(ctxDir, 'b.md'), 'Context B');

    const { prompt } = await buildPrompt(SAMPLE_STORY, {
      ...DEFAULT_PROMPTS_CONFIG,
      extraContextPaths: [toPosix(join(ctxDir, '*.md'))],
    });
    assert.ok(prompt.includes('Context A'));
    assert.ok(prompt.includes('Context B'));
  });

  it('includes extra instructions text', async () => {
    const { prompt } = await buildPrompt(SAMPLE_STORY, {
      ...DEFAULT_PROMPTS_CONFIG,
      extraInstructions: 'Follow TDD strictly',
    });
    assert.ok(prompt.includes('Follow TDD strictly'));
  });

  it('reports charCount correctly', async () => {
    const longStory = {
      ...SAMPLE_STORY,
      description: 'X'.repeat(7000),
    };
    const { charCount } = await buildPrompt(longStory, DEFAULT_PROMPTS_CONFIG);
    assert.ok(charCount > 6000);
  });

  it('throws when a story itself exceeds the limit', () => {
    const longStory = {
      ...SAMPLE_STORY,
      description: 'X'.repeat(7000),
    };

    assert.throws(
      () => ensureStoryWithinLimit(longStory),
      /Story US-001 too large/,
    );
  });

  it('counts sourceCount correctly', async () => {
    const { sourceCount } = await buildPrompt(SAMPLE_STORY, DEFAULT_PROMPTS_CONFIG);
    // strict header + task = 2
    assert.equal(sourceCount, 2);
  });

  it('works with minimal story (id + title + passes)', async () => {
    const minimal = { id: 'US-002', title: 'Minimal', passes: false };
    const { prompt } = await buildPrompt(minimal, DEFAULT_PROMPTS_CONFIG);
    assert.ok(prompt.includes('US-002'));
    assert.ok(prompt.includes('Minimal'));
  });
});
