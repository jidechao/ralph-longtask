import { execFileSync } from 'node:child_process';
import { loadPRD, validatePrdStructure, savePRD } from './prd.js';

/**
 * Run the full post-session validation pipeline.
 * Order: JSON structure → git commit check → auto-patch passes.
 *
 * @param {object} options
 * @param {string} options.prdPath - Path to prd.json
 * @param {string} options.storyId - Current story ID
 * @param {string} options.sessionStart - ISO timestamp of session start
 * @param {string} options.sessionEnd - ISO timestamp of session end
 * @param {object} options.validationConfig - validation section of config
 * @param {boolean} [options.sessionSuccess=true] - Whether the Claude session exited cleanly (exit code 0)
 * @returns {{ valid: boolean, reason?: string, patched?: boolean }}
 */
export function runValidation({ prdPath, storyId, sessionStart, sessionEnd, validationConfig, sessionSuccess = true }) {
  let prd;

  // Step 1: Load and optionally validate prd.json structure
  try {
    prd = loadPRD(prdPath);
  } catch (err) {
    return { valid: false, reason: 'invalid-json', error: err.message };
  }

  if (validationConfig.validatePrdSchema) {
    const structResult = validatePrdStructure(prd);
    if (!structResult.valid) {
      return { valid: false, ...structResult };
    }
  }

  // Step 2: Check git commit
  if (validationConfig.checkGitCommit) {
    const commitResult = checkGitCommit(storyId, sessionStart, sessionEnd);
    if (!commitResult.found) {
      console.warn(`Warning: No git commit found for ${storyId} in session window`);
      return { valid: false, reason: 'no-commit' };
    }
  }

  // Step 3: Auto-patch passes if needed (only when session succeeded)
  let patched = false;
  if (!sessionSuccess) {
    return { valid: false, reason: 'session-failed' };
  }

  if (validationConfig.patchPrdPasses) {
    const story = prd.userStories.find((s) => s.id === storyId);
    if (story && story.passes === false) {
      story.passes = true;
      savePRD(prdPath, prd);
      console.warn(`Warning: Auto-patched ${storyId} passes to true`);
      patched = true;
    }
  }

  return { valid: true, patched };
}

/**
 * Check if a git commit exists for the story within the session time window.
 */
function checkGitCommit(storyId, sessionStart, sessionEnd) {
  try {
    const output = execFileSync('git', [
      'log', '--since', sessionStart, '--until', sessionEnd, '--pretty=%s',
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const messages = output.trim().split('\n').filter(Boolean);
    const found = messages.some((msg) => msg.includes(storyId));
    return { found };
  } catch (err) {
    return { found: false, error: err.message };
  }
}
