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
    execSync(cmd, { stdio: 'pipe' });
    cachedBin = 'claude';
    return cachedBin;
  } catch {
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
    } catch {
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
    // claude.cmd typically contains: node "%~dp0\node_modules\@anthropic-ai\claude-code\cli.js" %*
    const match = content.match(/node\s+"%~dp0\\?(.*?)"/);
    if (match) {
      const scriptRelPath = match[1].replace(/\\/g, '/');
      cachedScriptPath = join(dirname(cmdPath), scriptRelPath);
      return cachedScriptPath;
    }
  } catch {}

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
 * @param {object} claudeConfig - claude section of config { maxTurns, outputFormat }
 * @param {object} options - { iteration, maxIterations, story }
 * @returns {Promise<{ exitCode: number, error?: boolean }>}
 */
export function executeSession(prompt, claudeConfig, options = {}) {
  const { iteration, maxIterations, story } = options;

  return new Promise((resolve, reject) => {
    displayIterationHeader(iteration, maxIterations, story);

    const claudeBin = findClaudeBinary();

    // Build args
    const args = ['-p', '--dangerously-skip-permissions', '--allowedTools', 'all'];
    if (claudeConfig.maxTurns) {
      args.push('--max-turns', String(claudeConfig.maxTurns));
    }

    let child;
    let tmpFile = null;

    if (IS_WINDOWS) {
      const scriptPath = findClaudeScriptPath();

      if (scriptPath) {
        // Best path: spawn node directly with claude's script.
        // Bypasses cmd.exe entirely — stdin/stdout/stderr all work correctly.
        tmpFile = join(tmpdir(), `ralph_prompt_${Date.now()}.txt`);
        writeFileSync(tmpFile, prompt, 'utf-8');

        child = spawn(process.execPath, [scriptPath, ...args], {
          stdio: ['pipe', 'inherit', 'inherit'],
        });
        createReadStream(tmpFile).pipe(child.stdin);
      } else {
        // Fallback: cmd.exe pipe (output may buffer until session ends)
        tmpFile = join(tmpdir(), `ralph_prompt_${Date.now()}.txt`);
        writeFileSync(tmpFile, prompt, 'utf-8');

        const pipeCmd = `type ${tmpFile} | ${claudeBin} ${args.join(' ')}`;
        child = spawn('cmd', ['/c', pipeCmd], {
          stdio: ['ignore', 'inherit', 'inherit'],
        });
      }
    } else if (prompt.length > 6000) {
      // Unix oversized: temp file + shell pipe
      tmpFile = join(tmpdir(), `ralph_prompt_${Date.now()}.txt`);
      writeFileSync(tmpFile, prompt, 'utf-8');
      const pipeCmd = `cat "${tmpFile}" | "${claudeBin}" ${args.join(' ')}`;
      child = spawn('sh', ['-c', pipeCmd], {
        stdio: ['pipe', 'inherit', 'inherit'],
      });
    } else {
      // Unix normal: pipe via stdin
      child = spawn(claudeBin, args, {
        stdio: ['pipe', 'inherit', 'inherit'],
      });
      child.stdin.write(prompt);
      child.stdin.end();
    }

    child.on('close', (code) => {
      if (tmpFile) {
        try { unlinkSync(tmpFile); } catch {}
      }
      if (code !== 0) {
        resolve({ exitCode: code ?? 1, error: true });
      } else {
        resolve({ exitCode: 0 });
      }
    });

    child.on('error', (err) => {
      if (tmpFile) {
        try { unlinkSync(tmpFile); } catch {}
      }
      if (err.code === 'ENOENT') {
        reject(new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code'));
      } else {
        reject(err);
      }
    });

    // Store reference for SIGINT handler
    global.__ralph_child = child;
  });
}
