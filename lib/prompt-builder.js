import { readFileSync } from 'node:fs';
import { glob } from 'glob';

export const PROMPT_CHAR_LIMIT = 2000;

/**
 * Generate the strict single-story protocol header.
 * Instructs the AI to work on exactly one story and signal completion.
 */
function buildStrictHeader(story) {
  return [
    '=== STRICT SINGLE-STORY PROTOCOL ===',
    `You are working on story: ${story.id}`,
    `Title: ${story.title}`,
    '',
    'CRITICAL RULES:',
    '1. DO NOT implement any other story. Focus ONLY on the story assigned above.',
    '2. When you have finished this story and committed your changes, output:',
    '   <promise>COMPLETE</promise>',
    '3. Do NOT output the completion signal until this story is truly done and committed.',
    '=== END PROTOCOL ===',
    '',
  ].join('\n');
}

/**
 * Load the global instruction file (e.g., RALPH.md).
 * Returns the file content or empty string if not configured / not found.
 */
function loadGlobalInstructions(filePath) {
  if (!filePath) return '';
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`Warning: Could not read agent instruction file ${filePath}: ${err.message}`);
    return '';
  }
}

/**
 * Load extra context files matching glob patterns.
 * Returns concatenated content from all matched files.
 * Patterns are processed in config order; within a pattern, matches are sorted alphabetically.
 */
async function loadExtraContext(patterns) {
  if (!patterns || patterns.length === 0) return '';

  const sections = [];
  for (const pattern of patterns) {
    try {
      const matches = await glob(pattern, { absolute: true, nodir: true });
      matches.sort();
      for (const file of matches) {
        try {
          const content = readFileSync(file, 'utf-8');
          sections.push(`--- Context: ${file} ---\n${content}`);
        } catch (err) {
          console.warn(`Warning: Could not read context file ${file}: ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`Warning: Glob pattern "${pattern}" failed: ${err.message}`);
    }
  }
  return sections.join('\n\n');
}

/**
 * Format the current story as a structured task section.
 */
function formatTask(story) {
  const lines = [
    '=== CURRENT TASK ===',
    `Story ID: ${story.id}`,
    `Title: ${story.title}`,
  ];

  if (story.description) {
    lines.push('', `Description:\n${story.description}`);
  }

  if (story.acceptanceCriteria && story.acceptanceCriteria.length > 0) {
    lines.push('', 'Acceptance Criteria:');
    story.acceptanceCriteria.forEach((ac, i) => {
      lines.push(`${i + 1}. ${ac}`);
    });
  }

  if (story.priority !== undefined) {
    lines.push('', `Priority: ${story.priority}`);
  }

  if (story.notes && story.notes.trim() !== '') {
    lines.push('', `Notes:\n${story.notes}`);
  }

  lines.push('=== END TASK ===');
  return lines.join('\n');
}

/**
 * Build project context section from PRD-level metadata.
 */
function formatProjectContext(prd) {
  if (!prd) return '';
  const lines = ['=== PROJECT CONTEXT ==='];
  if (prd.project) lines.push(`Project: ${prd.project}`);
  if (prd.branchName) lines.push(`Branch: ${prd.branchName}`);
  if (prd.description) lines.push(`Description: ${prd.description}`);
  if (prd.branchName) {
    lines.push('', `IMPORTANT: Create and checkout git branch "${prd.branchName}" before starting any work. If the branch already exists, just checkout to it.`);
  }
  lines.push('=== END PROJECT CONTEXT ===');
  return lines.join('\n');
}

/**
 * Assemble the full prompt from all sources in fixed order.
 * @param {object} story - The current story object from prd.json
 * @param {object} promptsConfig - prompts section of config
 * @param {object} [prd] - Full PRD object for project-level context
 * @returns {{ prompt: string, charCount: number, sourceCount: number, oversized: boolean }}
 */
export async function buildPrompt(story, promptsConfig, prd) {
  const parts = [];
  let sourceCount = 0;

  // 1. Project context (branch, project name, description)
  const projectCtx = formatProjectContext(prd);
  if (projectCtx) {
    parts.push(projectCtx);
    sourceCount++;
  }

  // 2. Strict header
  if (promptsConfig.strictSingleStory) {
    parts.push(buildStrictHeader(story));
    sourceCount++;
  }

  // 3. Global instructions
  const globalContent = loadGlobalInstructions(promptsConfig.agentInstructionPath);
  if (globalContent) {
    parts.push(globalContent);
    sourceCount++;
  }

  // 4. Extra context files (glob patterns)
  const extraContent = await loadExtraContext(promptsConfig.extraContextPaths);
  if (extraContent) {
    parts.push(extraContent);
    sourceCount++;
  }

  // 5. Extra instructions
  if (promptsConfig.extraInstructions && promptsConfig.extraInstructions.trim()) {
    parts.push(promptsConfig.extraInstructions.trim());
    sourceCount++;
  }

  // 6. Current task
  const taskContent = formatTask(story);
  parts.push(taskContent);
  sourceCount++;

  const prompt = parts.join('\n\n');
  const charCount = prompt.length;

  return { prompt, charCount, sourceCount };
}

/**
 * Check whether a single story's own content exceeds the char limit.
 * Only measures the story fields (id, title, description, acceptanceCriteria, notes),
 * not the assembled prompt context (global instructions, extra files, etc.).
 */
export function ensureStoryWithinLimit(story) {
  const storyText = formatTask(story);
  const charCount = storyText.length;

  if (charCount > PROMPT_CHAR_LIMIT) {
    const storyId = story?.id || 'unknown-story';
    throw new Error(
      `Story ${storyId} too large: ${charCount} chars exceeds ${PROMPT_CHAR_LIMIT}. Split the story or trim context.`,
    );
  }
}
