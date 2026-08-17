import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IAppShellProps } from '../../src/components/app-shell';
import { AppShell } from '../../src/components/app-shell';
import { SOURCE_URL } from '../../src/lib/links';
import type { ISettings } from '../../src/lib/types';

afterEach(cleanup);

const SETTINGS: ISettings = {
  orgs: [],
  extraAuthors: [],
  includeDependabot: false,
  writeActions: false,
  mergeMethod: 'squash',
  repoMergeMethods: {},
  theme: 'auto',
};

function renderShell(overrides: Partial<IAppShellProps> = {}) {
  const props: IAppShellProps = {
    viewer: { login: 'rubensworks', name: 'Ruben Taelman', avatarUrl: 'https://avatars.githubusercontent.com/u/440384?v=4' },
    settings: SETTINGS,
    tokenLocation: 'local',
    ownerTokens: [],
    onSettingsChange: () => {},
    onTokenSave: async() => {},
    onTokenRemove: () => {},
    onOwnerTokenSave: async() => {},
    onOwnerTokenRemove: () => {},
    onLeave: () => {},
    children: <p>body</p>,
    ...overrides,
  };
  render(<AppShell {...props} />);
}

describe('AppShell', () => {
  it('renders its children', () => {
    renderShell();
    expect(screen.getByText('body')).toBeDefined();
  });

  it('names the signed-in user', () => {
    renderShell();
    expect(screen.getByText('rubensworks')).toBeDefined();
  });

  it('loads the avatar from the one non-API host, with no token attached', () => {
    renderShell();
    const avatars = document.querySelectorAll('img');
    expect(avatars).toHaveLength(1);
    expect(avatars[0]?.getAttribute('src'))
      .toBe('https://avatars.githubusercontent.com/u/440384?v=4');
    // Decorative: the login beside it already names the user.
    expect(avatars[0]?.getAttribute('alt')).toBe('');
  });

  it('says the app is read-only until the write actions are switched on', () => {
    renderShell();
    expect(screen.getByText('Read-only')).toBeDefined();
    expect(screen.queryByText('Write actions on')).toBeNull();
  });

  it('says so once the write actions are switched on', () => {
    renderShell({ settings: { ...SETTINGS, writeActions: true }});
    expect(screen.getByText('Write actions on')).toBeDefined();
    expect(screen.queryByText('Read-only')).toBeNull();
  });

  it('keeps the settings drawer closed until asked', () => {
    renderShell();
    const toggle = screen.getByRole('button', { name: 'Settings' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Where to look' })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Where to look' })).toBeDefined();

    fireEvent.click(toggle);
    expect(screen.queryByRole('heading', { name: 'Where to look' })).toBeNull();
  });

  it('signs out', () => {
    const onLeave = vi.fn();
    renderShell({ onLeave });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('links to its own source and restates where the token lives', () => {
    renderShell();
    const link = screen.getByRole('link', { name: 'rubensworks/renovate-overview' });
    expect(link.getAttribute('href')).toBe(SOURCE_URL);
    expect(document.body.textContent).toContain('the only hosts contacted are api.github.com');
  });
});
