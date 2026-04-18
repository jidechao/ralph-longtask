import { readFileSync } from 'node:fs';
import { checkStoryGranularity, suggestSplit } from './granularity.js';

function normalizeFeatureName(feature) {
  return (feature || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toProjectName(feature) {
  return (feature || '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const target = `## ${heading}`.toLowerCase();
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === target);
  if (startIndex === -1) {
    return '';
  }

  const collected = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('## ')) {
      break;
    }
    collected.push(lines[i]);
  }

  return collected.join('\n').trim();
}

function parseAcceptanceCriteria(block) {
  const matches = block.match(/^- (?:\[[ xX]\] )?(.*)$/gm) || [];
  const criteria = matches
    .map((line) => line.replace(/^- (?:\[[ xX]\] )?/, '').trim())
    .filter(Boolean);

  if (!criteria.some((criterion) => criterion.toLowerCase() === 'typecheck passes')) {
    criteria.push('Typecheck passes');
  }

  return criteria;
}

function ensureTypecheckCriterion(criteria = []) {
  const normalized = [...criteria];
  if (!normalized.some((criterion) => criterion.toLowerCase() === 'typecheck passes')) {
    normalized.push('Typecheck passes');
  }
  return normalized;
}

function parseUserStories(markdown) {
  const section = getSection(markdown, 'User Stories');
  if (!section) {
    return [];
  }

  const lines = section.split(/\r?\n/);
  const stories = [];
  let current = null;

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(US-\d+(?:-[A-Za-z0-9_-]+)?):\s+(.+)$/);
    if (headingMatch) {
      if (current) {
        stories.push(current);
      }
      current = {
        id: headingMatch[1],
        title: headingMatch[2].trim(),
        bodyLines: [],
      };
      continue;
    }

    if (current) {
      current.bodyLines.push(line);
    }
  }

  if (current) {
    stories.push(current);
  }

  return stories.map((story) => {
    const body = story.bodyLines.join('\n');
    const descriptionMatch = body.match(/\*\*Description:\*\*\s*(.+)/);
    const criteriaBlock = body.match(/\*\*Acceptance Criteria:\*\*([\s\S]*)/);

    return {
      id: story.id,
      title: story.title,
      description: descriptionMatch ? descriptionMatch[1].trim() : '',
      acceptanceCriteria: parseAcceptanceCriteria(criteriaBlock ? criteriaBlock[1] : ''),
      priority: 0,
      passes: false,
      notes: '',
    };
  });
}

function expandStories(stories) {
  const expanded = [];

  for (const story of stories) {
    const result = checkStoryGranularity(story);
    if (!result.pass) {
      const suggestion = suggestSplit(story, result.violations);
      if (suggestion.suggestedStories.length > 0) {
        for (const suggestedStory of suggestion.suggestedStories) {
          expanded.push({
            ...suggestedStory,
            acceptanceCriteria: ensureTypecheckCriterion(suggestedStory.acceptanceCriteria || []),
            passes: false,
            notes: '',
          });
        }
        continue;
      }
    }

    expanded.push({
      ...story,
      acceptanceCriteria: ensureTypecheckCriterion(story.acceptanceCriteria || []),
      passes: false,
      notes: '',
    });
  }

  return expanded.map((story, index) => ({
    ...story,
    priority: index + 1,
    passes: false,
    notes: '',
  }));
}

export function convertPrdMarkdown(markdown, options = {}) {
  const titleMatch = markdown.match(/^# PRD:\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : toProjectName(options.featureName || 'feature');
  const project = normalizeFeatureName(title || options.featureName || 'feature');
  const description = getSection(markdown, 'Introduction')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  const featureSlug = normalizeFeatureName(options.featureName || title || 'feature');
  const stories = parseUserStories(markdown);

  return {
    project,
    branchName: `ralph/${featureSlug}`,
    description,
    userStories: expandStories(stories),
  };
}

export const convertPrdMarkdownToJson = convertPrdMarkdown;

export function convertPrdMarkdownFile(markdownPath, options = {}) {
  const markdown = readFileSync(markdownPath, 'utf-8');
  return convertPrdMarkdown(markdown, {
    featureName: options.featureName || options.feature,
  });
}
