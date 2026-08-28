import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ISettingsPanelProps } from '../../src/components/settings-panel';
import { SettingsPanel } from '../../src/components/settings-panel';
import type { IOwnerToken, ISettings, TokenLocation } from '../../src/lib/types';

afterEach(cleanup);

const SETTINGS: ISettings = {
  orgs: [ 'comunica' ],
  excludedRepos: [],
  extraAuthors: [],
  includeDependabot: false,
  writeActions: false,
  mergeMethod: 'squash',
  repoMergeMethods: {},
  theme: 'auto',
};

interface IHarness {
  changes: ISettings[];
  savedTokens: [string, boolean][];
  savedOwnerTokens: [string, string][];
  removedOwners: string[];
  removedToken: number;
}

function renderPanel(overrides: Partial<ISettingsPanelProps> = {}, settings: ISettings = SETTINGS): IHarness {
  const harness: IHarness = {
    changes: [],
    savedTokens: [],
    savedOwnerTokens: [],
    removedOwners: [],
    removedToken: 0,
  };
  const props: ISettingsPanelProps = {
    settings,
    tokenLocation: 'local',
    ownerTokens: [],
    onChange: next => harness.changes.push(next),
    onTokenSave: async(token, remember) => {
      harness.savedTokens.push([ token, remember ]);
    },
    onTokenRemove: () => {
      harness.removedToken += 1;
    },
    onOwnerTokenSave: async(owner, token) => {
      harness.savedOwnerTokens.push([ owner, token ]);
    },
    onOwnerTokenRemove: owner => harness.removedOwners.push(owner),
    ...overrides,
  };
  render(<SettingsPanel {...props} />);
  return harness;
}

describe('SettingsPanel', () => {
  it('lists the organisations one per line', () => {
    renderPanel();
    expect((screen.getByLabelText('Organisations') as HTMLTextAreaElement).value).toBe('comunica');
  });

  it('parses the organisations on blur, dropping separators and leading at-signs', () => {
    const harness = renderPanel();
    const field = screen.getByLabelText('Organisations');
    fireEvent.change(field, { target: { value: '@comunica, rubensworks\n\n  solid ' }});
    fireEvent.blur(field);
    expect(harness.changes.at(-1)?.orgs).toEqual([ 'comunica', 'rubensworks', 'solid' ]);
  });

  it('lists the excluded repositories one per line', () => {
    const harness = renderPanel({}, { ...SETTINGS, excludedRepos: [ 'comunica/incremunica' ]});
    expect(harness.changes).toEqual([]);
    expect((screen.getByLabelText('Excluded repositories') as HTMLTextAreaElement).value)
      .toBe('comunica/incremunica');
  });

  it('parses the excluded repositories on blur, pasted URL and all', () => {
    const harness = renderPanel();
    const field = screen.getByLabelText('Excluded repositories');
    fireEvent.change(field, {
      target: { value: 'comunica/incremunica\nhttps://github.com/rubensworks/jbr.js' },
    });
    fireEvent.blur(field);
    expect(harness.changes.at(-1)?.excludedRepos)
      .toEqual([ 'comunica/incremunica', 'https://github.com/rubensworks/jbr.js' ]);
  });

  it('parses the extra bot logins on blur', () => {
    const harness = renderPanel();
    const field = screen.getByLabelText('Extra bot logins');
    fireEvent.change(field, { target: { value: 'my-renovate' }});
    fireEvent.blur(field);
    expect(harness.changes.at(-1)?.extraAuthors).toEqual([ 'my-renovate' ]);
  });

  it('re-reads the drafts when the settings change underneath it', () => {
    const { rerender } = render(
      <SettingsPanel
        settings={SETTINGS}
        tokenLocation="local"
        ownerTokens={[]}
        onChange={() => {}}
        onTokenSave={async() => {}}
        onTokenRemove={() => {}}
        onOwnerTokenSave={async() => {}}
        onOwnerTokenRemove={() => {}}
      />,
    );
    rerender(
      <SettingsPanel
        settings={{ ...SETTINGS, orgs: [ 'solid' ], extraAuthors: [ 'bot' ], excludedRepos: [ 'a/b' ]}}
        tokenLocation="local"
        ownerTokens={[]}
        onChange={() => {}}
        onTokenSave={async() => {}}
        onTokenRemove={() => {}}
        onOwnerTokenSave={async() => {}}
        onOwnerTokenRemove={() => {}}
      />,
    );
    expect((screen.getByLabelText('Organisations') as HTMLTextAreaElement).value).toBe('solid');
    expect((screen.getByLabelText('Extra bot logins') as HTMLTextAreaElement).value).toBe('bot');
    // Excluding a repository from its group header writes to the settings from outside this panel.
    expect((screen.getByLabelText('Excluded repositories') as HTMLTextAreaElement).value).toBe('a/b');
  });

  it('names the bots it recognises without configuration', () => {
    renderPanel();
    expect(document.body.textContent).toContain('renovate[bot]');
    expect(document.body.textContent).toContain('renovate-bot');
  });

  it('toggles Dependabot', () => {
    const harness = renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: /Include Dependabot/u }));
    expect(harness.changes.at(-1)?.includeDependabot).toBe(true);
  });

  it('toggles the write actions', () => {
    const harness = renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: /Offer merge, approve/u }));
    expect(harness.changes.at(-1)?.writeActions).toBe(true);
  });

  it('says nothing about write permissions while the app is read-only', () => {
    renderPanel();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers a merge method only once the write actions are on', () => {
    renderPanel();
    expect(screen.queryByLabelText('Merge with')).toBeNull();
    cleanup();
    const harness = renderPanel({}, { ...SETTINGS, writeActions: true });
    fireEvent.change(screen.getByLabelText('Merge with'), { target: { value: 'rebase' }});
    expect(harness.changes.at(-1)?.mergeMethod).toBe('rebase');
  });

  it('names the write permissions once the actions are on', () => {
    renderPanel({}, { ...SETTINGS, writeActions: true });
    expect(screen.getByRole('status').textContent).toContain('Pull requests: read and write');
  });

  it('changes the theme', () => {
    const harness = renderPanel();
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' }});
    expect(harness.changes.at(-1)?.theme).toBe('dark');
  });

  it.each<[TokenLocation, string]>([
    [ 'local', 'stored in this browser' ],
    [ 'session', 'this tab only' ],
    [ 'none', 'No token is stored.' ],
  ])('says where a %s token lives', (tokenLocation, expected) => {
    renderPanel({ tokenLocation });
    expect(document.body.textContent).toContain(expected);
  });

  it('refuses an empty replacement token', () => {
    const harness = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    expect(harness.savedTokens).toEqual([]);
    expect(screen.getByRole('alert').textContent).toBe('Paste a token first.');
  });

  it('replaces the token and clears the field', async() => {
    const harness = renderPanel();
    const field = screen.getByLabelText('Replace it');
    fireEvent.change(field, { target: { value: ' github_pat_x ' }});
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    await waitFor(() => expect(harness.savedTokens).toEqual([[ 'github_pat_x', true ]]));
    expect((field as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('status').textContent).toBe('Token replaced.');
  });

  it('starts the remember box from where the token already lives', async() => {
    const harness = renderPanel({ tokenLocation: 'session' });
    fireEvent.change(screen.getByLabelText('Replace it'), { target: { value: 'x' }});
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    await waitFor(() => expect(harness.savedTokens).toEqual([[ 'x', false ]]));
  });

  it('can move the replacement token into session storage instead', async() => {
    const harness = renderPanel();
    fireEvent.change(screen.getByLabelText('Replace it'), { target: { value: 'x' }});
    fireEvent.click(screen.getByRole('checkbox', { name: /keep it for this tab only/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    await waitFor(() => expect(harness.savedTokens).toEqual([[ 'x', false ]]));
  });

  it('reports a rejected replacement token', async() => {
    renderPanel({
      onTokenSave: async() => {
        throw new Error('Token is invalid or expired');
      },
    });
    fireEvent.change(screen.getByLabelText('Replace it'), { target: { value: 'bad' }});
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Token is invalid or expired'));
  });

  it('reports a replacement rejection that is not an error', async() => {
    renderPanel({
      onTokenSave: async() => {
        // eslint-disable-next-line no-throw-literal
        throw 'odd';
      },
    });
    fireEvent.change(screen.getByLabelText('Replace it'), { target: { value: 'bad' }});
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('odd'));
  });

  it('shows progress while the replacement is checked', async() => {
    let release = (): void => {};
    renderPanel({
      onTokenSave: async() => new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    fireEvent.change(screen.getByLabelText('Replace it'), { target: { value: 'x' }});
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    expect((await screen.findByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save token' })).toBeDefined());
  });

  it('removes the stored token', () => {
    const harness = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove stored token' }));
    expect(harness.removedToken).toBe(1);
  });

  it('says when no organisation tokens are stored', () => {
    renderPanel();
    expect(document.body.textContent).toContain('None stored.');
  });

  it('lists organisation tokens by owner, never rendering the token itself', () => {
    const ownerTokens: IOwnerToken[] = [{ owner: 'comunica', token: 'github_pat_secret' }];
    renderPanel({ ownerTokens });
    expect(document.body.textContent).toContain('comunica');
    expect(document.body.innerHTML).not.toContain('github_pat_secret');
  });

  it('removes an organisation token', () => {
    const harness = renderPanel({ ownerTokens: [{ owner: 'comunica', token: 'x' }]});
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(harness.removedOwners).toEqual([ 'comunica' ]);
  });

  it('needs both an organisation and a token', () => {
    const harness = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add organisation token' }));
    expect(harness.savedOwnerTokens).toEqual([]);
    expect(screen.getByRole('alert').textContent).toBe('Both an organisation and a token are needed.');

    fireEvent.change(screen.getByLabelText('Add one'), { target: { value: 'comunica' }});
    fireEvent.click(screen.getByRole('button', { name: 'Add organisation token' }));
    expect(harness.savedOwnerTokens).toEqual([]);
  });

  it('adds an organisation token, stripping an at-sign', async() => {
    const harness = renderPanel();
    fireEvent.change(screen.getByLabelText('Add one'), { target: { value: ' @comunica ' }});
    fireEvent.change(screen.getByLabelText('Organisation token'), { target: { value: ' github_pat_x ' }});
    fireEvent.click(screen.getByRole('button', { name: 'Add organisation token' }));
    await waitFor(() => expect(harness.savedOwnerTokens).toEqual([[ 'comunica', 'github_pat_x' ]]));
    expect((screen.getByLabelText('Add one') as HTMLInputElement).value).toBe('');
  });

  it('reports a rejected organisation token', async() => {
    renderPanel({
      onOwnerTokenSave: async() => {
        throw new Error('Access forbidden');
      },
    });
    fireEvent.change(screen.getByLabelText('Add one'), { target: { value: 'comunica' }});
    fireEvent.change(screen.getByLabelText('Organisation token'), { target: { value: 'x' }});
    fireEvent.click(screen.getByRole('button', { name: 'Add organisation token' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Access forbidden'));
  });

  it('reports an organisation rejection that is not an error', async() => {
    renderPanel({
      onOwnerTokenSave: async() => {
        // eslint-disable-next-line no-throw-literal
        throw 'odd';
      },
    });
    fireEvent.change(screen.getByLabelText('Add one'), { target: { value: 'comunica' }});
    fireEvent.change(screen.getByLabelText('Organisation token'), { target: { value: 'x' }});
    fireEvent.click(screen.getByRole('button', { name: 'Add organisation token' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('odd'));
  });

  it('shows progress while an organisation token is checked', async() => {
    let release = (): void => {};
    renderPanel({
      onOwnerTokenSave: async() => new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    fireEvent.change(screen.getByLabelText('Add one'), { target: { value: 'comunica' }});
    fireEvent.change(screen.getByLabelText('Organisation token'), { target: { value: 'x' }});
    fireEvent.click(screen.getByRole('button', { name: 'Add organisation token' }));
    expect(await screen.findByRole('button', { name: 'Checking…' })).toBeDefined();
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add organisation token' })).toBeDefined());
  });
});
