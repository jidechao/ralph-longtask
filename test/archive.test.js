import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkAndArchive } from '../lib/archive.js';

const TEST_DIR = join(tmpdir(), `ralph-test-archive-${Date.now()}`);

describe('archive', () => {
  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('does not archive when no last-branch file exists', () => {
    const result = checkAndArchive({
      configDir: TEST_DIR,
      prdPath: join(TEST_DIR, 'prd.json'),
      progressPath: join(TEST_DIR, 'progress.txt'),
      branchName: 'feature/new-thing',
    });
    assert.equal(result.archived, false);
    // Should have created .last-branch with new branch
    const lastBranch = readFileSync(join(TEST_DIR, '.last-branch'), 'utf-8').trim();
    assert.equal(lastBranch, 'feature/new-thing');
  });

  it('does not archive when branch is the same', () => {
    writeFileSync(join(TEST_DIR, '.last-branch'), 'feature/same-branch', 'utf-8');
    const result = checkAndArchive({
      configDir: TEST_DIR,
      prdPath: join(TEST_DIR, 'prd.json'),
      progressPath: join(TEST_DIR, 'progress.txt'),
      branchName: 'feature/same-branch',
    });
    assert.equal(result.archived, false);
  });

  it('archives when branch changes', () => {
    // Setup
    writeFileSync(join(TEST_DIR, '.last-branch'), 'feature/old-branch', 'utf-8');
    writeFileSync(join(TEST_DIR, 'prd.json'), '{"project":"test"}', 'utf-8');
    writeFileSync(join(TEST_DIR, 'progress.txt'), 'old progress content', 'utf-8');

    const result = checkAndArchive({
      configDir: TEST_DIR,
      prdPath: join(TEST_DIR, 'prd.json'),
      progressPath: join(TEST_DIR, 'progress.txt'),
      branchName: 'feature/new-branch',
    });

    assert.equal(result.archived, true);
    assert.ok(result.archivePath);
    assert.ok(existsSync(join(result.archivePath, 'prd.json')));
    assert.ok(existsSync(join(result.archivePath, 'progress.txt')));

    // Archived content should be old
    const archivedPrd = readFileSync(join(result.archivePath, 'prd.json'), 'utf-8');
    assert.equal(archivedPrd, '{"project":"test"}');

    const archivedProgress = readFileSync(join(result.archivePath, 'progress.txt'), 'utf-8');
    assert.equal(archivedProgress, 'old progress content');

    // Progress should be reset
    const newProgress = readFileSync(join(TEST_DIR, 'progress.txt'), 'utf-8');
    assert.ok(newProgress.startsWith('# Ralph Progress Log'));

    // .last-branch should be updated
    const lastBranch = readFileSync(join(TEST_DIR, '.last-branch'), 'utf-8').trim();
    assert.equal(lastBranch, 'feature/new-branch');

    // Cleanup archive
    rmSync(join(TEST_DIR, 'archive'), { recursive: true, force: true });
  });

  it('strips ralph/ prefix from branch name in archive folder', () => {
    writeFileSync(join(TEST_DIR, '.last-branch'), 'ralph/feature-old', 'utf-8');
    writeFileSync(join(TEST_DIR, 'prd.json'), '{"project":"test"}', 'utf-8');
    writeFileSync(join(TEST_DIR, 'progress.txt'), 'content', 'utf-8');

    const result = checkAndArchive({
      configDir: TEST_DIR,
      prdPath: join(TEST_DIR, 'prd.json'),
      progressPath: join(TEST_DIR, 'progress.txt'),
      branchName: 'feature/new',
    });

    assert.equal(result.archived, true);
    assert.ok(result.archivePath.includes('feature-old'));
    assert.ok(!result.archivePath.includes('ralph/'));

    // Cleanup
    rmSync(join(TEST_DIR, 'archive'), { recursive: true, force: true });
  });

  it('returns not archived when branchName is empty', () => {
    const result = checkAndArchive({
      configDir: TEST_DIR,
      prdPath: join(TEST_DIR, 'prd.json'),
      progressPath: join(TEST_DIR, 'progress.txt'),
      branchName: '',
    });
    assert.equal(result.archived, false);
  });

  it('works even if prd.json and progress.txt do not exist', () => {
    const cleanDir = join(TEST_DIR, 'clean');
    mkdirSync(cleanDir, { recursive: true });
    writeFileSync(join(cleanDir, '.last-branch'), 'old-branch', 'utf-8');

    const result = checkAndArchive({
      configDir: cleanDir,
      prdPath: join(cleanDir, 'prd.json'),
      progressPath: join(cleanDir, 'progress.txt'),
      branchName: 'new-branch',
    });

    assert.equal(result.archived, true);
    // Archive dir exists but files don't
    assert.ok(!existsSync(join(result.archivePath, 'prd.json')));
    assert.ok(!existsSync(join(result.archivePath, 'progress.txt')));

    // Cleanup
    rmSync(cleanDir, { recursive: true, force: true });
  });
});
