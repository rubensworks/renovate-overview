import type { CheckState } from './types';

const COLORS: Record<CheckState, string> = {
  failure: '#f85149',
  error: '#f85149',
  pending: '#d29922',
  success: '#3fb950',
  none: '#8b949e',
};

const BASE_TITLE = 'Renovate Overview';

function faviconSvg(state: CheckState): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
    '<rect width="32" height="32" rx="7" fill="#0d1117"/>',
    `<path d="M16 8a8 8 0 1 0 7.4 5" fill="none" stroke="${COLORS[state]}" stroke-width="3.2" stroke-linecap="round"/>`,
    `<path d="M17 4.5 24 8l-6.6 3.6z" fill="${COLORS[state]}"/>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Reflects the state of the backlog in the tab title and favicon.
 *
 * A pinned tab is then a passive monitor: the colour says whether anything is failing and the
 * count says how much is waiting, without the tab ever being looked at directly.
 * @param state The worst check state across the whole list.
 * @param openCount How many pull requests are open.
 * @param failingCount How many of them are failing.
 */
export function applyOverallStatus(state: CheckState, openCount: number, failingCount: number): void {
  const prefix = failingCount > 0 ? `(${failingCount}✕) ` : (openCount > 0 ? `(${openCount}) ` : '');
  document.title = `${prefix}${BASE_TITLE}`;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link === null) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.type = 'image/svg+xml';
  link.href = faviconSvg(state);
}
