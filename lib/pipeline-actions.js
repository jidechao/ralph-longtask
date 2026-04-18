import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { glob } from 'glob';
import { loadPRD, savePRD, validatePrdStructure } from './prd.js';
import { checkStoryGranularity, suggestSplit } from './granularity.js';
import { convertPrdMarkdownFile } from './prd-converter.js';

function normalizeFeatureName(feature) {
  return (feature || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function chooseCandidate(paths, feature) {
  if (paths.length === 0) {
    return { status: 'missing', path: null, candidates: [] };
  }

  const featureSlug = normalizeFeatureName(feature);
  if (featureSlug) {
    const matches = paths.filter((candidate) => candidate.toLowerCase().includes(featureSlug));
    if (matches.length === 1) {
      return { status: 'found', path: matches[0], candidates: matches };
    }
    if (matches.length === 0 && paths.length === 1) {
      return { status: 'mismatch', path: null, candidates: paths };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', path: null, candidates: matches };
    }
  }

  if (paths.length === 1) {
    return { status: 'found', path: paths[0], candidates: paths };
  }

  return { status: 'ambiguous', path: null, candidates: paths };
}

function titleCaseFeature(feature) {
  return (feature || '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function toSentenceCase(text, fallback) {
  const value = (text || '').trim();
  if (!value) {
    return fallback;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function collectSectionLines(content, heading) {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (startIndex === -1) {
    return [];
  }

  const collected = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s+/.test(line.trim())) {
      break;
    }
    collected.push(line);
  }

  return collected;
}

function collectBulletItems(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^- (\[[ xX]\] )?/.test(line))
    .map((line) => line.replace(/^- (\[[ xX]\] )?/, '').trim())
    .filter(Boolean);
}

function sanitizeTaskTitle(task, index, featureTitle) {
  const cleaned = (task || '')
    .replace(/[.:]+$/, '')
    .replace(/^add /i, 'Add ')
    .replace(/^create /i, 'Create ')
    .replace(/^update /i, 'Update ')
    .trim();

  if (cleaned) {
    return toSentenceCase(cleaned, `Deliver ${featureTitle} work item ${index}`);
  }

  return `Deliver ${featureTitle} work item ${index}`;
}

function createAcceptanceCriteria(task) {
  const criteria = [
    `${toSentenceCase(task, 'The implementation')} is complete`,
    'Typecheck passes',
  ];

  if (/\b(ui|screen|page|component|modal|form)\b/i.test(task || '')) {
    criteria.push('Verify in browser using dev-browser skill');
  }

  return criteria;
}

function deriveGoals(designContent, featureTitle) {
  const goalLines = collectSectionLines(designContent, '## Goals');
  const bullets = goalLines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^- /, '').trim());

  if (bullets.length > 0) {
    return bullets;
  }

  return [
    `Ship ${featureTitle} with a scoped implementation plan`,
    `Keep ${featureTitle} work split into reviewable stories`,
  ];
}

function deriveIntroduction(designContent, featureTitle) {
  const summaryLines = collectSectionLines(designContent, '## Summary')
    .map((line) => line.trim())
    .filter(Boolean);

  if (summaryLines.length > 0) {
    return summaryLines.join(' ');
  }

  return `${featureTitle} needs a scoped implementation plan based on the available OpenSpec artifacts.`;
}

function deriveUserStories(tasksContent, featureTitle) {
  const taskItems = collectBulletItems(tasksContent).slice(0, 3);
  const items = taskItems.length > 0 ? taskItems : [
    `Prepare ${featureTitle.toLowerCase()} implementation`,
    `Deliver ${featureTitle.toLowerCase()} backend support`,
    `Deliver ${featureTitle.toLowerCase()} user flow`,
  ];

  return items.map((task, index) => ({
    id: `US-00${index + 1}`,
    title: sanitizeTaskTitle(task, index + 1, featureTitle),
    description: `As a team member, I want to ${task.toLowerCase()} so that ${featureTitle.toLowerCase()} is ready to ship.`,
    acceptanceCriteria: createAcceptanceCriteria(task),
  }));
}

function deriveFunctionalRequirements(tasksContent, featureTitle) {
  const tasks = collectBulletItems(tasksContent);
  if (tasks.length > 0) {
    return tasks.map((task, index) => `FR-${index + 1}: ${toSentenceCase(task, `Deliver ${featureTitle}`)}`);
  }

  return [
    `FR-1: The system must support the planned ${featureTitle.toLowerCase()} workflow`,
    `FR-2: The implementation must be broken into reviewable user stories`,
  ];
}

function renderPrdMarkdown({ featureTitle, designContent, tasksContent, reviewMode }) {
  const goals = deriveGoals(designContent, featureTitle);
  const userStories = deriveUserStories(tasksContent, featureTitle);
  const functionalRequirements = deriveFunctionalRequirements(tasksContent, featureTitle);
  const introduction = deriveIntroduction(designContent, featureTitle);

  const lines = [
    `# PRD: ${featureTitle}`,
    '',
    '## Introduction',
    '',
    introduction,
    '',
    '## Goals',
    '',
    ...goals.map((goal) => `- ${goal}`),
    '',
    '## User Stories',
    '',
  ];

  for (const story of userStories) {
    lines.push(`### ${story.id}: ${story.title}`);
    lines.push(`**Description:** ${story.description}`);
    lines.push('');
    lines.push('**Acceptance Criteria:**');
    lines.push(...story.acceptanceCriteria.map((criterion) => `- [ ] ${criterion}`));
    lines.push('');
  }

  lines.push('## Functional Requirements');
  lines.push('');
  lines.push(...functionalRequirements.map((requirement) => `- ${requirement}`));
  lines.push('');
  lines.push('## Non-Goals');
  lines.push('');
  lines.push(`- Do not expand ${featureTitle.toLowerCase()} beyond the scoped OpenSpec change set`);
  lines.push('- Do not start implementation during the review stage');
  lines.push('');
  lines.push('## Success Metrics');
  lines.push('');
  lines.push(`- ${featureTitle} stories are clear enough to convert into prd.json without manual rewriting`);
  lines.push('- Review output preserves the scope described in OpenSpec artifacts');
  lines.push('');
  lines.push('## Open Questions');
  lines.push('');
  lines.push(`- Should ${featureTitle.toLowerCase()} require additional rollout or migration planning?`);
  lines.push(`- Review mode: ${reviewMode}`);
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function resolveSpecSource(projectDir, state) {
  const explicitSpecDir = state?.metadata?.specDir ? resolve(projectDir, state.metadata.specDir) : null;
  if (explicitSpecDir) {
    const designPath = join(explicitSpecDir, 'design.md');
    const tasksPath = join(explicitSpecDir, 'tasks.md');
    const missingArtifacts = [];

    if (!existsSync(designPath)) {
      missingArtifacts.push('design.md');
    }
    if (!existsSync(tasksPath)) {
      missingArtifacts.push('tasks.md');
    }

    if (missingArtifacts.length === 0) {
      return {
        status: 'found',
        specDir: relative(projectDir, explicitSpecDir).replace(/\\/g, '/'),
        designPath,
        tasksPath,
      };
    }

    return {
      status: 'missing_spec_artifacts',
      specDir: relative(projectDir, explicitSpecDir).replace(/\\/g, '/'),
      missingArtifacts,
      candidates: [],
    };
  }

  const detected = detectSpecArtifacts(projectDir, state?.feature);
  if (detected.status === 'found') {
    const absoluteSpecDir = join(projectDir, detected.path);
    return {
      status: 'found',
      specDir: detected.path,
      designPath: join(absoluteSpecDir, 'design.md'),
      tasksPath: join(absoluteSpecDir, 'tasks.md'),
    };
  }

  if (detected.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      candidates: detected.candidates,
    };
  }

  const featureSlug = normalizeFeatureName(state?.feature);
  const hintedSpecDir = featureSlug ? join(projectDir, 'openspec', 'changes', featureSlug) : null;
  if (hintedSpecDir && existsSync(hintedSpecDir)) {
    const missingArtifacts = [];
    if (!existsSync(join(hintedSpecDir, 'design.md'))) {
      missingArtifacts.push('design.md');
    }
    if (!existsSync(join(hintedSpecDir, 'tasks.md'))) {
      missingArtifacts.push('tasks.md');
    }

    return {
      status: 'missing_spec_artifacts',
      specDir: relative(projectDir, hintedSpecDir).replace(/\\/g, '/'),
      missingArtifacts,
      candidates: [],
    };
  }

  return {
    status: 'missing_spec_artifacts',
    candidates: [],
    missingArtifacts: ['design.md', 'tasks.md'],
  };
}

export function detectSpecArtifacts(projectDir, feature) {
  const candidates = glob.sync('openspec/changes/*', { cwd: projectDir, absolute: false })
    .filter((dir) => existsSync(join(projectDir, dir, 'design.md')) && existsSync(join(projectDir, dir, 'tasks.md')))
    .map((dir) => dir.replace(/\\/g, '/'));

  return chooseCandidate(candidates, feature);
}

export function detectPrdArtifacts(projectDir, state) {
  const explicitPath = state?.prdPath ? resolve(projectDir, state.prdPath) : null;
  if (explicitPath && existsSync(explicitPath)) {
    const relPath = relative(projectDir, explicitPath).replace(/\\/g, '/');
    return { status: 'found', path: relPath, candidates: [relPath] };
  }

  const candidates = glob.sync('tasks/prd-*.md', { cwd: projectDir, absolute: false })
    .map((file) => file.replace(/\\/g, '/'));

  return chooseCandidate(candidates, state?.feature);
}

function runGranularityCheck(prd) {
  const failures = [];

  for (const story of prd.userStories || []) {
    const result = checkStoryGranularity(story);
    if (!result.pass) {
      failures.push({
        story,
        violations: result.violations,
        suggestion: suggestSplit(story, result.violations),
      });
    }
  }

  return failures;
}

export function initializeOpenSpecProject(projectDir, exec = execSync) {
  try {
    exec('openspec init', {
      cwd: projectDir,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CI: '1' },
    });
    return { status: 'initialized' };
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
}

export function runSpecPhase(projectDir, state, options = {}) {
  const {
    openSpec = { cliAvailable: false, skillsAvailable: false, changesDir: null },
    bootstrapOpenSpecProject = initializeOpenSpecProject,
  } = options;

  const spec = detectSpecArtifacts(projectDir, state.feature);
  if (spec.status !== 'found') {
    const openSpecAvailable = Boolean(openSpec.cliAvailable || openSpec.skillsAvailable);

    if (!openSpecAvailable) {
      const prdDoc = detectPrdArtifacts(projectDir, state);
      if (prdDoc.status === 'found') {
        return {
          status: 'advance',
          phase: 'spec',
          metadata: { specMode: 'direct-prd', specDir: null },
        };
      }

      return {
        status: 'blocked',
        phase: 'spec',
        reason: 'needs_prd_markdown',
        candidates: prdDoc.candidates,
      };
    }

    let bootstrap = { status: 'skipped' };
    if (openSpec.cliAvailable && !openSpec.changesDir) {
      bootstrap = bootstrapOpenSpecProject(projectDir);
      const refreshedSpec = detectSpecArtifacts(projectDir, state.feature);
      if (refreshedSpec.status === 'found') {
        return {
          status: 'advance',
          phase: 'spec',
          metadata: {
            specDir: refreshedSpec.path,
            specBootstrap: bootstrap.status,
          },
        };
      }
    }

    return {
      status: 'blocked',
      phase: 'spec',
      reason: 'spec_generation_required',
      candidates: spec.candidates,
      metadata: {
        specBootstrap: bootstrap.status,
        bootstrapError: bootstrap.error,
      },
    };
  }

  return { status: 'advance', phase: 'spec', metadata: { specDir: spec.path } };
}

export function generatePrdFromSpec(projectDir, state, options = {}) {
  const {
    specSource = resolveSpecSource(projectDir, state),
    superpowers = { available: false, skills: [] },
  } = options;

  if (specSource.status !== 'found') {
    return {
      status: 'failed',
      error: `Spec source unavailable: ${specSource.status}`,
    };
  }

  try {
    const featureSlug = normalizeFeatureName(state?.feature) || 'feature';
    const featureTitle = titleCaseFeature(state?.feature) || 'Feature';
    const designContent = readFileSync(specSource.designPath, 'utf-8');
    const tasksContent = readFileSync(specSource.tasksPath, 'utf-8');
    const reviewMode = superpowers.available ? 'superpowers-assisted' : 'built-in-checklist';
    const prdPath = join(projectDir, 'tasks', `prd-${featureSlug}.md`);

    mkdirSync(join(projectDir, 'tasks'), { recursive: true });
    writeFileSync(
      prdPath,
      renderPrdMarkdown({ featureTitle, designContent, tasksContent, reviewMode }),
      'utf-8',
    );

    return {
      status: 'generated',
      path: relative(projectDir, prdPath).replace(/\\/g, '/'),
      reviewMode,
      specDir: specSource.specDir,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error.message,
    };
  }
}

export function runReviewPhase(projectDir, state, options = {}) {
  const {
    superpowers = { available: false, skills: [] },
    generatePrdFromSpec: generatePrd = generatePrdFromSpec,
  } = options;

  const prdDoc = detectPrdArtifacts(projectDir, state);
  if (prdDoc.status === 'found') {
    return { status: 'advance', phase: 'review', metadata: { prdPath: prdDoc.path } };
  }

  if (prdDoc.status === 'ambiguous') {
    return { status: 'blocked', phase: 'review', reason: 'ambiguous', candidates: prdDoc.candidates };
  }

  const specSource = resolveSpecSource(projectDir, state);
  if (specSource.status !== 'found') {
    return {
      status: 'blocked',
      phase: 'review',
      reason: specSource.status,
      candidates: specSource.candidates || [],
      metadata: {
        specDir: specSource.specDir,
        missingArtifacts: specSource.missingArtifacts,
      },
    };
  }

  const generated = generatePrd(projectDir, state, { specSource, superpowers });
  if (generated.status !== 'generated') {
    return {
      status: 'blocked',
      phase: 'review',
      reason: 'generation_failed',
      metadata: {
        specDir: specSource.specDir,
        generationError: generated.error,
      },
    };
  }

  return {
    status: 'advance',
    phase: 'review',
    metadata: {
      prdPath: generated.path,
      reviewMode: generated.reviewMode,
      specDir: generated.specDir,
    },
  };
}

export function runConvertPhase(projectDir, config, state = {}, options = {}) {
  const {
    convertMarkdown = convertPrdMarkdownFile,
  } = options;

  if (!existsSync(config.prdPath)) {
    const prdDoc = detectPrdArtifacts(projectDir, state);
    if (prdDoc.status !== 'found') {
      return { status: 'blocked', phase: 'convert', reason: 'missing_prd_json', candidates: prdDoc.candidates || [] };
    }

    try {
      const convertedPrd = convertMarkdown(join(projectDir, prdDoc.path), { feature: state?.feature });
      savePRD(config.prdPath, convertedPrd);
    } catch (error) {
      return {
        status: 'blocked',
        phase: 'convert',
        reason: 'conversion_failed',
        metadata: {
          prdPath: prdDoc.path,
          conversionError: error.message,
        },
      };
    }
  }

  const prd = loadPRD(config.prdPath);
  const structure = validatePrdStructure(prd);
  if (!structure.valid) {
    return {
      status: 'blocked',
      phase: 'convert',
      reason: 'invalid_prd_structure',
      metadata: structure,
    };
  }

  const failures = runGranularityCheck(prd);
  if (failures.length > 0) {
    return { status: 'blocked', phase: 'convert', reason: 'granularity_failed', failures };
  }

  return {
    status: 'advance',
    phase: 'convert',
    metadata: { storyCount: (prd.userStories || []).length },
  };
}

export function runExecutePhase(projectDir, state, execute) {
  if (!execute) {
    return { status: 'ready_to_execute', phase: 'execute' };
  }

  return {
    status: 'launch',
    phase: 'execute',
    metadata: {
      executionStartedAt: state.metadata?.executionStartedAt || new Date().toISOString(),
    },
    resumeExecution: Boolean(state.metadata?.executionStartedAt),
  };
}

export function launchRalph(projectDir, resume) {
  const scriptPath = fileURLToPath(new URL('../ralph.js', import.meta.url));
  const args = [scriptPath, '--config', projectDir];
  if (resume) {
    args.push('--resume');
  }

  return spawnSync(process.execPath, args, {
    cwd: projectDir,
    stdio: 'inherit',
  });
}
