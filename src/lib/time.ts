const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Formats a timestamp as a compact relative age, such as `12s`, `4m` or `3d`.
 *
 * Renovate backlogs are measured in weeks, so this stops at days rather than growing a "months"
 * unit: `94d` says "far too long" more plainly than "3mo".
 * @param iso An ISO 8601 timestamp.
 * @param now The current time in milliseconds.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return '—';
  }
  const delta = Math.max(0, now - timestamp);
  if (delta < MINUTE) {
    return `${Math.floor(delta / 1000)}s`;
  }
  if (delta < HOUR) {
    return `${Math.floor(delta / MINUTE)}m`;
  }
  if (delta < DAY) {
    return `${Math.floor(delta / HOUR)}h`;
  }
  return `${Math.floor(delta / DAY)}d`;
}

/**
 * Formats an absolute timestamp for use in tooltips.
 * @param iso An ISO 8601 timestamp.
 */
export function formatAbsolute(iso: string): string {
  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? '—' : new Date(timestamp).toLocaleString();
}

/**
 * Formats the time until an ISO timestamp as a short `12m` style string.
 * @param iso An ISO 8601 timestamp.
 * @param now The current time in milliseconds.
 */
export function formatUntil(iso: string, now: number = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return '—';
  }
  const delta = Math.max(0, timestamp - now);
  if (delta < MINUTE) {
    return `${Math.ceil(delta / 1000)}s`;
  }
  return `${Math.ceil(delta / MINUTE)}m`;
}
