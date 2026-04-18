import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertPrdMarkdownToJson } from '../lib/prd-converter.js';

describe('prd-converter', () => {
  it('converts markdown PRD into canonical Ralph JSON', () => {
    const markdown = `
# PRD: Notifications Center

## Introduction

Build a notification center for product updates.

## User Stories

### US-001: Show notifications list
**Description:** As a user, I want to see recent notifications so that I can catch up quickly.

**Acceptance Criteria:**
- [ ] List renders latest notifications
- [ ] Empty state appears with no notifications
`;

    const prd = convertPrdMarkdownToJson(markdown);

    assert.equal(prd.project, 'notifications-center');
    assert.equal(prd.branchName, 'ralph/notifications-center');
    assert.equal(prd.description, 'Build a notification center for product updates.');
    assert.equal(prd.userStories.length, 1);
    assert.equal(prd.userStories[0].id, 'US-001');
    assert.equal(prd.userStories[0].priority, 1);
    assert.equal(prd.userStories[0].passes, false);
    assert.equal(prd.userStories[0].notes, '');
    assert.ok(prd.userStories[0].acceptanceCriteria.includes('Typecheck passes'));
  });

  it('normalizes priorities sequentially even when source ids are sparse', () => {
    const markdown = `
# PRD: Billing

## Introduction

Billing improvements.

## User Stories

### US-005: Add invoice page
**Description:** As a user, I want invoices.

**Acceptance Criteria:**
- [ ] Invoice page exists

### US-099: Add payment methods
**Description:** As a user, I want to manage payment methods.

**Acceptance Criteria:**
- [ ] Payment methods CRUD
- [ ] Typecheck passes
`;

    const prd = convertPrdMarkdownToJson(markdown);

    assert.deepEqual(prd.userStories.map((story) => story.priority), [1, 2]);
    assert.deepEqual(prd.userStories.map((story) => story.id), ['US-005', 'US-099']);
  });

  it('expands failing stories with granularity split suggestions and preserves parentTask', () => {
    const markdown = `
# PRD: Tasks

## Introduction

Task improvements.

## User Stories

### US-001: End-to-end story
**Description:** As a user, I want database model updates, API endpoint updates, and UI component updates for tasks.

**Acceptance Criteria:**
- [ ] Update database migration
- [ ] Add API endpoint
- [ ] Add UI component
`;

    const prd = convertPrdMarkdownToJson(markdown);

    assert.ok(prd.userStories.length >= 2);
    assert.ok(prd.userStories.every((story) => typeof story.priority === 'number'));
    assert.ok(prd.userStories.some((story) => story.parentTask === 'US-001'));
    assert.ok(prd.userStories.every((story) => story.acceptanceCriteria.includes('Typecheck passes')));
  });
});
