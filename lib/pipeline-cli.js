import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { glob } from 'glob';
import chalk from 'chalk';
import { loadConfig } from './config.js';
import { loadPRD } from './prd.js';
import { checkStoryGranularity, suggestSplit } from './granularity.js';
import {
  runSpecPhase,
  runReviewPhase,
  runConvertPhase,
  runExecutePhase,
  launchRalph,
} from './pipeline-actions.js';
import {
  loadPipelineState,
  savePipelineState,
  advancePhase,
  clearPipelineState,
  getCurrentPhase,
  PHASES,
  STATE_FILE,
} from './pipeline-state.js';
import { extractLearnings, writeLearnings } from './learnings.js';

// ---------------------------------------------------------------------------
// Tool detection
// ---------------------------------------------------------------------------

/**
 * Detect whether OpenSpec is available in the project.
 * @param {string} projectDir
 * @returns {{ cliAvailable: boolean, skillsAvailable: boolean, changesDir: string|null }}
 */
export function detectOpenSpec(projectDir) {
  let cliAvailable = false;
  try {
    execSync('openspec --version', { stdio: 'pipe', encoding: 'utf-8' });
    cliAvailable = true;
  } catch {
    // CLI not found
  }

  let skillsAvailable = false;
  try {
    const matches = glob.sync('.claude/skills/openspec-*/SKILL.md', { cwd: projectDir, absolute: true });
    skillsAvailable = matches.length > 0;
  } catch {
    // Glob failed
  }

  const changesDir = join(projectDir, 'openspec', 'changes');
  const hasChanges = existsSync(changesDir);

  return {
    cliAvailable,
    skillsAvailable,
    changesDir: hasChanges ? changesDir : null,
  };
}

/**
 * Detect whether Superpowers skills are available.
 * @param {string} [projectDir=process.cwd()]
 * @returns {{ available: boolean, skills: string[] }}
 */
export function detectSuperpowers(projectDir = process.cwd()) {
  const superpowersSkills = [
    'superpowers:write-plan',
    'superpowers:requesting-code-review',
    'superpowers:brainstorm',
  ];
  const found = new Set();

  const searchPaths = [
    join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'skills'),
    join(projectDir, '.claude', 'skills'),
  ];

  for (const searchPath of searchPaths) {
    if (!existsSync(searchPath)) continue;
    try {
      const matches = glob.sync('superpowers/*/SKILL.md', { cwd: searchPath, absolute: false });
      for (const match of matches) {
        const normalized = match.replace(/\\/g, '/');
        const skillName = normalized.split('/')[1];
        const fullName = `superpowers:${skillName}`;
        if (superpowersSkills.includes(fullName)) {
          found.add(fullName);
        }
      }
    } catch {
      // Glob failed
    }
  }

  return {
    available: found.size > 0,
    skills: [...found],
  };
}

// ---------------------------------------------------------------------------
// Artifact detection and orchestration
// ---------------------------------------------------------------------------

function persistPipelineState(projectDir, state, metadata) {
  state.metadata = { ...state.metadata, ...metadata };
  state.lastUpdated = new Date().toISOString();
  savePipelineState(projectDir, state);
  return state;
}

export function archivePipelineLearnings(projectDir, config) {
  const state = loadPipelineState(projectDir);
  if (!state) {
    return { status: 'no_state', path: null };
  }

  if (state.metadata?.learningsPath && existsSync(state.metadata.learningsPath)) {
    return { status: 'already_archived', path: state.metadata.learningsPath };
  }

  const learnings = extractLearnings(config.progressPath);
  const totalItems = learnings.patterns.length + learnings.gotchas.length + learnings.recommendations.length;
  if (totalItems === 0) {
    return { status: 'empty', path: null };
  }

  const path = writeLearnings(projectDir, state.feature || 'unknown', learnings);
  persistPipelineState(projectDir, state, {
    learningsPath: path,
    learningsArchivedAt: new Date().toISOString(),
  });

  return { status: 'archived', path };
}

export function orchestratePipeline(projectDir, config, options = {}) {
  const { execute = true, openSpec = null, superpowers = null } = options;

  let state = loadPipelineState(projectDir);
  if (!state) {
    return { status: 'missing_state', phase: null };
  }

  const detectedOpenSpec = openSpec || detectOpenSpec(projectDir);
  const detectedSuperpowers = superpowers || detectSuperpowers(projectDir);

  while (true) {
    const phase = getCurrentPhase(state);

    if (!phase) {
      return { status: 'complete', phase: null, learnings: archivePipelineLearnings(projectDir, config) };
    }

    let action;
    switch (phase) {
      case 'spec':
        action = runSpecPhase(projectDir, state, { openSpec: detectedOpenSpec });
        break;
      case 'review':
        action = runReviewPhase(projectDir, state, { superpowers: detectedSuperpowers });
        break;
      case 'convert':
        action = runConvertPhase(projectDir, config, state);
        break;
      case 'execute':
        action = runExecutePhase(projectDir, state, execute);
        break;
      default:
        action = { status: 'blocked', phase, reason: 'unknown_phase' };
    }

    if (action.status === 'blocked' || action.status === 'ready_to_execute') {
      return action;
    }

    if (action.status === 'advance') {
      state = advancePhase(projectDir, phase, action.metadata || {});
      continue;
    }

    if (action.status === 'launch') {
      state = persistPipelineState(projectDir, state, action.metadata || {});

      const result = launchRalph(projectDir, action.resumeExecution);
      if (result.status !== 0) {
        return { status: 'execute_failed', phase, code: result.status };
      }

      state = loadPipelineState(projectDir);
      if (!state) {
        return { status: 'missing_state', phase: null };
      }

      if (!getCurrentPhase(state)) {
        return { status: 'complete', phase: null, learnings: archivePipelineLearnings(projectDir, config) };
      }

      continue;
    }

    return { status: 'blocked', phase, reason: 'unknown_phase' };
  }
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parsePipelineArgs(args) {
  const result = { command: null, feature: null, phase: null, configPath: null, noExecute: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      result.configPath = args[++i];
    } else if (args[i] === '--no-execute') {
      result.noExecute = true;
    } else if (!result.command) {
      result.command = args[i];
    } else if (!result.feature && !result.phase && (result.command === 'init' || result.command === 'run')) {
      result.feature = args[i];
    } else if (!result.phase && result.command === 'advance') {
      result.phase = args[i];
    }
  }

  return result;
}

function resolveConfig(configPath) {
  return loadConfig(configPath || process.cwd());
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdStatus(projectDir, config) {
  const state = loadPipelineState(projectDir);
  const openspec = detectOpenSpec(projectDir);
  const superpowers = detectSuperpowers(projectDir);

  if (!state) {
    console.log(chalk.yellow('No pipeline in progress.'));
    console.log(`Run ${chalk.cyan('ralph pipeline init <feature-name>')} to start.`);
    return;
  }

  const currentPhase = getCurrentPhase(state);
  const completedCount = state.completedPhases.length;

  console.log(chalk.bold(`Pipeline: ${chalk.cyan(state.feature || '(unnamed)')}`));
  console.log(
    `Phase: ${currentPhase ? chalk.yellow(currentPhase) : chalk.green('complete')} (${completedCount} of ${PHASES.length} complete)`,
  );

  for (const phase of PHASES) {
    const done = state.completedPhases.includes(phase);
    const marker = done ? chalk.green('[x]') : chalk.dim('[ ]');
    const label = done ? chalk.dim(`${phase} - completed`) : phase;
    console.log(`  ${marker} ${label}`);
  }

  console.log();
  console.log(chalk.bold('Tools:'));
  console.log(
    `  OpenSpec:    ${(openspec.cliAvailable || openspec.skillsAvailable) ? chalk.green(openspec.cliAvailable ? 'installed' : 'skill files found') : chalk.dim('not found')}` +
    (openspec.changesDir ? chalk.dim(` (${chalk.italic('openspec/changes/')} exists)`) : ''),
  );
  console.log(
    `  Superpowers: ${superpowers.available ? chalk.green(`available (${superpowers.skills.join(', ')})`) : chalk.dim('not found')}`,
  );

  try {
    const prd = loadPRD(config.prdPath);
    const total = prd.userStories.length;
    const completed = prd.userStories.filter((story) => story.passes).length;
    console.log(`  Stories:     ${completed}/${total} completed`);
  } catch {
    // No prd.json yet
  }
}

function cmdInit(projectDir, feature) {
  if (!feature) {
    console.error(chalk.red('Error: feature name is required. Usage: ralph pipeline init <feature-name>'));
    process.exit(1);
  }

  const existing = loadPipelineState(projectDir);
  if (existing) {
    console.error(chalk.red(`Error: pipeline already in progress for "${existing.feature}". Run "ralph pipeline reset" first.`));
    process.exit(1);
  }

  const state = {
    feature,
    completedPhases: [],
    prdPath: null,
    lastUpdated: new Date().toISOString(),
    metadata: {},
  };

  savePipelineState(projectDir, state);
  console.log(chalk.green(`Pipeline initialized for "${feature}".`));
  console.log(`State file: ${join(projectDir, STATE_FILE)}`);

  const openspec = detectOpenSpec(projectDir);
  const superpowers = detectSuperpowers(projectDir);

  console.log();
  console.log('Tool availability:');
  console.log(`  OpenSpec:    ${(openspec.cliAvailable || openspec.skillsAvailable) ? chalk.green('yes') : chalk.yellow('no')} - Phase 1 will ${(openspec.cliAvailable || openspec.skillsAvailable) ? 'use OpenSpec artifacts' : 'fallback to /ralph-skills:prd'}`);
  console.log(`  Superpowers: ${superpowers.available ? chalk.green('yes') : chalk.yellow('no')} - Phase 2 will ${superpowers.available ? 'use skill-to-skill review' : 'use built-in checklist'}`);
}

function cmdAdvance(projectDir, phase) {
  if (!phase) {
    console.error(chalk.red('Error: phase name is required. Usage: ralph pipeline advance <spec|review|convert|execute>'));
    process.exit(1);
  }

  try {
    const state = advancePhase(projectDir, phase);
    console.log(chalk.green(`Phase "${phase}" marked as complete.`));
    const next = getCurrentPhase(state);
    if (next) {
      console.log(`Next phase: ${chalk.cyan(next)}`);
    } else {
      console.log(chalk.green.bold('All phases complete!'));
    }
  } catch (err) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

function cmdCheck(projectDir, config) {
  let prd;
  try {
    prd = loadPRD(config.prdPath);
  } catch (err) {
    console.error(chalk.red(`Error: Cannot load prd.json: ${err.message}`));
    process.exit(1);
  }

  const stories = prd.userStories || [];
  console.log(`Checking ${stories.length} stories...\n`);

  let failCount = 0;

  for (const story of stories) {
    const result = checkStoryGranularity(story);

    if (result.pass) {
      console.log(chalk.green(`${story.id}: OK`));
      continue;
    }

    failCount++;
    console.log(chalk.red(`${story.id}: ${story.title}`));
    for (const violation of result.violations) {
      const badge = violation.severity === 'error' ? chalk.red('[FAIL]') : chalk.yellow('[WARN]');
      console.log(`  ${badge} ${violation.rule}: ${violation.message}`);
    }

    if (result.violations.some((violation) => violation.severity === 'error')) {
      const suggestion = suggestSplit(story, result.violations);
      if (suggestion.suggestedStories.length > 0) {
        console.log(chalk.dim('\n  Suggested split:'));
        for (const suggestedStory of suggestion.suggestedStories) {
          console.log(chalk.dim(`    ${suggestedStory.id}: ${suggestedStory.title} (${suggestedStory.priority})`));
        }
      }
    }
    console.log();
  }

  console.log();
  if (failCount === 0) {
    console.log(chalk.green(`All ${stories.length} stories pass granularity checks.`));
    return;
  }

  console.log(chalk.yellow(`${failCount} of ${stories.length} stories need splitting.`));
  process.exit(1);
}

function cmdLearnings(projectDir, config) {
  const result = archivePipelineLearnings(projectDir, config);
  if (result.status === 'empty') {
    console.log(chalk.yellow('No learnings found in progress.txt.'));
    return;
  }
  if (result.status === 'already_archived') {
    console.log(chalk.cyan(`Learnings already archived: ${result.path}`));
    return;
  }
  if (result.status === 'no_state') {
    console.log(chalk.yellow('No pipeline state found. Skipping learnings archive.'));
    return;
  }

  const learnings = extractLearnings(config.progressPath);
  console.log(chalk.green(`Learnings archived to: ${result.path}`));
  console.log(`  Patterns:       ${learnings.patterns.length}`);
  console.log(`  Gotchas:        ${learnings.gotchas.length}`);
  console.log(`  Recommendations: ${learnings.recommendations.length}`);
}

function cmdReset(projectDir) {
  const existing = loadPipelineState(projectDir);
  if (!existing) {
    console.log(chalk.yellow('No pipeline state to reset.'));
    return;
  }

  clearPipelineState(projectDir);
  console.log(chalk.green(`Pipeline state cleared (was: "${existing.feature}").`));
}

function printOrchestrationResult(result) {
  if (result.status === 'blocked') {
    console.log(chalk.yellow(`Pipeline paused at phase: ${result.phase}`));
    if (result.reason === 'missing') {
      console.log(chalk.dim('Required artifacts are not available yet.'));
    } else if (result.reason === 'ambiguous') {
      console.log(chalk.yellow('Multiple matching artifacts were found. Narrow the active feature before resuming.'));
      for (const candidate of result.candidates || []) {
        console.log(`  - ${candidate}`);
      }
    } else if (result.reason === 'missing_prd_json') {
      console.log(chalk.dim('Generate prd.json before continuing to execute.'));
    } else if (result.reason === 'conversion_failed') {
      console.log(chalk.dim('Convert phase found PRD markdown but failed to generate prd.json.'));
      if (result.metadata?.prdPath) {
        console.log(chalk.dim(`PRD markdown: ${result.metadata.prdPath}`));
      }
      if (result.metadata?.conversionError) {
        console.log(chalk.dim(`Conversion error: ${result.metadata.conversionError}`));
      }
    } else if (result.reason === 'invalid_prd_structure') {
      console.log(chalk.dim('Generated prd.json failed structure validation.'));
      if (result.metadata?.reason) {
        console.log(chalk.dim(`Validation reason: ${result.metadata.reason}`));
      }
    } else if (result.reason === 'missing_spec_artifacts') {
      console.log(chalk.dim('Review cannot generate a PRD because spec artifacts are incomplete.'));
      if (result.metadata?.specDir) {
        console.log(chalk.dim(`Spec directory: ${result.metadata.specDir}`));
      }
      if (result.metadata?.missingArtifacts?.length) {
        console.log(chalk.dim(`Missing: ${result.metadata.missingArtifacts.join(', ')}`));
      }
      console.log(chalk.dim('Create or complete design.md and tasks.md, then resume the pipeline.'));
    } else if (result.reason === 'needs_prd_markdown') {
      console.log(chalk.dim('OpenSpec is unavailable and no PRD markdown artifact was found.'));
      console.log(chalk.dim('Create a tasks/prd-*.md file, then resume the pipeline.'));
      for (const candidate of result.candidates || []) {
        console.log(`  - ${candidate}`);
      }
    } else if (result.reason === 'spec_generation_required') {
      console.log(chalk.dim('OpenSpec is available, but spec artifacts are missing.'));
      if (result.metadata?.specBootstrap && result.metadata.specBootstrap !== 'skipped') {
        console.log(chalk.dim(`Bootstrap attempt: ${result.metadata.specBootstrap}`));
      }
      if (result.metadata?.bootstrapError) {
        console.log(chalk.dim(`Bootstrap error: ${result.metadata.bootstrapError}`));
      }
      console.log(chalk.dim('Generate OpenSpec design/tasks artifacts, then resume the pipeline.'));
      for (const candidate of result.candidates || []) {
        console.log(`  - ${candidate}`);
      }
    } else if (result.reason === 'generation_failed') {
      console.log(chalk.dim('Review could not generate a PRD markdown artifact from the available spec inputs.'));
      if (result.metadata?.specDir) {
        console.log(chalk.dim(`Spec directory: ${result.metadata.specDir}`));
      }
      if (result.metadata?.generationError) {
        console.log(chalk.dim(`Generation error: ${result.metadata.generationError}`));
      }
    } else if (result.reason === 'granularity_failed') {
      console.log(chalk.yellow('prd.json stories failed granularity checks:'));
      for (const failure of result.failures || []) {
        console.log(`  - ${failure.story.id}: ${failure.violations.map((violation) => violation.rule).join(', ')}`);
      }
    }
    return;
  }

  if (result.status === 'ready_to_execute') {
    console.log(chalk.green('Pipeline advanced to execute and is ready to launch Ralph.'));
    return;
  }

  if (result.status === 'complete') {
    console.log(chalk.green.bold('Pipeline is complete.'));
    if (result.learnings?.status === 'archived') {
      console.log(chalk.green(`Learnings archived to: ${result.learnings.path}`));
    }
    return;
  }

  if (result.status === 'execute_failed') {
    console.error(chalk.red(`Ralph execution failed with exit code ${result.code}.`));
  }
}

function cmdRun(projectDir, config, feature, noExecute) {
  let state = loadPipelineState(projectDir);
  if (!state) {
    if (!feature) {
      console.error(chalk.red('Error: feature name is required when starting a new pipeline. Usage: ralph pipeline run <feature-name>'));
      process.exit(1);
    }
    cmdInit(projectDir, feature);
    state = loadPipelineState(projectDir);
  } else if (feature && feature !== state.feature) {
    console.error(chalk.red(`Error: pipeline already initialized for "${state.feature}". Run "ralph pipeline reset" first.`));
    process.exit(1);
  }

  const result = orchestratePipeline(projectDir, config, { execute: !noExecute });
  printOrchestrationResult(result);

  if (result.status === 'execute_failed') {
    process.exit(result.code || 1);
  }
}

function cmdResume(projectDir, config, noExecute) {
  const state = loadPipelineState(projectDir);
  if (!state) {
    console.error(chalk.red('Error: no pipeline state found. Run "ralph pipeline init <feature-name>" or "ralph pipeline run <feature-name>" first.'));
    process.exit(1);
  }

  const result = orchestratePipeline(projectDir, config, { execute: !noExecute });
  printOrchestrationResult(result);

  if (result.status === 'execute_failed') {
    process.exit(result.code || 1);
  }
}

function printHelp() {
  console.log(`
${chalk.bold('ralph pipeline')} - Pipeline orchestration commands

${chalk.bold('Usage:')}
  ralph pipeline <command> [options]

${chalk.bold('Commands:')}
  status                Show pipeline state and tool availability
  init <feature-name>   Initialize a new pipeline
  run <feature-name>    Initialize if needed and orchestrate the pipeline
  resume                Continue the pipeline from the current phase
  advance <phase>       Mark a phase as complete (spec|review|convert|execute)
  check                 Run granularity checks on prd.json stories
  learnings             Extract learnings from progress.txt and archive
  reset                 Clear pipeline state

${chalk.bold('Options:')}
  --config <dir>        Specify project directory
  --no-execute          Stop after orchestration instead of launching Ralph

${chalk.bold('Phase order:')}
  spec -> review -> convert -> execute
`.trim());
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a pipeline subcommand.
 * @param {string[]} args - process.argv slice (after 'pipeline')
 */
export function runPipelineCommand(args) {
  const parsed = parsePipelineArgs(args);

  if (!parsed.command || parsed.command === 'help' || parsed.command === '--help') {
    printHelp();
    process.exit(0);
  }

  const config = resolveConfig(parsed.configPath);
  const projectDir = config._configDir || process.cwd();

  switch (parsed.command) {
    case 'status':
      cmdStatus(projectDir, config);
      break;
    case 'init':
      cmdInit(projectDir, parsed.feature);
      break;
    case 'run':
      cmdRun(projectDir, config, parsed.feature, parsed.noExecute);
      break;
    case 'resume':
      cmdResume(projectDir, config, parsed.noExecute);
      break;
    case 'advance':
      cmdAdvance(projectDir, parsed.phase);
      break;
    case 'check':
      cmdCheck(projectDir, config);
      break;
    case 'learnings':
      cmdLearnings(projectDir, config);
      break;
    case 'reset':
      cmdReset(projectDir);
      break;
    default:
      console.error(chalk.red(`Unknown command: ${parsed.command}`));
      printHelp();
      process.exit(1);
  }
}
