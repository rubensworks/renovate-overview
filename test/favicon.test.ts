import { afterEach, describe, expect, it } from 'vitest';
import { applyOverallStatus } from '../src/lib/favicon';

afterEach(() => {
  document.head.innerHTML = '';
  document.title = '';
});

function iconHref(): string {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href ?? '';
}

describe('applyOverallStatus', () => {
  it('creates the icon link when the page has none', () => {
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
    applyOverallStatus('success', 3, 0);
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.type).toBe('image/svg+xml');
  });

  it('reuses the link the page already has', () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
    applyOverallStatus('success', 1, 0);
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });

  it('counts what is open, and what is failing in preference', () => {
    applyOverallStatus('success', 12, 0);
    expect(document.title).toBe('(12) Renovate Overview');
    applyOverallStatus('failure', 12, 3);
    expect(document.title).toBe('(3✕) Renovate Overview');
  });

  it('says nothing in the title when there is nothing at all', () => {
    applyOverallStatus('none', 0, 0);
    expect(document.title).toBe('Renovate Overview');
  });

  it('colours the icon by the worst state, so a pinned tab is a monitor', () => {
    applyOverallStatus('success', 1, 0);
    const green = iconHref();
    applyOverallStatus('failure', 1, 1);
    expect(iconHref()).not.toBe(green);
    expect(decodeURIComponent(iconHref())).toContain('#f85149');
    applyOverallStatus('pending', 1, 0);
    expect(decodeURIComponent(iconHref())).toContain('#d29922');
    applyOverallStatus('error', 1, 1);
    expect(decodeURIComponent(iconHref())).toContain('#f85149');
    applyOverallStatus('none', 1, 0);
    expect(decodeURIComponent(iconHref())).toContain('#8b949e');
  });

  it('embeds the icon rather than fetching one', () => {
    applyOverallStatus('success', 1, 0);
    expect(iconHref().startsWith('data:image/svg+xml,')).toBe(true);
  });
});
