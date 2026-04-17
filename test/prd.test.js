import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPRD, getNextStory, savePRD, validatePrdStructure } from '../lib/prd.js';

const TEST_DIR = join(tmpdir(), `ralph-test-prd-${Date.now()}`);

const SAMPLE_PRD = {
  project: 'test-project',
  userStories: [
    { id: 'US-001', title: 'First story', passes: false, priority: 1 },
    { id: 'US-002', title: 'Second story', passes: false, priority: 2 },
    { id: 'US-003', title: 'Third story', passes: true, priority: 3 },
  ],
};

describe('prd', () => {
  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('loadPRD', () => {
    it('loads a valid PRD file', () => {
      const prdPath = join(TEST_DIR, 'prd.json');
      writeFileSync(prdPath, JSON.stringify(SAMPLE_PRD));
      const prd = loadPRD(prdPath);
      assert.deepEqual(prd.userStories.length, 3);
      assert.equal(prd.project, 'test-project');
    });

    it('throws when file not found', () => {
      assert.throws(
        () => loadPRD(join(TEST_DIR, 'nonexistent.json')),
        /not found/
      );
    });

    it('throws on invalid JSON', () => {
      const prdPath = join(TEST_DIR, 'bad.json');
      writeFileSync(prdPath, '{ invalid json }');
      assert.throws(
        () => loadPRD(prdPath),
        /parse error/
      );
    });
  });

  describe('getNextStory', () => {
    it('returns highest priority incomplete story', () => {
      const story = getNextStory(SAMPLE_PRD);
      assert.equal(story.id, 'US-001');
      assert.equal(story.priority, 1);
    });

    it('returns null when all stories pass', () => {
      const allPassed = {
        userStories: SAMPLE_PRD.userStories.map((s) => ({ ...s, passes: true })),
      };
      assert.equal(getNextStory(allPassed), null);
    });

    it('returns null for empty userStories', () => {
      assert.equal(getNextStory({ userStories: [] }), null);
    });

    it('returns null when userStories is missing', () => {
      assert.equal(getNextStory({}), null);
    });

    it('handles stories without priority (defaults to Infinity)', () => {
      const prd = {
        userStories: [
          { id: 'US-A', title: 'No priority', passes: false },
          { id: 'US-B', title: 'Has priority', passes: false, priority: 1 },
        ],
      };
      const story = getNextStory(prd);
      assert.equal(story.id, 'US-B');
    });
  });

  describe('savePRD', () => {
    it('saves and reloads correctly', () => {
      const prdPath = join(TEST_DIR, 'save-test.json');
      savePRD(prdPath, SAMPLE_PRD);
      const reloaded = loadPRD(prdPath);
      assert.deepEqual(reloaded, SAMPLE_PRD);
    });

    it('writes valid JSON', () => {
      const prdPath = join(TEST_DIR, 'json-test.json');
      savePRD(prdPath, SAMPLE_PRD);
      const raw = readFileSync(prdPath, 'utf-8');
      JSON.parse(raw);
    });
  });

  describe('validatePrdStructure', () => {
    it('returns valid for correct structure', () => {
      const result = validatePrdStructure(SAMPLE_PRD);
      assert.equal(result.valid, true);
    });

    it('returns invalid for missing userStories', () => {
      const result = validatePrdStructure({});
      assert.equal(result.valid, false);
      assert.equal(result.reason, 'missing-userStories');
    });

    it('returns invalid for missing id', () => {
      const result = validatePrdStructure({
        userStories: [{ title: 'test', passes: false }],
      });
      assert.equal(result.valid, false);
      assert.equal(result.reason, 'missing-field');
      assert.equal(result.field, 'id');
    });

    it('returns invalid for missing title', () => {
      const result = validatePrdStructure({
        userStories: [{ id: 'US-001', passes: false }],
      });
      assert.equal(result.valid, false);
      assert.equal(result.reason, 'missing-field');
      assert.equal(result.field, 'title');
    });

    it('returns invalid for missing passes', () => {
      const result = validatePrdStructure({
        userStories: [{ id: 'US-001', title: 'test' }],
      });
      assert.equal(result.valid, false);
      assert.equal(result.reason, 'missing-field');
      assert.equal(result.field, 'passes');
    });
  });
});
