import { describe, expect, it } from 'vitest';
import { formatAbsolute, formatRelative, formatUntil, formatUntilUnix } from '../src/lib/time';

const NOW = Date.parse('2026-08-17T12:00:00Z');

describe('formatRelative', () => {
  it('counts in seconds below a minute', () => {
    expect(formatRelative('2026-08-17T11:59:48Z', NOW)).toBe('12s');
  });

  it('counts in minutes below an hour', () => {
    expect(formatRelative('2026-08-17T11:56:00Z', NOW)).toBe('4m');
  });

  it('counts in hours below a day', () => {
    expect(formatRelative('2026-08-17T09:00:00Z', NOW)).toBe('3h');
  });

  it('counts in days above that, however many', () => {
    expect(formatRelative('2026-08-14T12:00:00Z', NOW)).toBe('3d');
    expect(formatRelative('2026-05-15T12:00:00Z', NOW)).toBe('94d');
  });

  it('never counts backwards for a clock that is slightly ahead', () => {
    expect(formatRelative('2026-08-17T12:00:30Z', NOW)).toBe('0s');
  });

  it('gives up visibly on a timestamp it cannot read', () => {
    expect(formatRelative('not a date', NOW)).toBe('—');
  });
});

describe('formatAbsolute', () => {
  it('renders a readable timestamp', () => {
    expect(formatAbsolute('2026-08-17T12:00:00Z')).toBe(new Date(NOW).toLocaleString());
  });

  it('gives up visibly on a timestamp it cannot read', () => {
    expect(formatAbsolute('nope')).toBe('—');
  });
});

describe('formatUntilUnix', () => {
  it('counts down in seconds and then in minutes', () => {
    expect(formatUntilUnix((NOW / 1000) + 30, NOW)).toBe('30s');
    expect(formatUntilUnix((NOW / 1000) + 2040, NOW)).toBe('34m');
  });

  it('never counts below zero', () => {
    expect(formatUntilUnix((NOW / 1000) - 3600, NOW)).toBe('0s');
  });

  it('gives up visibly on a timestamp it cannot read', () => {
    expect(formatUntilUnix(Number.NaN, NOW)).toBe('—');
  });
});

describe('formatUntil', () => {
  it('counts down in seconds and then in minutes', () => {
    expect(formatUntil('2026-08-17T12:00:30Z', NOW)).toBe('30s');
    expect(formatUntil('2026-08-17T12:34:00Z', NOW)).toBe('34m');
  });

  it('never counts below zero', () => {
    expect(formatUntil('2026-08-17T11:00:00Z', NOW)).toBe('0s');
  });

  it('gives up visibly on a timestamp it cannot read', () => {
    expect(formatUntil('nope', NOW)).toBe('—');
  });
});
