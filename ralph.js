#!/usr/bin/env node

import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import chalk from 'chalk';
import { loadConfig } from './lib/config.js';
import { loadPRD, getNextStory } from './lib/prd.js';
import { buildPrompt } from './lib/prompt-builder.js';
import { findClaudeBinary, executeSession } from './lib/executor.js';
import { runValidation } from './lib/validator.js';
import { initProgress, appendProgress } from './lib/progress.js';

// --- CLI argument parsing ---

function parseArgs(argv) {
  const args = argv.slice(2);
  let maxIterations = null;
  let configPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[++i];
    } else if (!maxIterations && /^\d+$/.test(args[i])) {
      maxIterations = parseInt(args[i], 10);
    }
  }

  return { maxIterations, configPath };
}

// --- Main loop ---

async function main() {
  const { maxIterations: cliMax, configPath } = parseArgs(process.argv);

  // Load config
  let config;
  try {
    config = loadConfig(configPath || process.cwd());
  } catch (err) {
    console.error(chalk.red(`Config error: ${err.message}`));
    process.exit(1);
  }

  // CLI override for maxIterations
  if (cliMax !== null) {
    config.maxIterations = cliMax;
  }

  // Verify Claude CLI is available
  try {
    findClaudeBinary();
  } catch (err) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  // Init progress
  initProgress(config.progressPath);

  // Main loop
  for (let i = 1; i <= config.maxIterations; i++) {
    // Load PRD (restore from backup if corrupted on non-first iteration)
    const bakPath = config.prdPath + '.bak';
    let prd;
    try {
      prd = loadPRD(config.prdPath);
    } catch (err) {
      console.error(chalk.red(`Failed to load PRD: ${err.message}`));
      if (i > 1 && existsSync(bakPath)) {
        try {
          copyFileSync(bakPath, config.prdPath);
          console.log(chalk.yellow('Restored prd.json from backup, retrying...'));
          try {
            prd = loadPRD(config.prdPath);
          } catch {
            console.error(chalk.red('prd.json still corrupt after restore'));
            process.exit(1);
          }
        } catch {
          process.exit(1);
        }
      } else {
        process.exit(1);
      }
    }

    // Find next story
    const story = getNextStory(prd);
    if (!story) {
      console.log(chalk.green('All stories completed!'));
      process.exit(0);
    }

    // Backup prd.json
    try {
      copyFileSync(config.prdPath, bakPath);
    } catch {}

    // Build prompt
    const { prompt } = await buildPrompt(story, config.prompts, prd);

    // Execute session
    const sessionStart = new Date().toLocaleString();
    let result;
    try {
      result = await executeSession(prompt, config.claude, {
        iteration: i,
        maxIterations: config.maxIterations,
        story,
      });
    } catch (err) {
      if (err.message.includes('not found')) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
      console.error(chalk.red(`Session error for ${story.id}: ${err.message}`));
      appendProgress(config.progressPath, {
        storyId: story.id,
        summary: `Session error: ${err.message}`,
        failed: true,
      });
      continue;
    }

    const sessionEnd = new Date().toLocaleString();

    // Log non-zero exit code as warning (max-turns reached is common, work may still be done)
    if (result.error) {
      console.warn(chalk.yellow(`Session exited with code ${result.exitCode} for ${story.id} (work may still be done)`));
    }

    // Post-session validation (always run, even on error — work might be completed)
    if (config.validation.checkGitCommit || config.validation.validatePrdSchema || config.validation.patchPrdPasses) {
      try {
        const validation = runValidation({
          prdPath: config.prdPath,
          storyId: story.id,
          sessionStart,
          sessionEnd,
          validationConfig: config.validation,
          sessionSuccess: !result.error,
        });

        if (!validation.valid) {
          console.warn(chalk.yellow(`Validation failed for ${story.id}: ${validation.reason}`));

          // Try restoring backup on corruption
          if (validation.reason === 'invalid-json' && existsSync(bakPath)) {
            try {
              copyFileSync(bakPath, config.prdPath);
              console.log(chalk.yellow('Restored prd.json from backup'));
            } catch {}
          }

          appendProgress(config.progressPath, {
            storyId: story.id,
            summary: `Validation failed: ${validation.reason}`,
            failed: true,
          });
        } else {
          appendProgress(config.progressPath, {
            storyId: story.id,
            summary: `Completed successfully${validation.patched ? ' (auto-patched)' : ''}`,
          });
        }
      } catch (err) {
        console.warn(chalk.yellow(`Validation error for ${story.id}: ${err.message}`));
        appendProgress(config.progressPath, {
          storyId: story.id,
          summary: `Validation error: ${err.message}`,
          failed: true,
        });
      }
    }

    // Cooldown
    if (config.cooldownSeconds > 0) {
      await sleep(config.cooldownSeconds * 1000);
    }

    // Check if all stories are done after this iteration
    try {
      const updatedPrd = loadPRD(config.prdPath);
      if (!getNextStory(updatedPrd)) {
        cleanupBackup(config.prdPath);
        console.log(chalk.green('\nAll stories completed!'));
        process.exit(0);
      }
    } catch {}
  }

  // Max iterations reached
  cleanupBackup(config.prdPath);
  console.warn(chalk.yellow(`Reached max iterations (${config.maxIterations}) without completion`));
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupBackup(prdPath) {
  const bakPath = prdPath + '.bak';
  if (existsSync(bakPath)) {
    try { unlinkSync(bakPath); } catch {}
  }
}

// --- SIGINT handler ---

import { execSync as _execSync } from 'node:child_process';

global.__ralph_child = null;
process.on('SIGINT', () => {
  const child = global.__ralph_child;
  if (child) {
    try {
      if (process.platform === 'win32') {
        _execSync(`taskkill /T /F /PID ${child.pid}`, { stdio: 'pipe' });
      } else {
        child.kill('SIGTERM');
      }
    } catch {}
  }
  process.exit(130);
});

main().catch((err) => {
  console.error(chalk.red(`Fatal: ${err.message}`));
  process.exit(1);
});
