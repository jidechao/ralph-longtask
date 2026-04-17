#!/usr/bin/env node

import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { loadConfig } from './lib/config.js';
import { loadPRD, getNextStory } from './lib/prd.js';
import { buildPrompt } from './lib/prompt-builder.js';
import { findClaudeBinary, executeSession } from './lib/executor.js';
import { runValidation } from './lib/validator.js';
import { initProgress, appendProgress } from './lib/progress.js';

let activeChild = null;

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
          } catch (e) {
            console.error(chalk.red('prd.json still corrupt after restore'));
            console.warn('ralph: PRD still corrupt after restore:', e.message);
            process.exit(1);
          }
        } catch (e) {
          console.warn('ralph: backup restore failed:', e.message);
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
    } catch (e) { console.warn('ralph: PRD backup warning:', e.message); }

    // Build prompt
    const { prompt } = await buildPrompt(story, config.prompts, prd);

    // Execute session
    const sessionStart = new Date().toISOString();
    let result;
    try {
      result = await executeSession(prompt, config, {
        iteration: i,
        maxIterations: config.maxIterations,
        story,
      });
      activeChild = result.child;
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

    const sessionEnd = new Date().toISOString();

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
            } catch (e) { console.warn('ralph: backup restore warning:', e.message); }
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
    } catch (e) { console.warn('ralph: post-iteration PRD check warning:', e.message); }
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
    try { unlinkSync(bakPath); } catch (e) { console.warn('ralph: backup cleanup warning:', e.message); }
  }
}

// --- SIGINT handler ---

process.on('SIGINT', () => {
  if (activeChild) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /T /F /PID ${activeChild.pid}`, { stdio: 'pipe' });
      } else {
        activeChild.kill('SIGTERM');
      }
    } catch (e) {
      console.warn('ralph: SIGINT handler warning:', e.message);
    }
  }
  process.exit(130);
});

main().catch((err) => {
  console.error(chalk.red(`Fatal: ${err.message}`));
  process.exit(1);
});
