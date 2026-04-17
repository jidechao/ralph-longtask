import { existsSync, writeFileSync, appendFileSync } from 'node:fs';

/**
 * Get local time in ISO 8601 format (not UTC).
 */
function localISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Initialize the progress file with an ISO 8601 timestamp header.
 * No-op if the file already exists.
 * @param {string} filePath - Absolute path to progress.txt
 */
export function initProgress(filePath) {
  if (existsSync(filePath)) return;
  const header = `# Ralph Progress Log\nStarted: ${localISO()}\n---\n`;
  writeFileSync(filePath, header, 'utf-8');
}

/**
 * Append an iteration log entry to the progress file.
 * @param {string} filePath - Absolute path to progress.txt
 * @param {{ storyId: string, summary: string, failed?: boolean }} entry
 */
export function appendProgress(filePath, entry) {
  const ts = localISO();
  const marker = entry.failed ? ' [FAILED]' : '';
  const section = [
    '',
    `## ${ts} - ${entry.storyId}${marker}`,
    entry.summary,
  ].join('\n');
  appendFileSync(filePath, section + '\n', 'utf-8');
}
