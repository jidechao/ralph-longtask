import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Get local date in YYYY-MM-DD format.
 */
function localDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Strip common prefixes (e.g. "ralph/") from branch name for folder naming.
 */
function sanitizeBranchName(branch) {
  return branch.replace(/^ralph\//, '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Check for branch change and archive previous run if needed.
 *
 * When the branchName in prd.json differs from the one stored in .last-branch:
 * 1. Archive prd.json and progress.txt to archive/YYYY-MM-DD-branchName/
 * 2. Reset progress.txt for the new run
 * 3. Update .last-branch with the new branchName
 *
 * @param {object} options
 * @param {string} options.configDir - Directory containing config files
 * @param {string} options.prdPath - Path to prd.json
 * @param {string} options.progressPath - Path to progress.txt
 * @param {string} options.branchName - Current branchName from prd.json
 * @returns {{ archived: boolean, archivePath?: string }}
 */
export function checkAndArchive({ configDir, prdPath, progressPath, branchName }) {
  const lastBranchFile = join(configDir, '.last-branch');

  // Read last branch
  let lastBranch = '';
  if (existsSync(lastBranchFile)) {
    lastBranch = readFileSync(lastBranchFile, 'utf-8').trim();
  }

  // No branch name or same branch — just track current branch
  if (!branchName) {
    return { archived: false };
  }

  // Update tracking file
  writeFileSync(lastBranchFile, branchName, 'utf-8');

  // No previous branch or same branch — no archive needed
  if (!lastBranch || lastBranch === branchName) {
    return { archived: false };
  }

  // Branch changed — archive previous run
  const archiveDir = join(configDir, 'archive');
  const folderName = sanitizeBranchName(lastBranch);
  const archivePath = join(archiveDir, `${localDate()}-${folderName}`);

  mkdirSync(archivePath, { recursive: true });

  if (existsSync(prdPath)) {
    copyFileSync(prdPath, join(archivePath, 'prd.json'));
  }
  if (existsSync(progressPath)) {
    copyFileSync(progressPath, join(archivePath, 'progress.txt'));
  }

  // Reset progress file for new run
  const header = `# Ralph Progress Log\nStarted: ${localISO()}\n---\n`;
  writeFileSync(progressPath, header, 'utf-8');

  return { archived: true, archivePath };
}

/**
 * Get local time in ISO 8601 format (not UTC).
 */
function localISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
