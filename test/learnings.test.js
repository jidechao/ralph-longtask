import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractLearnings,
  formatLearningsMarkdown,
  writeLearnings,
} from '../lib/learnings.js';

const SAMPLE_PROGRESS = `# Ralph Progress Log

## Codebase Patterns
- Use sql<number> template for aggregations
- Always use IF NOT EXISTS for migrations
- Export types from actions.ts for UI components

## 2026-01-15 10:00 - US-001
- Implemented user auth
- Files changed: auth.ts, auth.test.ts
- **Learnings for future iterations:**
  - Warning: the token expires in 1 hour, don't forget to refresh
  - Gotcha: the API returns 404 when user has no profile
  - Should validate input before calling the service
  - Recommend using retry logic for flaky endpoints
  - The middleware order matters for auth
  - Make sure to clear the cache after profile update

---

## 2026-01-16 14:00 - US-002
- Implemented dashboard
- Files changed: dashboard.tsx
- **Lessons for future iterations:**
  - Avoid using inline styles in production components
  - We should add E2E tests for this feature
  - Pitfall: the chart library mutates input data
  - [FAILED] attempted to use CSS modules but they aren't configured

---
`;

describe('learnings', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ralph-learnings-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts all sections from a full progress.txt', () => {
    const progressPath = join(tempDir, 'progress.txt');
    writeFileSync(progressPath, SAMPLE_PROGRESS, 'utf-8');

    const result = extractLearnings(progressPath);

    assert.ok(result.patterns.length > 0, 'should have patterns');
    assert.ok(result.gotchas.length > 0, 'should have gotchas');
    assert.ok(result.recommendations.length > 0, 'should have recommendations');
  });

  it('extracts patterns from Codebase Patterns section', () => {
    const progressPath = join(tempDir, 'progress.txt');
    writeFileSync(progressPath, SAMPLE_PROGRESS, 'utf-8');

    const result = extractLearnings(progressPath);

    assert.equal(result.patterns.length, 3);
    assert.ok(result.patterns[0].includes('sql<number>'));
    assert.ok(result.patterns[1].includes('IF NOT EXISTS'));
    assert.ok(result.patterns[2].includes('Export types'));
  });

  it('extracts gotchas from learnings with warning keywords', () => {
    const progressPath = join(tempDir, 'progress.txt');
    writeFileSync(progressPath, SAMPLE_PROGRESS, 'utf-8');

    const result = extractLearnings(progressPath);

    // "Warning:", "Gotcha:", "don't forget", "Make sure", "Avoid", "Pitfall:", "[FAILED]"
    assert.ok(result.gotchas.length >= 5, `expected >= 5 gotchas, got ${result.gotchas.length}`);
    assert.ok(result.gotchas.some((g) => g.includes('Warning')));
    assert.ok(result.gotchas.some((g) => g.includes('Gotcha')));
    assert.ok(result.gotchas.some((g) => g.includes('Make sure')));
    assert.ok(result.gotchas.some((g) => g.includes('Avoid')));
    assert.ok(result.gotchas.some((g) => g.includes('Pitfall')));
    // [FAILED] marker should be stripped
    assert.ok(
      result.gotchas.some((g) => g.includes('attempted') && !g.includes('[FAILED]'))
    );
  });

  it('extracts recommendations from learnings with should/recommend keywords', () => {
    const progressPath = join(tempDir, 'progress.txt');
    writeFileSync(progressPath, SAMPLE_PROGRESS, 'utf-8');

    const result = extractLearnings(progressPath);

    assert.ok(result.recommendations.length >= 2, `expected >= 2 recommendations, got ${result.recommendations.length}`);
    assert.ok(result.recommendations.some((r) => r.includes('Should validate')));
    assert.ok(result.recommendations.some((r) => r.includes('Recommend using')));
    assert.ok(result.recommendations.some((r) => r.includes('should add E2E')));
  });

  it('returns empty arrays for empty file', () => {
    const progressPath = join(tempDir, 'progress.txt');
    writeFileSync(progressPath, '', 'utf-8');

    const result = extractLearnings(progressPath);

    assert.deepEqual(result, { patterns: [], gotchas: [], recommendations: [] });
  });

  it('returns empty arrays for nonexistent file', () => {
    const progressPath = join(tempDir, 'nonexistent.txt');

    const result = extractLearnings(progressPath);

    assert.deepEqual(result, { patterns: [], gotchas: [], recommendations: [] });
  });

  it('formatLearningsMarkdown produces correct markdown structure', () => {
    const learnings = {
      patterns: ['- pattern one', '- pattern two'],
      gotchas: ['- gotcha one'],
      recommendations: ['- recommendation one', '- recommendation two'],
    };

    const md = formatLearningsMarkdown('auth', learnings);

    assert.ok(md.startsWith('# Learnings: auth'));
    assert.ok(md.includes('Date:'));
    assert.ok(md.includes('## Codebase Patterns'));
    assert.ok(md.includes('- pattern one'));
    assert.ok(md.includes('- pattern two'));
    assert.ok(md.includes('## Gotchas'));
    assert.ok(md.includes('- gotcha one'));
    assert.ok(md.includes('## Recommendations for Future Specs'));
    assert.ok(md.includes('- recommendation one'));
    assert.ok(md.includes('- recommendation two'));
  });

  it('formatLearningsMarkdown skips empty sections', () => {
    const learnings = {
      patterns: [],
      gotchas: ['- a gotcha'],
      recommendations: [],
    };

    const md = formatLearningsMarkdown('feature', learnings);

    assert.ok(!md.includes('## Codebase Patterns'));
    assert.ok(md.includes('## Gotchas'));
    assert.ok(!md.includes('## Recommendations for Future Specs'));
  });

  it('writeLearnings writes to local archive path when no openspec dir', () => {
    const result = writeLearnings(tempDir, 'my-feature', {
      patterns: ['- a pattern'],
      gotchas: [],
      recommendations: [],
    });

    assert.ok(result.includes('archive'), `path should contain 'archive': ${result}`);
    assert.ok(result.includes('my-feature'));
    assert.ok(result.endsWith('learnings.md'));

    // File should exist and be readable
    const content = readFileSync(result, 'utf-8');
    assert.ok(content.includes('# Learnings: my-feature'));
    assert.ok(content.includes('- a pattern'));
  });

  it('writeLearnings writes to openspec archive path when directory exists', () => {
    const openspecDir = join(tempDir, 'openspec', 'changes', 'archive');
    mkdirSync(openspecDir, { recursive: true });

    const result = writeLearnings(tempDir, 'cool-feature', {
      patterns: [],
      gotchas: ['- warning: something'],
      recommendations: [],
    });

    assert.ok(result.includes('openspec'), `path should contain 'openspec': ${result}`);
    assert.ok(result.includes('cool-feature'));

    const content = readFileSync(result, 'utf-8');
    assert.ok(content.includes('- warning: something'));
  });

  it('writeLearnings creates parent directories', () => {
    // No archive directory exists yet
    const result = writeLearnings(tempDir, 'nested-test', {
      patterns: [],
      gotchas: [],
      recommendations: ['- should do this'],
    });

    // File should still be created successfully
    assert.ok(result.endsWith('learnings.md'));
    const content = readFileSync(result, 'utf-8');
    assert.ok(content.includes('- should do this'));
  });

  it('writeLearnings returns the written file path', () => {
    const result = writeLearnings(tempDir, 'path-test', {
      patterns: [],
      gotchas: [],
      recommendations: [],
    });

    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
    assert.ok(result.includes('path-test'));
    assert.ok(result.includes('learnings.md'));
  });
});
