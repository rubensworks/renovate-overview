import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusFooter } from '../../src/components/status-footer';
import { INITIAL_STATE } from '../../src/lib/store';
import type { IDashboardState } from '../../src/lib/types';
import { pr } from '../fixtures';

afterEach(cleanup);

const NOW = Date.parse('2026-08-17T12:00:00Z');

function renderFooter(overrides: Partial<IDashboardState> = {}): HTMLElement {
  const { container } = render(
    <StatusFooter state={{ ...INITIAL_STATE, ...overrides }} now={NOW} />,
  );
  return container;
}

describe('StatusFooter', () => {
  it('counts what is loaded when idle', () => {
    renderFooter({ prs: [ pr() ]});
    expect(screen.getByText('1 open')).toBeDefined();
  });

  it('counts what has arrived so far while loading', () => {
    renderFooter({ prs: [ pr() ], loading: true });
    expect(screen.getByText('Loading… 1 so far')).toBeDefined();
  });

  it('says how long ago the data was refreshed, once it has been', () => {
    expect(renderFooter().textContent).not.toContain('updated');
    cleanup();
    const container = renderFooter({ lastRefreshedAt: NOW - 240_000 });
    expect(container.textContent).toContain('updated 4m ago');
  });

  it('says when polling is paused because nobody is looking', () => {
    renderFooter({ paused: true });
    expect(screen.getByText('Paused — tab is hidden')).toBeDefined();
  });

  it('says how long it is holding off for, and why', () => {
    const container = renderFooter({
      backoffUntil: NOW + 90_000,
      backoffReason: 'GraphQL quota nearly spent — polling paused',
    });
    expect(container.textContent).toContain('GraphQL quota nearly spent — polling paused (2m)');
  });

  it('falls back to a plain word when the reason went missing', () => {
    const container = renderFooter({ backoffUntil: NOW + 60_000, backoffReason: undefined });
    expect(container.textContent).toContain('Backing off');
  });

  it('ignores a hold-off that has already expired', () => {
    renderFooter({ prs: [ pr() ], backoffUntil: NOW - 1000, backoffReason: 'over' });
    expect(screen.getByText('1 open')).toBeDefined();
  });

  it('reports the REST quota beside the GraphQL one, once anything has spent it', () => {
    const container = renderFooter({
      rateLimit: { limit: 5000, cost: 1, remaining: 4000, resetAt: '2026-08-17T12:30:00Z' },
      restRateLimit: { limit: 5000, remaining: 4321, reset: 0 },
    });
    expect(container.textContent).toContain('4321/5000 REST');
  });

  it('says nothing about the quota until one is reported', () => {
    expect(renderFooter().textContent).toContain('GraphQL quota unknown');
  });

  it('reports the quota, the cost of the last query, and when it resets', () => {
    const container = renderFooter({
      rateLimit: { limit: 5000, cost: 3, remaining: 4000, resetAt: '2026-08-17T12:30:00Z' },
    });
    expect(container.textContent).toContain('4000/5000 GraphQL points');
    expect(container.textContent).toContain('last query cost 3');
    expect(container.textContent).toContain('resets in 30m');
  });

  it.each([
    [ 4000, 'ok' ],
    [ 1000, 'warn' ],
    [ 100, 'low' ],
  ])('colours a quota of %d as %s', (remaining, level) => {
    const container = renderFooter({
      rateLimit: { limit: 5000, cost: 1, remaining, resetAt: '2026-08-17T12:30:00Z' },
    });
    expect(container.querySelector(`.status__quota--${level}`)).not.toBeNull();
  });

  it('keeps the quota bar visible even when the quota is spent', () => {
    const container = renderFooter({
      rateLimit: { limit: 5000, cost: 1, remaining: 0, resetAt: '2026-08-17T12:30:00Z' },
    });
    expect(container.querySelector('.status__quota-fill')?.getAttribute('style')).toContain('width: 2%');
  });

  it('shows an error when one is set', () => {
    renderFooter({ error: 'Rate limit exceeded' });
    expect(screen.getByText('Rate limit exceeded')).toBeDefined();
  });

  it('warns per owner whose results were cut off at the search ceiling', () => {
    renderFooter({ truncated: [{ label: 'comunica', count: 1400 }]});
    expect(screen.getByText(/comunica has 1400\+ matches/u)).toBeDefined();
  });
});
