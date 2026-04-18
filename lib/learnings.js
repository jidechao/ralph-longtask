import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const GOTCHA_KEYWORDS = [
  'gotcha',
  'pitfall',
  'avoid',
  "don't forget",
  'warning',
  'make sure',
  '注意',
  '别忘了',
  '避免',
];

const RECOMMENDATION_KEYWORDS = [
  'should',
  'recommend',
  'next time',
  '应该',
  '建议',
];

/**
 * Extract learnings from a progress.txt file.
 *
 * @param {string} progressPath - Path to progress.txt
 * @returns {{ patterns: string[], gotchas: string[], recommendations: string[] }}
 */
export function extractLearnings(progressPath) {
  const empty = { patterns: [], gotchas: [], recommendations: [] };

  if (!existsSync(progressPath)) {
    return empty;
  }

  const content = readFileSync(progressPath, 'utf-8');
  if (!content.trim()) {
    return empty;
  }

  const patterns = extractPatterns(content);
  const { gotchas, recommendations } = extractLearningsBlocks(content);

  return { patterns, gotchas, recommendations };
}

/**
 * Extract bullet points from the ## Codebase Patterns section.
 */
function extractPatterns(content) {
  const patterns = [];
  const lines = content.split('\n');
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Detect the start of the Codebase Patterns section
    if (/^##\s+Codebase\s+Patterns/i.test(trimmed)) {
      inSection = true;
      continue;
    }
    // Stop at the next ## heading
    if (inSection && /^##\s/.test(trimmed)) {
      break;
    }
    // Collect bullet points
    if (inSection && trimmed.startsWith('- ')) {
      patterns.push(trimmed);
    }
  }

  return patterns;
}

/**
 * Extract gotchas and recommendations from Learnings/Lessons blocks.
 */
function extractLearningsBlocks(content) {
  const gotchas = [];
  const recommendations = [];
  const lines = content.split('\n');
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect the start of a Learnings or Lessons block
    if (
      /\*\*(?:Learnings?|Lessons?)\s+for\s+future\s+iterations:\*\*/i.test(trimmed)
    ) {
      inBlock = true;
      continue;
    }

    // End the block at the next heading, separator, or closing marker
    if (inBlock && (/^##\s/.test(trimmed) || /^---/.test(trimmed))) {
      inBlock = false;
      continue;
    }

    if (!inBlock || !trimmed.startsWith('- ')) {
      continue;
    }

    const lower = trimmed.toLowerCase();

    // Check for [FAILED] marker — always a gotcha
    if (trimmed.includes('[FAILED]')) {
      gotchas.push(trimmed.replace(/\[FAILED\]\s*/g, '').trim());
      continue;
    }

    // Check gotcha keywords
    if (GOTCHA_KEYWORDS.some((kw) => lower.includes(kw))) {
      gotchas.push(trimmed);
      continue;
    }

    // Check recommendation keywords
    if (RECOMMENDATION_KEYWORDS.some((kw) => lower.includes(kw))) {
      recommendations.push(trimmed);
      continue;
    }
  }

  return { gotchas, recommendations };
}

/**
 * Format learnings as a markdown string.
 *
 * @param {string} feature - Feature name for the heading
 * @param {{ patterns: string[], gotchas: string[], recommendations: string[] }} learnings
 * @returns {string}
 */
export function formatLearningsMarkdown(feature, learnings) {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const sections = [`# Learnings: ${feature}`, `Date: ${dateStr}`, ''];

  if (learnings.patterns.length > 0) {
    sections.push('## Codebase Patterns');
    for (const p of learnings.patterns) {
      sections.push(p);
    }
    sections.push('');
  }

  if (learnings.gotchas.length > 0) {
    sections.push('## Gotchas');
    for (const g of learnings.gotchas) {
      sections.push(g);
    }
    sections.push('');
  }

  if (learnings.recommendations.length > 0) {
    sections.push('## Recommendations for Future Specs');
    for (const r of learnings.recommendations) {
      sections.push(r);
    }
    sections.push('');
  }

  return sections.join('\n').trimEnd() + '\n';
}

/**
 * Write learnings to a markdown file on disk.
 *
 * @param {string} projectDir - Project root directory
 * @param {string} feature - Feature name
 * @param {{ patterns: string[], gotchas: string[], recommendations: string[] }} learnings
 * @returns {string} The path that was written to
 */
export function writeLearnings(projectDir, feature, learnings) {
  const md = formatLearningsMarkdown(feature, learnings);

  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const openspecArchiveDir = join(projectDir, 'openspec', 'changes', 'archive');
  const localArchiveDir = join(projectDir, 'archive');

  const useOpenSpec = existsSync(openspecArchiveDir);
  const baseDir = useOpenSpec ? openspecArchiveDir : localArchiveDir;

  const targetDir = join(baseDir, `${dateStr}-${feature}`);
  mkdirSync(targetDir, { recursive: true });

  const filePath = join(targetDir, 'learnings.md');
  writeFileSync(filePath, md, 'utf-8');

  return filePath;
}
