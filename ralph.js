#!/usr/bin/env node

import { copyFileSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { loadConfig } from './lib/config.js';
import { loadPRD, getIncompleteStories, getNextStory } from './lib/prd.js';
import { buildPrompt, ensureStoryWithinLimit } from './lib/prompt-builder.js';
import { findClaudeBinary, executeSession } from './lib/executor.js';
import { runValidation } from './lib/validator.js';
import { initProgress, appendProgress } from './lib/progress.js';
import { checkAndArchive } from './lib/archive.js';
import { loadPipelineState, getCurrentPhase, advancePhase as advancePipelinePhase } from './lib/pipeline-state.js';
import {
  applyRetryStories,
  clearPersistentStoryState,
  getPersistedSkippedStories,
  loadRunState,
  pruneCompletedStories,
  registerPersistentStorySkip,
  saveRunState,
} from './lib/run-state.js';
import {
  accumulateUsage,
  estimateSessionUsage,
  shouldStopForBudget,
  summarizeBudgetUsage,
  validateBudgetConfiguration,
} from './lib/budget.js';

let activeChild = null;
const DEFAULT_MAX_FAILURES_PER_STORY = 3;

// --- CLI argument parsing ---

function loadPackageVersion() {
  try {
    const packageJsonPath = new URL('./package.json', import.meta.url);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function printHelp() {
  console.log(`
${chalk.bold('ralph')} - Iterative Claude Code runner for prd.json stories

${chalk.bold('Usage:')}
  ralph [maxIterations] [options]
  ralph pipeline <command> [options]

${chalk.bold('Options:')}
  --config <dir>        Specify project directory
  --resume              Resume an interrupted Ralph execution loop
  --story <id>          Run only the specified story
  --skip-story <id>     Skip a story for the current run (repeatable)
  --retry-story <id>    Remove a persisted auto-skip and retry that story (repeatable)
  --dry-run             Preview the execution queue without launching Claude
  --max-runtime-minutes <n>
                        Stop before a new iteration once the runtime budget is exhausted
  --max-total-tokens <n>
                        Stop before a new iteration once the estimated token budget is exhausted
  --max-total-cost-usd <n>
                        Stop before a new iteration once the estimated cost budget is exhausted
  --max-failures-per-story <n>
                        Auto-skip a story after n consecutive failed iterations
  --help, -h            Show this help message
  --version, -v         Show the installed Ralph version

${chalk.bold('Examples:')}
  ralph
  ralph 20
  ralph --resume
  ralph --story US-003
  ralph --skip-story US-001 --skip-story US-002
  ralph --retry-story US-001
  ralph --dry-run
  ralph --max-total-tokens 12000
  ralph --max-total-cost-usd 2.5
  ralph --config ./path/to/project
  ralph pipeline --help
`.trim());
}

function parseIntegerOption(name, value, { allowZero = false } = {}) {
  if (value === undefined) {
    return { error: `${name} requires a value` };
  }

  if (!/^\d+$/.test(value)) {
    return { error: `${name} must be an integer` };
  }

  const parsed = parseInt(value, 10);
  if (!allowZero && parsed <= 0) {
    return { error: `${name} must be a positive integer` };
  }
  if (allowZero && parsed < 0) {
    return { error: `${name} must be a non-negative integer` };
  }

  return { value: parsed };
}

function parseNumberOption(name, value, { allowZero = false } = {}) {
  if (value === undefined) {
    return { error: `${name} requires a value` };
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return { error: `${name} must be a number` };
  }
  if (!allowZero && parsed <= 0) {
    return { error: `${name} must be a positive number` };
  }
  if (allowZero && parsed < 0) {
    return { error: `${name} must be a non-negative number` };
  }

  return { value: parsed };
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  let maxIterations = null;
  let configPath = null;
  let resume = false;
  let showHelp = false;
  let showVersion = false;
  let dryRun = false;
  let storyId = null;
  const skipStories = [];
  const retryStories = [];
  let maxRuntimeMinutes = null;
  let maxTotalTokens = null;
  let maxTotalCostUsd = null;
  let maxFailuresPerStory = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[++i];
    } else if (args[i] === '--resume') {
      resume = true;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--story') {
      storyId = args[++i] ?? null;
      if (!storyId) {
        return { error: '--story requires a story id' };
      }
    } else if (args[i] === '--skip-story') {
      const skipStoryId = args[++i] ?? null;
      if (!skipStoryId) {
        return { error: '--skip-story requires a story id' };
      }
      skipStories.push(skipStoryId);
    } else if (args[i] === '--retry-story') {
      const retryStoryId = args[++i] ?? null;
      if (!retryStoryId) {
        return { error: '--retry-story requires a story id' };
      }
      retryStories.push(retryStoryId);
    } else if (args[i] === '--max-runtime-minutes') {
      const parsed = parseIntegerOption('--max-runtime-minutes', args[++i], { allowZero: true });
      if (parsed.error) {
        return { error: parsed.error };
      }
      maxRuntimeMinutes = parsed.value;
    } else if (args[i] === '--max-total-tokens') {
      const parsed = parseIntegerOption('--max-total-tokens', args[++i], { allowZero: true });
      if (parsed.error) {
        return { error: parsed.error };
      }
      maxTotalTokens = parsed.value;
    } else if (args[i] === '--max-total-cost-usd') {
      const parsed = parseNumberOption('--max-total-cost-usd', args[++i], { allowZero: true });
      if (parsed.error) {
        return { error: parsed.error };
      }
      maxTotalCostUsd = parsed.value;
    } else if (args[i] === '--max-failures-per-story') {
      const parsed = parseIntegerOption('--max-failures-per-story', args[++i]);
      if (parsed.error) {
        return { error: parsed.error };
      }
      maxFailuresPerStory = parsed.value;
    } else if (args[i] === '--help' || args[i] === '-h') {
      showHelp = true;
    } else if (args[i] === '--version' || args[i] === '-v') {
      showVersion = true;
    } else if (!maxIterations && /^\d+$/.test(args[i])) {
      maxIterations = parseInt(args[i], 10);
    }
  }

  if (storyId && skipStories.includes(storyId)) {
    return { error: 'Cannot both target and skip the same story' };
  }

  return {
    maxIterations,
    configPath,
    resume,
    showHelp,
    showVersion,
    dryRun,
    storyId,
    skipStories,
    retryStories,
    maxRuntimeMinutes,
    maxTotalTokens,
    maxTotalCostUsd,
    maxFailuresPerStory,
  };
}

export function shouldStopForRuntimeBudget({ startedAt, maxRuntimeMinutes, now = new Date() }) {
  if (!maxRuntimeMinutes || maxRuntimeMinutes <= 0) {
    return false;
  }

  return now.getTime() - startedAt.getTime() >= maxRuntimeMinutes * 60 * 1000;
}

export function registerStoryFailure(runState, storyId, maxFailuresPerStory) {
  const previous = runState.consecutiveFailures.get(storyId) ?? 0;
  const count = previous + 1;
  const skipped = maxFailuresPerStory > 0 && count >= maxFailuresPerStory;

  runState.consecutiveFailures.set(storyId, count);
  if (skipped) {
    runState.autoSkippedStories.add(storyId);
  }

  return { count, skipped };
}

export function buildDryRunReport({
  prd,
  storyId = null,
  skipStories = [],
  persistedSkipStories = [],
  budget = null,
}) {
  const allStories = Array.isArray(prd?.userStories) ? prd.userStories : [];
  const skipSet = new Set(skipStories);
  const persistedSkipSet = new Set(persistedSkipStories);
  const incompleteStories = getIncompleteStories(prd, { storyId });
  const selectedStory = storyId ? allStories.find((story) => story.id === storyId) : null;

  if (storyId && !selectedStory) {
    return { status: 'not-found', storyId, eligibleStories: [], skippedStories: [], incompleteCount: incompleteStories.length };
  }

  if (selectedStory?.passes === true) {
    return { status: 'already-complete', storyId, eligibleStories: [], skippedStories: [], incompleteCount: incompleteStories.length };
  }

  const eligibleStories = incompleteStories.filter((story) => !skipSet.has(story.id) && !persistedSkipSet.has(story.id));
  const skippedStories = incompleteStories
    .filter((story) => skipSet.has(story.id) || persistedSkipSet.has(story.id))
    .map((story) => ({
      id: story.id,
      reason: skipSet.has(story.id) ? 'manual-skip' : 'persisted-auto-skip',
    }));

  return {
    status: eligibleStories.length > 0 ? 'ok' : 'no-eligible-stories',
    storyId,
    incompleteCount: incompleteStories.length,
    budget,
    eligibleStories: eligibleStories.map((story) => ({
      id: story.id,
      title: story.title,
      priority: story.priority ?? null,
    })),
    skippedStories,
  };
}

function formatBudgetGuardrails(budget) {
  if (!budget || (!budget.maxTotalTokens && !budget.maxTotalCostUsd)) {
    return null;
  }

  const limits = [];
  if (budget.maxTotalTokens > 0) {
    limits.push(`max ${budget.maxTotalTokens.toLocaleString()} tokens`);
  }
  if (budget.maxTotalCostUsd > 0) {
    limits.push(`max $${budget.maxTotalCostUsd.toFixed(2)}`);
  }

  return `${limits.join(', ')} (estimator: ${budget.charsPerToken} chars/token)`;
}

function appendBudgetUsage(summary, budgetUsage) {
  if (!budgetUsage || (budgetUsage.totalTokens || 0) === 0) {
    return summary;
  }

  return `${summary}\nBudget estimate so far: ${summarizeBudgetUsage(budgetUsage)}.`;
}

function printDryRunReport(report) {
  if (report.status === 'not-found') {
    console.log(chalk.red(`Story not found: ${report.storyId}`));
    return 1;
  }

  if (report.status === 'already-complete') {
    console.log(chalk.green(`Selected story ${report.storyId} is already complete.`));
    return 0;
  }

  console.log(chalk.bold('Ralph dry run preview'));
  console.log(chalk.dim(`Incomplete stories in scope: ${report.incompleteCount}`));
  const budgetGuardrails = formatBudgetGuardrails(report.budget);
  if (budgetGuardrails) {
    console.log(chalk.dim(`Budget guardrails: ${budgetGuardrails}`));
  }

  if (report.eligibleStories.length > 0) {
    console.log(chalk.green('\nEligible execution order:'));
    for (const story of report.eligibleStories) {
      const priorityLabel = story.priority === null ? 'priority: none' : `priority: ${story.priority}`;
      console.log(`  - ${story.id} (${priorityLabel}) ${story.title}`);
    }
  } else {
    console.log(chalk.yellow('\nNo eligible stories remain for this run.'));
  }

  if (report.skippedStories.length > 0) {
    console.log(chalk.yellow('\nSkipped stories:'));
    for (const story of report.skippedStories) {
      const reason = story.reason === 'manual-skip' ? 'manual skip for this run' : 'persisted auto-skip from earlier failures';
      console.log(`  - ${story.id} (${reason})`);
    }
  }

  return 0;
}

// --- Main loop ---

async function main() {
  // Subcommand dispatch: ralph pipeline <args>
  if (process.argv[2] === 'pipeline') {
    const { runPipelineCommand } = await import('./lib/pipeline-cli.js');
    runPipelineCommand(process.argv.slice(3));
    return;
  }

  const {
    maxIterations: cliMax,
    configPath,
    resume,
    showHelp,
    showVersion,
    dryRun,
    storyId,
    skipStories,
    retryStories,
    maxRuntimeMinutes,
    maxTotalTokens,
    maxTotalCostUsd,
    maxFailuresPerStory,
    error: argsError,
  } = parseArgs(process.argv);

  if (argsError) {
    console.error(chalk.red(argsError));
    process.exit(1);
  }

  if (showHelp) {
    printHelp();
    process.exit(0);
  }

  if (showVersion) {
    console.log(loadPackageVersion());
    process.exit(0);
  }

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
  if (maxTotalTokens !== null) {
    config.budget.maxTotalTokens = maxTotalTokens;
  }
  if (maxTotalCostUsd !== null) {
    config.budget.maxTotalCostUsd = maxTotalCostUsd;
  }
  try {
    validateBudgetConfiguration(config.budget);
  } catch (err) {
    console.error(chalk.red(`Budget config error: ${err.message}`));
    process.exit(1);
  }

  const projectDir = config._configDir || process.cwd();
  const runStatePath = join(projectDir, '.ralph-run-state.json');
  const persistedRunState = loadRunState(runStatePath);
  applyRetryStories(persistedRunState, retryStories);
  saveRunState(runStatePath, persistedRunState);
  const runStartedAt = new Date();
  const runState = {
    consecutiveFailures: new Map(),
    skippedStories: new Set(skipStories),
    autoSkippedStories: new Set(),
  };
  const selectedStoryId = storyId;
  const failureLimit = maxFailuresPerStory ?? DEFAULT_MAX_FAILURES_PER_STORY;
  let budgetUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputCostUsd: 0,
    outputCostUsd: 0,
    totalCostUsd: 0,
  };

  if (dryRun) {
    let prd;
    try {
      prd = loadPRD(config.prdPath);
      pruneCompletedStories(persistedRunState, prd);
      saveRunState(runStatePath, persistedRunState);
    } catch (err) {
      console.error(chalk.red(`Failed to load PRD: ${err.message}`));
      process.exit(1);
    }

    const report = buildDryRunReport({
      prd,
      storyId: selectedStoryId,
      skipStories: Array.from(runState.skippedStories),
      persistedSkipStories: getPersistedSkippedStories(persistedRunState),
      budget: config.budget,
    });
    process.exit(printDryRunReport(report));
  }

  if (resume) {
    const pipelineState = loadPipelineState(projectDir);
    const pipelinePhase = getCurrentPhase(pipelineState);
    if (pipelineState && pipelinePhase && pipelinePhase !== 'execute') {
      const { runPipelineCommand } = await import('./lib/pipeline-cli.js');
      runPipelineCommand(['resume', '--config', projectDir]);
      return;
    }
  }

  // Verify Claude CLI is available
  try {
    findClaudeBinary();
  } catch (err) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  // Init progress (skip on resume to preserve existing data)
  if (!resume) {
    initProgress(config.progressPath);
  } else {
    console.log(chalk.cyan('Resuming from existing state...'));
  }

  // Check for branch change and archive previous run (skip on resume)
  if (!resume) {
    try {
      const prd = loadPRD(config.prdPath);
      if (prd.branchName) {
        const result = checkAndArchive({
          configDir: config._configDir || process.cwd(),
          prdPath: config.prdPath,
          progressPath: config.progressPath,
          branchName: prd.branchName,
        });
        if (result.archived) {
          console.log(chalk.yellow(`Archived previous run to ${result.archivePath}`));
        }
      }
    } catch (e) {
      // No prd.json yet or parse error — skip archive check
    }
  }

  // Main loop
  for (let i = 1; i <= config.maxIterations; i++) {
    if (shouldStopForRuntimeBudget({ startedAt: runStartedAt, maxRuntimeMinutes })) {
      const runtimeSummary = `Stopped before iteration ${i} because the runtime budget (${maxRuntimeMinutes} minute(s)) was exhausted.`;
      console.warn(chalk.yellow(runtimeSummary));
      appendProgress(config.progressPath, {
        storyId: selectedStoryId || 'RUN',
        summary: runtimeSummary,
        failed: true,
      });
      cleanupBackup(config.prdPath);
      process.exit(1);
    }

    const budgetStop = shouldStopForBudget({
      usage: budgetUsage,
      budget: config.budget,
    });
    if (budgetStop.stop) {
      const budgetSummary = summarizeBudgetUsage(budgetUsage);
      const limitSummary = budgetStop.reason === 'token-budget-exhausted'
        ? `estimated token budget (${config.budget.maxTotalTokens.toLocaleString()} tokens)`
        : `estimated cost budget ($${config.budget.maxTotalCostUsd.toFixed(2)})`;
      const summary = `Stopped before iteration ${i} because the ${limitSummary} was exhausted. Current usage: ${budgetSummary}.`;
      console.warn(chalk.yellow(summary));
      appendProgress(config.progressPath, {
        storyId: selectedStoryId || 'RUN',
        summary,
        failed: true,
      });
      cleanupBackup(config.prdPath);
      process.exit(1);
    }

    // Load PRD (restore from backup if corrupted on non-first iteration)
    const bakPath = config.prdPath + '.bak';
    let prd;
    try {
      prd = loadPRD(config.prdPath);
      pruneCompletedStories(persistedRunState, prd);
      saveRunState(runStatePath, persistedRunState);
    } catch (err) {
      console.error(chalk.red(`Failed to load PRD: ${err.message}`));
      if (i > 1 && existsSync(bakPath)) {
        try {
          copyFileSync(bakPath, config.prdPath);
          console.log(chalk.yellow('Restored prd.json from backup, retrying...'));
          try {
            prd = loadPRD(config.prdPath);
            pruneCompletedStories(persistedRunState, prd);
            saveRunState(runStatePath, persistedRunState);
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

    if (selectedStoryId) {
      const selectedStory = prd.userStories?.find((candidate) => candidate.id === selectedStoryId);
      if (!selectedStory) {
        console.error(chalk.red(`Story not found: ${selectedStoryId}`));
        process.exit(1);
      }
      if (selectedStory.passes === true) {
        console.log(chalk.green(`Selected story ${selectedStoryId} is already complete.`));
        process.exit(0);
      }
    }

    // Find next story
    const story = getNextStory(prd, {
      storyId: selectedStoryId,
      skipStories: Array.from(new Set([
        ...runState.skippedStories,
        ...runState.autoSkippedStories,
        ...getPersistedSkippedStories(persistedRunState),
      ])),
    });
    if (!story) {
      const incompleteStories = getIncompleteStories(prd, { storyId: selectedStoryId });
      if (incompleteStories.length === 0) {
        console.log(chalk.green(selectedStoryId ? `Selected story ${selectedStoryId} completed!` : 'All stories completed!'));
        process.exit(0);
      }

      const blockedStories = incompleteStories.map((candidate) => candidate.id).join(', ');
      console.warn(chalk.yellow(`No eligible stories remain for this run. Blocked by skip/circuit breaker: ${blockedStories}`));
      appendProgress(config.progressPath, {
        storyId: selectedStoryId || 'RUN',
        summary: `Stopped because no eligible stories remained for this run. Blocked stories: ${blockedStories}`,
        failed: true,
      });
      cleanupBackup(config.prdPath);
      process.exit(1);
    }

    // Backup prd.json
    try {
      copyFileSync(config.prdPath, bakPath);
    } catch (e) { console.warn('ralph: PRD backup warning:', e.message); }

    // Build prompt
    const promptResult = await buildPrompt(story, config.prompts, prd);
    const { prompt } = promptResult;
    try {
      ensureStoryWithinLimit(story);
    } catch (err) {
      console.error(chalk.red(err.message));
      appendProgress(config.progressPath, {
        storyId: story.id,
        summary: `Prompt blocked: ${err.message}`,
        failed: true,
      });
      const failure = registerStoryFailure(runState, story.id, failureLimit);
      if (failure.skipped) {
        registerPersistentStorySkip(persistedRunState, story.id, { failureCount: failure.count });
        saveRunState(runStatePath, persistedRunState);
        appendProgress(config.progressPath, {
          storyId: story.id,
          summary: `Skipped for the rest of this run after ${failure.count} consecutive failed attempts. The skip will carry into later runs until you retry this story.`,
          failed: true,
        });
      }
      cleanupBackup(config.prdPath);
      continue;
    }

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
      const failure = registerStoryFailure(runState, story.id, failureLimit);
      if (failure.skipped) {
        registerPersistentStorySkip(persistedRunState, story.id, { failureCount: failure.count });
        saveRunState(runStatePath, persistedRunState);
        appendProgress(config.progressPath, {
          storyId: story.id,
          summary: `Skipped for the rest of this run after ${failure.count} consecutive failed attempts. The skip will carry into later runs until you retry this story.`,
          failed: true,
        });
      }
      continue;
    }

    const sessionEnd = new Date().toISOString();
    const sessionUsage = estimateSessionUsage({
      promptChars: promptResult.charCount,
      outputChars: result.capturedStdout?.length || 0,
      charsPerToken: config.budget.charsPerToken,
      inputCostPer1kTokensUsd: config.budget.inputCostPer1kTokensUsd,
      outputCostPer1kTokensUsd: config.budget.outputCostPer1kTokensUsd,
    });
    budgetUsage = accumulateUsage(budgetUsage, sessionUsage);

    // Log non-zero exit code as warning (max-turns reached is common, work may still be done)
    if (result.error) {
      console.warn(chalk.yellow(`Session exited with code ${result.exitCode} for ${story.id} (work may still be done)`));
    }

    // Post-session validation (always run, even on error — work might be completed)
    if (config.validation.checkGitCommit || config.validation.validatePrdSchema || config.validation.patchPrdPasses) {
      let iterationValidated = false;
      try {
        const validation = runValidation({
          prdPath: config.prdPath,
          storyId: story.id,
          sessionStart,
          sessionEnd,
          validationConfig: config.validation,
          sessionSuccess: !result.error,
          completionSignaled: result.completionSignaled,
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
            summary: appendBudgetUsage(`Validation failed: ${validation.reason}`, budgetUsage),
            failed: true,
          });
          const failure = registerStoryFailure(runState, story.id, failureLimit);
          if (failure.skipped) {
            registerPersistentStorySkip(persistedRunState, story.id, { failureCount: failure.count });
            saveRunState(runStatePath, persistedRunState);
            appendProgress(config.progressPath, {
              storyId: story.id,
              summary: `Skipped for the rest of this run after ${failure.count} consecutive failed attempts. The skip will carry into later runs until you retry this story.`,
              failed: true,
            });
          }
        } else {
          iterationValidated = true;
          clearPersistentStoryState(persistedRunState, story.id);
          saveRunState(runStatePath, persistedRunState);
          appendProgress(config.progressPath, {
            storyId: story.id,
            summary: appendBudgetUsage(`Completed successfully${validation.patched ? ' (auto-patched)' : ''}`, budgetUsage),
          });
        }
      } catch (err) {
        console.warn(chalk.yellow(`Validation error for ${story.id}: ${err.message}`));
        appendProgress(config.progressPath, {
          storyId: story.id,
          summary: appendBudgetUsage(`Validation error: ${err.message}`, budgetUsage),
          failed: true,
        });
        const failure = registerStoryFailure(runState, story.id, failureLimit);
        if (failure.skipped) {
          registerPersistentStorySkip(persistedRunState, story.id, { failureCount: failure.count });
          saveRunState(runStatePath, persistedRunState);
          appendProgress(config.progressPath, {
            storyId: story.id,
            summary: `Skipped for the rest of this run after ${failure.count} consecutive failed attempts. The skip will carry into later runs until you retry this story.`,
            failed: true,
          });
        }
      }

      if (iterationValidated) {
        runState.consecutiveFailures.delete(story.id);
      }
    }

    // Cooldown
    if (config.cooldownSeconds > 0) {
      await sleep(config.cooldownSeconds * 1000);
    }

    // Check if all stories are done after this iteration
    try {
      const updatedPrd = loadPRD(config.prdPath);
      const remainingStories = getNextStory(updatedPrd, {
        storyId: selectedStoryId,
        skipStories: Array.from(new Set([
          ...runState.skippedStories,
          ...runState.autoSkippedStories,
          ...getPersistedSkippedStories(persistedRunState),
        ])),
      });
      const selectedStory = selectedStoryId
        ? updatedPrd.userStories?.find((candidate) => candidate.id === selectedStoryId)
        : null;
      const targetCompleted = selectedStoryId && selectedStory?.passes === true;

      if (!remainingStories && (targetCompleted || getIncompleteStories(updatedPrd).length === 0)) {
        cleanupBackup(config.prdPath);
        // Update pipeline state if active
        try {
          const pipelineState = loadPipelineState(projectDir);
          if (pipelineState && !pipelineState.completedPhases.includes('execute')) {
            advancePipelinePhase(projectDir, 'execute');
            console.log(chalk.dim('Pipeline state updated: execute phase complete.'));
          }
        } catch {
          // Pipeline state not available — skip
        }
        try {
          const { archivePipelineLearnings } = await import('./lib/pipeline-cli.js');
          const learnings = archivePipelineLearnings(projectDir, config);
          if (learnings.status === 'archived') {
            console.log(chalk.dim(`Pipeline learnings archived: ${learnings.path}`));
          }
        } catch {
          // Learnings archive is best-effort
        }
        console.log(chalk.green(targetCompleted ? `\nSelected story ${selectedStoryId} completed!` : '\nAll stories completed!'));
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

// Check if this module is the direct entry point.
// We compare the real (dereferenced) paths because npm link creates
// junctions/symlinks — argv[1] may differ from import.meta.url on Windows.
const _realArgv = realpathSync(resolve(process.argv[1] || ''));
const _realSelf = realpathSync(fileURLToPath(import.meta.url));

if (_realSelf === _realArgv) {
  main().catch((err) => {
    console.error(chalk.red(`Fatal: ${err.message}`));
    process.exit(1);
  });
}

export { main };
