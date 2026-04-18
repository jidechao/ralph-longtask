import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, parse as parsePath } from 'node:path';
import { homedir } from 'node:os';

const DEFAULTS = {
  prdPath: './prd.json',
  progressPath: './progress.txt',
  maxIterations: 10,
  cooldownSeconds: 3,
  permissionsMode: 'full',
  claude: {
    maxTurns: 50,
  },
  prompts: {
    agentInstructionPath: './RALPH.md',
    extraContextPaths: ['./CLAUDE.md'],
    extraInstructions: '',
    strictSingleStory: true,
  },
  validation: {
    checkGitCommit: true,
    patchPrdPasses: true,
    validatePrdSchema: true,
    acceptanceCommands: {
      typecheck: '',
      tests: '',
    },
  },
};

/**
 * Search upward from startDir for ralph.config.json.
 * Returns { configPath, configDir } or { configPath: null, configDir: startDir }.
 */
function findConfigFile(startDir) {
  let dir = startDir;
  const { root } = parsePath(dir);
  while (true) {
    const candidate = join(dir, 'ralph.config.json');
    if (existsSync(candidate)) {
      return { configPath: candidate, configDir: dir };
    }
    if (dir === root) break;
    dir = dirname(dir);
  }
  return { configPath: null, configDir: startDir };
}

/**
 * Load and parse the config file. Returns parsed object or null if not found / invalid.
 */
function loadConfigFile(configPath) {
  if (!configPath) return null;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Warning: Failed to parse ${configPath}: ${err.message}. Using defaults.`);
    return null;
  }
}

/**
 * Deep merge source into target (simple two-level merge sufficient for this config).
 */
function mergeConfig(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key]) &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      result[key] = { ...result[key], ...source[key] };
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Apply RALPH_* environment variable overrides.
 * Supports top-level keys and one-level-nested keys (double underscore separator).
 * e.g. RALPH_MAX_ITERATIONS=20 → maxIterations: 20
 *      RALPH_CLAUDE_MAX_TURNS=50 → claude.maxTurns: 50
 */
function applyEnvOverrides(config) {
  const result = { ...config };
  const envMap = {
    PRD_PATH: 'prdPath',
    PROGRESS_PATH: 'progressPath',
    MAX_ITERATIONS: 'maxIterations',
    COOLDOWN_SECONDS: 'cooldownSeconds',
    PERMISSIONS_MODE: 'permissionsMode',
  };
  const nestedEnvMap = {
    CLAUDE_MAX_TURNS: ['claude', 'maxTurns'],
    PROMPTS_AGENT_INSTRUCTION_PATH: ['prompts', 'agentInstructionPath'],
    PROMPTS_EXTRA_INSTRUCTIONS: ['prompts', 'extraInstructions'],
    PROMPTS_STRICT_SINGLE_STORY: ['prompts', 'strictSingleStory'],
    VALIDATION_CHECK_GIT_COMMIT: ['validation', 'checkGitCommit'],
    VALIDATION_PATCH_PRD_PASSES: ['validation', 'patchPrdPasses'],
    VALIDATION_VALIDATE_PRD_SCHEMA: ['validation', 'validatePrdSchema'],
    VALIDATION_ACCEPTANCE_COMMANDS_TYPECHECK: ['validation', 'acceptanceCommands', 'typecheck'],
    VALIDATION_ACCEPTANCE_COMMANDS_TESTS: ['validation', 'acceptanceCommands', 'tests'],
  };

  for (const [envKey, configKey] of Object.entries(envMap)) {
    const value = process.env[`RALPH_${envKey}`];
    if (value !== undefined) {
      result[configKey] = parseEnvValue(configKey, value, result[configKey]);
    }
  }

  for (const [envKey, path] of Object.entries(nestedEnvMap)) {
    const value = process.env[`RALPH_${envKey}`];
    if (value !== undefined) {
      if (path.length === 2) {
        const [group, key] = path;
        result[group] = { ...result[group] };
        result[group][key] = parseEnvValue(key, value, result[group][key]);
      } else if (path.length === 3) {
        const [group, nestedGroup, key] = path;
        result[group] = { ...result[group] };
        result[group][nestedGroup] = { ...result[group][nestedGroup] };
        result[group][nestedGroup][key] = parseEnvValue(key, value, result[group][nestedGroup][key]);
      }
    }
  }

  return result;
}

/**
 * Parse env var value with type coercion.
 */
function parseEnvValue(key, value, current) {
  if (typeof current === 'number') {
    const parsed = Number(value);
    if (isNaN(parsed)) {
      console.warn(`Warning: RALPH env var for ${key} has non-numeric value "${value}", ignoring.`);
      return current;
    }
    return parsed;
  }
  if (typeof current === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    console.warn(`Warning: RALPH env var for ${key} has non-boolean value "${value}", ignoring.`);
    return current;
  }
  return value;
}

/**
 * Expand ~ to home directory and resolve relative paths against baseDir.
 */
function resolvePath(p, baseDir) {
  if (p === null || p === undefined) return p;
  if (p.startsWith('~')) {
    p = join(homedir(), p.slice(1));
  }
  return resolve(baseDir, p);
}

/**
 * Resolve all path fields in config relative to configDir.
 */
function resolvePaths(config, configDir) {
  const result = { ...config };
  result.prdPath = resolvePath(result.prdPath, configDir);
  result.progressPath = resolvePath(result.progressPath, configDir);
  result.prompts = { ...result.prompts };
  result.prompts.agentInstructionPath = resolvePath(result.prompts.agentInstructionPath, configDir);
  result.prompts.extraContextPaths = result.prompts.extraContextPaths.map((p) =>
    resolvePath(p, configDir)
  );
  return result;
}

/**
 * Validate config values.
 */
function validateConfig(config) {
  const numericFields = [
    ['maxIterations', config.maxIterations, false],
    ['claude.maxTurns', config.claude.maxTurns, false],
    ['cooldownSeconds', config.cooldownSeconds, true],
  ];

  for (const [name, value, allowZero] of numericFields) {
    if (!Number.isInteger(value)) {
      throw new Error(`${name} must be an integer`);
    }
    if (!allowZero && value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
    if (allowZero && value < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }

  const validPermissions = ['full', 'restricted'];
  if (!validPermissions.includes(config.permissionsMode)) {
    console.warn(`Warning: permissionsMode "${config.permissionsMode}" is invalid, falling back to "full"`);
    config.permissionsMode = 'full';
  }
}

/**
 * Load full configuration: defaults → file → env vars → path resolution → validation.
 */
export function loadConfig(cwd = process.cwd()) {
  const { configPath, configDir } = findConfigFile(cwd);
  const fileConfig = loadConfigFile(configPath);
  const merged = fileConfig ? mergeConfig(DEFAULTS, fileConfig) : { ...DEFAULTS };
  const withEnv = applyEnvOverrides(merged);
  const resolved = resolvePaths(withEnv, configDir);
  resolved._configDir = configDir;
  validateConfig(resolved);
  return resolved;
}

export { DEFAULTS };
