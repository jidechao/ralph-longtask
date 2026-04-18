import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStoryGranularity,
  splitStoryByLayer,
  suggestSplit,
} from '../lib/granularity.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal well-formed story. */
const okStory = {
  id: 'US-001',
  title: 'Add priority field',
  description: 'As a developer, I need to store task priority.',
  acceptanceCriteria: [
    'Add priority column to tasks table',
    'Typecheck passes',
  ],
  priority: 1,
  passes: false,
  notes: '',
};

// ---------------------------------------------------------------------------
// checkStoryGranularity
// ---------------------------------------------------------------------------

describe('checkStoryGranularity', () => {
  it('story with short description and few criteria passes', () => {
    const result = checkStoryGranularity(okStory);
    assert.equal(result.pass, true);
    assert.equal(result.violations.length, 0);
  });

  it('story with > 3 sentences flagged as TOO_MANY_SENTENCES', () => {
    const story = {
      ...okStory,
      description: 'First sentence. Second sentence. Third sentence. Fourth sentence.',
    };
    const result = checkStoryGranularity(story);
    assert.equal(result.pass, false);
    const v = result.violations.find((x) => x.rule === 'TOO_MANY_SENTENCES');
    assert.ok(v);
    assert.equal(v.severity, 'error');
  });

  it('story with > 6 acceptance criteria flagged as TOO_MANY_CRITERIA', () => {
    const story = {
      ...okStory,
      acceptanceCriteria: [
        'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7',
      ],
    };
    const result = checkStoryGranularity(story);
    assert.equal(result.pass, false);
    const v = result.violations.find((x) => x.rule === 'TOO_MANY_CRITERIA');
    assert.ok(v);
    assert.equal(v.severity, 'error');
  });

  it('story mentioning "database" and "component" flagged as CROSS_LAYER', () => {
    const story = {
      ...okStory,
      description: 'Create a database table and a UI component for it.',
    };
    const result = checkStoryGranularity(story);
    assert.equal(result.pass, false);
    const v = result.violations.find((x) => x.rule === 'CROSS_LAYER');
    assert.ok(v);
    assert.ok(v.layers.includes('schema'));
    assert.ok(v.layers.includes('ui'));
  });

  it('story mentioning "API" and "UI" flagged as CROSS_LAYER', () => {
    const story = {
      ...okStory,
      description: 'Build an API endpoint and a UI page for the feature.',
    };
    const result = checkStoryGranularity(story);
    assert.equal(result.pass, false);
    const v = result.violations.find((x) => x.rule === 'CROSS_LAYER');
    assert.ok(v);
    assert.ok(v.layers.includes('backend'));
    assert.ok(v.layers.includes('ui'));
  });

  it('story with "etc." flagged as VAGUE_LANGUAGE', () => {
    const story = {
      ...okStory,
      description: 'Handle validation, formatting, etc.',
    };
    const result = checkStoryGranularity(story);
    const v = result.violations.find((x) => x.rule === 'VAGUE_LANGUAGE');
    assert.ok(v);
    assert.equal(v.severity, 'warning');
  });

  it('story with "等等" flagged as VAGUE_LANGUAGE', () => {
    const story = {
      ...okStory,
      description: '处理验证、格式化等等。',
    };
    const result = checkStoryGranularity(story);
    const v = result.violations.find((x) => x.rule === 'VAGUE_LANGUAGE');
    assert.ok(v);
  });

  it('story that passes all checks returns empty violations', () => {
    const result = checkStoryGranularity(okStory);
    assert.deepEqual(result.violations, []);
    assert.equal(result.pass, true);
  });

  it('story with null/undefined description does not crash', () => {
    const story = { ...okStory, description: null };
    const result = checkStoryGranularity(story);
    // Should not throw; pass depends on other fields
    assert.ok(typeof result.pass === 'boolean');

    const story2 = { ...okStory, description: undefined };
    const result2 = checkStoryGranularity(story2);
    assert.ok(typeof result2.pass === 'boolean');
  });

  it('story with empty acceptanceCriteria does not crash', () => {
    const story = { ...okStory, acceptanceCriteria: [] };
    const result = checkStoryGranularity(story);
    assert.ok(typeof result.pass === 'boolean');
  });
});

// ---------------------------------------------------------------------------
// splitStoryByLayer
// ---------------------------------------------------------------------------

describe('splitStoryByLayer', () => {
  const crossLayerStory = {
    id: 'US-003',
    title: 'Full-stack feature',
    description: 'Create a database table, build an API endpoint, and add a UI component.',
    acceptanceCriteria: [
      'Add schema migration for users table',
      'Create /api/users endpoint',
      'Build UserList component in src/components/UserList.tsx',
      'Typecheck passes',
    ],
    priority: 3,
    passes: false,
    notes: '',
  };

  it('produces correct number of stories', () => {
    const split = splitStoryByLayer(crossLayerStory);
    assert.equal(split.length, 3);
  });

  it('split stories get parentTask field set to original ID', () => {
    const split = splitStoryByLayer(crossLayerStory);
    for (const s of split) {
      assert.equal(s.parentTask, 'US-003');
    }
  });

  it('split stories have correct priority ordering (schema < backend < ui)', () => {
    const split = splitStoryByLayer(crossLayerStory);
    const byId = Object.fromEntries(split.map((s) => [s.id, s]));

    // schema gets original priority, backend +1, ui +2
    assert.equal(byId['US-003-schema'].priority, 3);
    assert.equal(byId['US-003-backend'].priority, 4);
    assert.equal(byId['US-003-ui'].priority, 5);

    // Strict ordering
    assert.ok(byId['US-003-schema'].priority < byId['US-003-backend'].priority);
    assert.ok(byId['US-003-backend'].priority < byId['US-003-ui'].priority);
  });
});

// ---------------------------------------------------------------------------
// suggestSplit
// ---------------------------------------------------------------------------

describe('suggestSplit', () => {
  it('returns "split by architecture layer" for CROSS_LAYER violation', () => {
    const story = {
      id: 'US-010',
      title: 'Feature',
      description: 'Create a database table and a UI component.',
      acceptanceCriteria: ['Migration runs', 'Component renders'],
      priority: 1,
      passes: false,
      notes: '',
    };
    const { violations } = checkStoryGranularity(story);
    const suggestion = suggestSplit(story, violations);
    assert.ok(suggestion.strategies.includes('split by architecture layer'));
    assert.ok(suggestion.suggestedStories.length >= 2);
  });

  it('returns "split by functional boundary" for TOO_MANY_CRITERIA', () => {
    const story = {
      id: 'US-011',
      title: 'Big feature',
      description: 'A focused feature.',
      acceptanceCriteria: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
      priority: 2,
      passes: false,
      notes: '',
    };
    const { violations } = checkStoryGranularity(story);
    const suggestion = suggestSplit(story, violations);
    assert.ok(suggestion.strategies.includes('split by functional boundary'));
    assert.equal(suggestion.suggestedStories.length, 2);
  });

  it('returns empty suggestedStories when no violations', () => {
    const suggestion = suggestSplit(okStory, []);
    assert.equal(suggestion.strategies.length, 0);
    assert.equal(suggestion.suggestedStories.length, 0);
  });
});
