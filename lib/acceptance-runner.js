import { execSync } from 'node:child_process';
import { dirname } from 'node:path';

function normalizeCriterion(criterion) {
  return (criterion || '').trim().toLowerCase();
}

export function runAcceptanceChecks(story, validationConfig = {}, options = {}) {
  const execCommand = options.execCommand || execSync;
  const cwd = options.cwd || process.cwd();
  const acceptanceCommands = validationConfig.acceptanceCommands || {};
  const criteria = story?.acceptanceCriteria || [];

  const checks = [];
  if (criteria.some((criterion) => normalizeCriterion(criterion) === 'typecheck passes') && acceptanceCommands.typecheck) {
    checks.push({ name: 'typecheck', command: acceptanceCommands.typecheck });
  }
  if (criteria.some((criterion) => normalizeCriterion(criterion) === 'tests pass') && acceptanceCommands.tests) {
    checks.push({ name: 'tests', command: acceptanceCommands.tests });
  }

  for (const check of checks) {
    try {
      execCommand(check.command, {
        cwd,
        stdio: 'pipe',
        shell: true,
      });
    } catch (error) {
      return {
        valid: false,
        reason: 'acceptance-check-failed',
        check: check.name,
        command: check.command,
        error: error.message,
      };
    }
  }

  return {
    valid: true,
    executed: checks.map((check) => check.name),
    cwd: dirname(cwd) ? cwd : process.cwd(),
  };
}
