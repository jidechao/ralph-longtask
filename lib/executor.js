import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { platform } from 'node:os';
import chalk from 'chalk';

const IS_WINDOWS = platform() === 'win32';

let cachedBin = null;
let cachedScriptPath = null;

/**
 * Find the Claude CLI binary (result is cached).
 * Tries `claude` in PATH first, then common npm global paths.
 * @returns {string} The claude command to use
 * @throws {Error} If Claude CLI is not found
 */
export function findClaudeBinary() {
  if (cachedBin) return cachedBin;

  // Try direct PATH lookup
  try {
    const cmd = IS_WINDOWS ? 'where claude' : 'which claude';
    const output = execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).trim();
    if (IS_WINDOWS) {
      // On Windows, return the actual path (e.g., claude.cmd) so spawn can find it
      cachedBin = output.split('\n')[0].trim();
    } else {
      cachedBin = 'claude';
    }
    return cachedBin;
  } catch (e) {
    // Not in PATH, try common npm global locations
  }

  // Try common npm global bin paths
  const globalPaths = IS_WINDOWS
    ? [join(process.env.APPDATA || '', 'npm', 'claude.cmd')]
    : ['/usr/local/bin/claude', join(process.env.HOME || '', '.npm-global', 'bin', 'claude')];

  for (const p of globalPaths) {
    try {
      execSync(IS_WINDOWS ? p : `test -x ${p}`, { stdio: 'pipe' });
      cachedBin = p;
      return cachedBin;
    } catch (e) {
      continue;
    }
  }

  throw new Error(
    'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
  );
}

/**
 * On Windows, resolve the actual Node.js script path from claude.cmd.
 * This allows spawning node directly, bypassing cmd.exe for proper stdio control.
 * @returns {string|null} The script path, or null if not resolvable
 */
function findClaudeScriptPath() {
  if (cachedScriptPath !== null) return cachedScriptPath;
  if (!IS_WINDOWS) { cachedScriptPath = null; return null; }

  try {
    const output = execSync('where claude', { encoding: 'utf-8' }).trim();
    const cmdPath = output.split('\n')[0].trim();
    const content = readFileSync(cmdPath, 'utf-8');
    // Extract the node_modules path to cli.js from the cmd shim.
    // Modern npm shim: "%_prog%" "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js"
    // Legacy format:   node "%~dp0\node_modules\@anthropic-ai\claude-code\cli.js"
    // Match specifically for cli.js to avoid matching earlier %dp0% references (e.g., node.exe)
    const match = content.match(/(node_modules[\\/][^\s"']+cli\.js)/);
    if (match) {
      cachedScriptPath = join(dirname(cmdPath), match[1]);
      return cachedScriptPath;
    }
  } catch (e) {
    // Expected: script path resolution not available
  }

  cachedScriptPath = null;
  return null;
}

/**
 * Display iteration header to console.
 */
export function displayIterationHeader(iteration, maxIterations, story) {
  const line = '─'.repeat(60);
  console.log(chalk.cyan(`\n${line}`));
  console.log(
    chalk.cyan.bold(
      `  Iteration ${iteration}/${maxIterations} — ${chalk.yellow(story.id)}: ${story.title}`
    )
  );
  console.log(chalk.cyan(`${line}\n`));
}

/**
 * Execute a Claude CLI session for a given prompt.
 * On Windows, bypasses cmd.exe by spawning node directly with claude's script.
 * Uses inherited stdout/stderr for real-time streaming output.
 *
 * @param {string} prompt - The assembled prompt text
 * @param {object} config - full config object { permissionsMode, claude: { maxTurns, outputFormat } }
 * @param {object} options - { iteration, maxIterations, story }
 * @returns {Promise<{ exitCode: number, error?: boolean, child: ChildProcess }>}
 */
export function executeSession(prompt, config, options = {}) {
  const { iteration, maxIterations, story } = options;

  return new Promise((resolve, reject) => {
    displayIterationHeader(iteration, maxIterations, story);

    const claudeBin = findClaudeBinary();

    // Build args based on permissions mode
    const args = ['-p'];
    if (config.permissionsMode === 'full') {
      args.push('--dangerously-skip-permissions', '--allowedTools', 'all');
    }
    if (config.claude.maxTurns) {
      args.push('--max-turns', String(config.claude.maxTurns));
    }

    let child;
    let tmpFile = null;

    // Unified approach: always write to temp file, pipe via stdin
    tmpFile = join(tmpdir(), `ralph_prompt_${Date.now()}.txt`);
    writeFileSync(tmpFile, prompt, 'utf-8');

    if (IS_WINDOWS) {
      // Windows: try spawning node directly (bypass cmd.exe)
      const scriptPath = findClaudeScriptPath();
      if (scriptPath) {
        child = spawn(process.execPath, [scriptPath, ...args], {
          stdio: ['pipe', 'inherit', 'inherit'],
        });
      } else {
        // shell: true needed for .cmd files; quote path to handle spaces
        child = spawn(`"${claudeBin}"`, args, {
          stdio: ['pipe', 'inherit', 'inherit'],
          shell: true,
        });
      }
    } else {
      // Unix: spawn directly
      child = spawn(claudeBin, args, {
        stdio: ['pipe', 'inherit', 'inherit'],
      });
    }

    createReadStream(tmpFile).pipe(child.stdin);

    child.on('close', (code) => {
      if (tmpFile) {
        try { unlinkSync(tmpFile); } catch (e) { console.warn('ralph: temp file cleanup warning:', e.message); }
      }
      if (code !== 0) {
        resolve({ exitCode: code ?? 1, error: true, child });
      } else {
        resolve({ exitCode: 0, child });
      }
    });

    child.on('error', (err) => {
      if (tmpFile) {
        try { unlinkSync(tmpFile); } catch (e) { console.warn('ralph: temp file cleanup warning:', e.message); }
      }
      if (err.code === 'ENOENT') {
        const err = new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
        err.child = child;
        reject(err);
      } else {
        err.child = child;
        reject(err);
      }
    });
  });
}
