import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const STATE_FILE = '.pipeline-state.json';

export const PHASES = ['spec', 'review', 'convert', 'execute'];

/**
 * Read pipeline state from a project directory.
 * @param {string} projectDir
 * @returns {object|null}
 */
export function loadPipelineState(projectDir) {
  const filePath = join(projectDir, STATE_FILE);
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Write pipeline state to a project directory.
 * Creates parent directories if needed.
 * @param {string} projectDir
 * @param {object} state
 */
export function savePipelineState(projectDir, state) {
  const filePath = join(projectDir, STATE_FILE);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Advance the pipeline to the next phase.
 * @param {string} projectDir
 * @param {string} phaseName
 * @param {object} [metadata={}]
 * @returns {object} Updated state
 */
export function advancePhase(projectDir, phaseName, metadata = {}) {
  if (!PHASES.includes(phaseName)) {
    throw new Error(`Invalid phase "${phaseName}". Must be one of: ${PHASES.join(', ')}`);
  }

  let state = loadPipelineState(projectDir);
  if (!state) {
    state = {
      feature: '',
      completedPhases: [],
      prdPath: null,
      lastUpdated: new Date().toISOString(),
      metadata: {},
    };
  }

  const expectedIndex = state.completedPhases.length;
  const phaseIndex = PHASES.indexOf(phaseName);

  if (phaseIndex !== expectedIndex) {
    const expectedPhase = PHASES[expectedIndex] || 'none (all phases complete)';
    throw new Error(
      `Phase order violation: expected "${expectedPhase}" but got "${phaseName}"`,
    );
  }

  state.completedPhases.push(phaseName);
  if (metadata.prdPath !== undefined) {
    state.prdPath = metadata.prdPath;
  }
  state.metadata = { ...state.metadata, ...metadata };
  state.lastUpdated = new Date().toISOString();

  savePipelineState(projectDir, state);
  return state;
}

/**
 * Delete the pipeline state file if it exists.
 * @param {string} projectDir
 */
export function clearPipelineState(projectDir) {
  const filePath = join(projectDir, STATE_FILE);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

/**
 * Return the next incomplete phase, or null if all complete / state is null.
 * @param {object|null} state
 * @returns {string|null}
 */
export function getCurrentPhase(state) {
  if (!state) {
    return null;
  }
  return PHASES.find((p) => !state.completedPhases.includes(p)) || null;
}
