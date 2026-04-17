import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
  renameSync,
  existsSync,
} from 'node:fs';
import { platform } from 'node:os';

const IS_WINDOWS = platform() === 'win32';

/**
 * Read and parse a prd.json file.
 * @param {string} filePath - Absolute path to prd.json
 * @returns {object} Parsed PRD object
 * @throws {Error} If file not found or JSON parse error
 */
export function loadPRD(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`prd.json not found at: ${filePath}`);
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`prd.json parse error: ${err.message}`);
  }
}

/**
 * Find the highest-priority story where passes is false.
 * Lower priority number = higher priority.
 * @param {object} prd - Parsed PRD object
 * @returns {object|null} The next story to work on, or null if none
 */
export function getNextStory(prd) {
  if (!prd.userStories || !Array.isArray(prd.userStories) || prd.userStories.length === 0) {
    return null;
  }

  const incomplete = prd.userStories.filter((s) => s.passes === false);
  if (incomplete.length === 0) return null;

  // Sort by priority ascending (lower number = higher priority), return first
  incomplete.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));
  return incomplete[0];
}

/**
 * Save prd.json atomically (Windows-safe).
 * Strategy: write to temp file, then copyFileSync + unlinkSync on Windows,
 * or renameSync on Unix.
 * @param {string} filePath - Absolute path to prd.json
 * @param {object} prd - PRD object to serialize
 */
export function savePRD(filePath, prd) {
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(prd, null, 2), 'utf-8');

  if (IS_WINDOWS) {
    copyFileSync(tmpPath, filePath);
    unlinkSync(tmpPath);
  } else {
    renameSync(tmpPath, filePath);
  }
}

/**
 * Validate the structure of a prd.json object.
 * @param {object} prd - Parsed PRD object
 * @returns {{ valid: boolean, reason?: string, storyId?: string, field?: string }}
 */
export function validatePrdStructure(prd) {
  if (!prd || !Array.isArray(prd.userStories)) {
    return { valid: false, reason: 'missing-userStories' };
  }

  for (const story of prd.userStories) {
    if (typeof story.id !== 'string') {
      return { valid: false, reason: 'missing-field', storyId: story.id ?? 'unknown', field: 'id' };
    }
    if (typeof story.title !== 'string') {
      return { valid: false, reason: 'missing-field', storyId: story.id, field: 'title' };
    }
    if (typeof story.passes !== 'boolean') {
      return { valid: false, reason: 'missing-field', storyId: story.id, field: 'passes' };
    }
  }

  return { valid: true };
}
