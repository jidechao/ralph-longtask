/**
 * Story granularity checker and splitter.
 *
 * Provides utilities to evaluate whether a user story is small enough for a
 * single iteration and, when it is not, to suggest how it could be split.
 */

// ---------------------------------------------------------------------------
// Layer detection regexes (shared with splitStoryByLayer)
// ---------------------------------------------------------------------------
const LAYER_PATTERNS = {
  schema: /schema|migration|table|database|column|model|数据库|表/i,
  backend: /api|endpoint|route|service|controller|server|接口/i,
  ui: /component|page|view|ui|frontend|button|form|界面|组件/i,
};

const LAYER_ORDER = ['schema', 'backend', 'ui'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count sentences in `text`.  Splits on `.`, `。`, `!`, `?` and ignores
 * empty segments.
 */
function countSentences(text) {
  if (!text) return 0;
  return text.split(/[.。!?]+/).filter((s) => s.trim().length > 0).length;
}

/**
 * Return the set of layer names whose pattern matches `text`.
 */
function detectLayers(text) {
  if (!text) return [];
  return LAYER_ORDER.filter((layer) => LAYER_PATTERNS[layer].test(text));
}

/**
 * Check whether `text` contains vague-language markers.
 */
function hasVagueLanguage(text) {
  if (!text) return false;
  return /etc\.|and so on|等等|and more|and others|\.\.\./i.test(text);
}

/**
 * Count distinct file-path / module-name references in `text`.
 * Looks for strings that resemble file paths (contain `/` or `\` followed by
 * a JS/TS extension) or dotted module identifiers.
 */
function countDistinctModules(text) {
  if (!text) return 0;
  const filePaths = text.match(/[\w/.\\-]+\.(js|ts|jsx|tsx|json|sql|prisma|css|scss|html)/gi) || [];
  const moduleRefs = text.match(/\b[a-z][\w]*(?:\/[\w]+){1,}\b/gi) || [];
  const all = [...filePaths, ...moduleRefs];
  return new Set(all.map((m) => m.toLowerCase())).size;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check a single story against the five granularity rules.
 *
 * @param {object} story – A user story object (see prd.json.example).
 * @returns {{ pass: boolean, violations: Array<{ rule: string, message: string, severity: 'error'|'warning', layers?: string[] }> }}
 */
export function checkStoryGranularity(story) {
  const violations = [];

  const description = story.description ?? '';
  const criteria = story.acceptanceCriteria ?? [];

  // Rule 1 – TOO_MANY_SENTENCES
  const sentenceCount = countSentences(description);
  if (sentenceCount > 3) {
    violations.push({
      rule: 'TOO_MANY_SENTENCES',
      message: `Description has ${sentenceCount} sentences (max 3)`,
      severity: 'error',
    });
  }

  // Rule 2 – TOO_MANY_CRITERIA
  if (criteria.length > 6) {
    violations.push({
      rule: 'TOO_MANY_CRITERIA',
      message: `Has ${criteria.length} acceptance criteria (max 6)`,
      severity: 'error',
    });
  }

  // Rule 3 – CROSS_LAYER
  const matchedLayers = detectLayers(description);
  if (matchedLayers.length >= 2) {
    violations.push({
      rule: 'CROSS_LAYER',
      message: `Description spans multiple layers: ${matchedLayers.join(', ')}`,
      severity: 'error',
      layers: matchedLayers,
    });
  }

  // Rule 4 – VAGUE_LANGUAGE
  const allTexts = [description, ...criteria];
  if (allTexts.some(hasVagueLanguage)) {
    violations.push({
      rule: 'VAGUE_LANGUAGE',
      message: 'Contains vague language (e.g. "etc.", "...", "and so on")',
      severity: 'warning',
    });
  }

  // Rule 5 – TOO_BROAD
  const moduleCount = countDistinctModules(description);
  if (moduleCount > 3) {
    violations.push({
      rule: 'TOO_BROAD',
      message: `Description references ${moduleCount} distinct modules/paths (max 3)`,
      severity: 'warning',
    });
  }

  return { pass: violations.length === 0, violations };
}

/**
 * Split a story into one sub-story per architecture layer detected in its
 * description.
 *
 * Layer priority order: schema < backend < ui.
 *
 * @param {object} story – Original user story.
 * @returns {object[]} Array of sub-stories.
 */
export function splitStoryByLayer(story) {
  const layers = detectLayers(story.description ?? '');
  if (layers.length === 0) return [];

  const description = story.description ?? '';
  const criteria = story.acceptanceCriteria ?? [];
  const originalPriority = story.priority ?? 1;

  const layerPriorityOffset = { schema: 0, backend: 1, ui: 2 };

  return layers.map((layer, idx) => {
    // Distribute criteria: try to match each criterion to a layer.
    const layerCriteria = criteria.filter((c) => {
      const cLayers = detectLayers(c);
      // If the criterion mentions any layer, only assign it if it matches
      // the current one.  If it mentions no layers it falls through to
      // the lowest layer (idx === 0).
      if (cLayers.length === 0) return idx === 0;
      return cLayers.includes(layer);
    });

    // If no criteria matched, keep all criteria on the lowest layer so
    // nothing is lost.
    const finalCriteria = layerCriteria.length > 0
      ? layerCriteria
      : (idx === 0 ? criteria : []);

    return {
      id: `${story.id}-${layer}`,
      title: `${story.title} - [${layer}] part`,
      description: `[${layer} layer] ${description}`,
      acceptanceCriteria: finalCriteria,
      priority: originalPriority + (layerPriorityOffset[layer] ?? idx),
      passes: false,
      notes: '',
      parentTask: story.id,
    };
  });
}

/**
 * Suggest how to split a story based on its violations.
 *
 * @param {object} story – Original user story.
 * @param {object[]} violations – From checkStoryGranularity.
 * @returns {{ strategies: string[], suggestedStories: object[] }}
 */
export function suggestSplit(story, violations) {
  if (!violations || violations.length === 0) {
    return { strategies: [], suggestedStories: [] };
  }

  const ruleNames = violations.map((v) => v.rule);

  // Strategy: split by architecture layer
  if (ruleNames.includes('CROSS_LAYER')) {
    return {
      strategies: ['split by architecture layer'],
      suggestedStories: splitStoryByLayer(story),
    };
  }

  // Strategy: split by functional boundary
  if (ruleNames.includes('TOO_MANY_CRITERIA')) {
    const criteria = story.acceptanceCriteria ?? [];
    const mid = Math.ceil(criteria.length / 2);
    const basePriority = story.priority ?? 1;
    const suggestedStories = [
      {
        id: `${story.id}-a`,
        title: `${story.title} (part A)`,
        description: story.description ?? '',
        acceptanceCriteria: criteria.slice(0, mid),
        priority: basePriority,
        passes: false,
        notes: '',
        parentTask: story.id,
      },
      {
        id: `${story.id}-b`,
        title: `${story.title} (part B)`,
        description: story.description ?? '',
        acceptanceCriteria: criteria.slice(mid),
        priority: basePriority + 1,
        passes: false,
        notes: '',
        parentTask: story.id,
      },
    ];
    return {
      strategies: ['split by functional boundary'],
      suggestedStories,
    };
  }

  // Strategy: split by CRUD operation
  if (ruleNames.includes('TOO_MANY_SENTENCES')) {
    const crudPattern = /\b(create|read|update|delete|add|edit|remove|get|list|modify|insert|select|fetch)\b/gi;
    const description = story.description ?? '';
    const ops = [...new Set((description.match(crudPattern) || []).map((o) => o.toLowerCase()))];

    if (ops.length >= 2) {
      const basePriority = story.priority ?? 1;
      const suggestedStories = ops.map((op, idx) => ({
        id: `${story.id}-${op}`,
        title: `${story.title} - ${op}`,
        description: `${op.charAt(0).toUpperCase() + op.slice(1)} operation for: ${description}`,
        acceptanceCriteria: story.acceptanceCriteria ?? [],
        priority: basePriority + idx,
        passes: false,
        notes: '',
        parentTask: story.id,
      }));
      return {
        strategies: ['split by CRUD operation'],
        suggestedStories,
      };
    }
  }

  // Default fallback
  return {
    strategies: ['split into smaller units'],
    suggestedStories: [],
  };
}
