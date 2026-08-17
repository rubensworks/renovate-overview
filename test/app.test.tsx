import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import type { IViewer } from '../src/lib/types';
import { searchItem, searchPage } from './fixtures';

const { getViewerMock, checkOrgAccessMock, searchMock, constructorMock } = vi.hoisted(() => ({
  getViewerMock: vi.fn(),
  checkOrgAccessMock: vi.fn(),
  searchMock: vi.fn(),
  constructorMock: vi.fn(),
}));

vi.mock('../src/lib/githubClient', () => ({
  GitHubClient: class FakeClient {
    public readonly getViewer = getViewerMock;
    public readonly checkOrgAccess = checkOrgAccessMock;
    public readonly searchPrs = searchMock;
    public readonly getPr = vi.fn(async() => ({ state: 'open', head: { ref: 'r', sha: 's' }}));
    public readonly getCheckRuns = vi.fn(async() => ({ runs: [], notModified: false }));
    public readonly getCombinedStatus = vi.fn(async() => ({ statuses: []}));
    public readonly getReviews = vi.fn(async() => []);
    public readonly rateLimit = undefined;
    public readonly searchRateLimit = undefined;

    public constructor(token: string, ownerTokens: unknown) {
      constructorMock(token, ownerTokens);
    }
  },
  // The real one turns Octokit errors into sentences; here the message is already the sentence.
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

const TOKEN_KEY = 'renovate-overview:token';
const OWNER_TOKENS_KEY = 'renovate-overview:owner-tokens';
const SETTINGS_KEY = 'renovate-overview:settings';

const VIEWER: IViewer = { login: 'rubensworks', name: 'Ruben Taelman', avatarUrl: 'https://avatars.githubusercontent.com/u/440384?v=4' };

beforeEach(() => {
  getViewerMock.mockReset();
  checkOrgAccessMock.mockReset();
  constructorMock.mockReset();
  searchMock.mockReset();
  searchMock.mockResolvedValue(searchPage([]));
  localStorage.clear();
  sessionStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(cleanup);

function tokenField(): HTMLElement {
  return screen.getByPlaceholderText('github_pat_...');
}

async function connect(token = 'github_pat_x'): Promise<void> {
  fireEvent.change(tokenField(), { target: { value: token }});
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByRole('button', { name: 'Sign out' });
}

async function openSettings(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await screen.findByRole('heading', { name: 'Where to look' });
}

describe('App', () => {
  describe('booting', () => {
    it('shows the setup screen when no token is stored', async() => {
      render(<App />);
      expect(await screen.findByRole('button', { name: 'Connect' })).toBeDefined();
      expect(getViewerMock).not.toHaveBeenCalled();
    });

    it('says it is checking a stored token before deciding', () => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      getViewerMock.mockReturnValue(new Promise(() => {}));
      render(<App />);
      expect(screen.getByText('Checking stored token…')).toBeDefined();
    });

    it('signs straight in with a working stored token', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'comunica', token: 'org' }]));
      getViewerMock.mockResolvedValue(VIEWER);
      render(<App />);
      expect(await screen.findByRole('button', { name: 'Sign out' })).toBeDefined();
      expect(constructorMock).toHaveBeenCalledWith('stored', [{ owner: 'comunica', token: 'org' }]);
    });

    it('drops a stored token the API rejects, and says why', async() => {
      localStorage.setItem(TOKEN_KEY, 'stale');
      getViewerMock.mockRejectedValue(new Error('Token is invalid or expired'));
      render(<App />);
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('Stored token could not be used: Token is invalid or expired');
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('does nothing when the check resolves after the app is gone', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      let release = (_: IViewer): void => {};
      getViewerMock.mockReturnValue(new Promise<IViewer>((resolve) => {
        release = resolve;
      }));
      const { unmount } = render(<App />);
      unmount();
      release(VIEWER);
      await waitFor(() => expect(getViewerMock).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    });

    it('does nothing when the check fails after the app is gone', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      let fail = (_: Error): void => {};
      getViewerMock.mockReturnValue(new Promise<IViewer>((_resolve, reject) => {
        fail = reject;
      }));
      const { unmount } = render(<App />);
      unmount();
      fail(new Error('nope'));
      await waitFor(() => expect(getViewerMock).toHaveBeenCalled());
      // The token survives, because the component that would have cleared it is gone.
      expect(localStorage.getItem(TOKEN_KEY)).toBe('stored');
    });
  });

  describe('connecting', () => {
    it('checks a pasted token before storing it', async() => {
      getViewerMock.mockResolvedValue(VIEWER);
      render(<App />);
      await screen.findByRole('button', { name: 'Connect' });
      await connect();
      expect(localStorage.getItem(TOKEN_KEY)).toBe('github_pat_x');
      expect(screen.getByText('rubensworks')).toBeDefined();
    });

    it('keeps a token for the tab only when asked to forget', async() => {
      getViewerMock.mockResolvedValue(VIEWER);
      render(<App />);
      await screen.findByRole('button', { name: 'Connect' });
      fireEvent.change(tokenField(), { target: { value: 'github_pat_x' }});
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await screen.findByRole('button', { name: 'Sign out' });

      expect(sessionStorage.getItem(TOKEN_KEY)).toBe('github_pat_x');
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      await openSettings();
      expect(document.body.textContent).toContain('this tab only');
    });

    it('keeps a token out of storage when the API rejects it', async() => {
      getViewerMock.mockRejectedValue(new Error('Token is invalid or expired'));
      render(<App />);
      await screen.findByRole('button', { name: 'Connect' });
      fireEvent.change(tokenField(), { target: { value: 'bad' }});
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe('Token is invalid or expired'));
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    });
  });

  describe('the dashboard', () => {
    it('searches as soon as the session exists, and lists what comes back', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      getViewerMock.mockResolvedValue(VIEWER);
      searchMock.mockResolvedValue(searchPage([ searchItem() ]));
      render(<App />);

      expect(await screen.findByText('rubensworks/jbr.js')).toBeDefined();
      expect(String(searchMock.mock.calls[0]?.[0])).toContain('user:rubensworks');
    });

    it('rebuilds the store when the token is replaced, rather than keeping the old rows', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      getViewerMock.mockResolvedValue(VIEWER);
      searchMock.mockResolvedValue(searchPage([ searchItem() ]));
      render(<App />);
      await screen.findByText('rubensworks/jbr.js');
      const before = searchMock.mock.calls.length;

      await openSettings();
      fireEvent.change(screen.getByLabelText('Replace it'), { target: { value: 'fresh' }});
      fireEvent.click(screen.getByRole('button', { name: 'Save token' }));

      await waitFor(() => expect(searchMock.mock.calls.length).toBeGreaterThan(before));
      expect(constructorMock).toHaveBeenCalledWith('fresh', []);
    });

    it('surfaces a failed search in the status strip', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      getViewerMock.mockResolvedValue(VIEWER);
      searchMock.mockRejectedValue(new Error('Rate limit exceeded'));
      render(<App />);

      expect(await screen.findByText('Rate limit exceeded')).toBeDefined();
    });
  });

  describe('the theme', () => {
    it('follows the system by default, and follows the setting after that', async() => {
      getViewerMock.mockResolvedValue(VIEWER);
      render(<App />);
      await screen.findByRole('button', { name: 'Connect' });
      expect(document.documentElement.dataset.theme).toBe('auto');

      await connect();
      await openSettings();
      fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' }});
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').theme).toBe('dark');
    });
  });

  describe('organisation tokens', () => {
    it('validates one against the organisation listing, stores it, and watches that org', async() => {
      getViewerMock.mockResolvedValue(VIEWER);
      checkOrgAccessMock.mockImplementation(async() => {});
      render(<App />);
      await screen.findByRole('button', { name: 'Connect' });
      await connect();
      await openSettings();

      fireEvent.change(screen.getByLabelText('Add one'), { target: { value: 'comunica' }});
      fireEvent.change(screen.getByLabelText('Organisation token'), { target: { value: 'org_token' }});
      fireEvent.click(screen.getByRole('button', { name: 'Add organisation token' }));

      await waitFor(() => expect(checkOrgAccessMock).toHaveBeenCalledWith('comunica'));
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem(OWNER_TOKENS_KEY) ?? '[]'))
          .toEqual([{ owner: 'comunica', token: 'org_token' }]));
      // Adding a token for an organisation is only ever done to put it on the dashboard.
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').orgs).toEqual([ 'comunica' ]));
    });

    it('refuses a wrongly scoped one instead of degrading to public results', async() => {
      getViewerMock.mockResolvedValue(VIEWER);
      checkOrgAccessMock.mockRejectedValue(new Error('Access forbidden'));
      render(<App />);
      await screen.findByRole('button', { name: 'Connect' });
      await connect();
      await openSettings();

      fireEvent.change(screen.getByLabelText('Add one'), { target: { value: 'comunica' }});
      fireEvent.change(screen.getByLabelText('Organisation token'), { target: { value: 'wrong' }});
      fireEvent.click(screen.getByRole('button', { name: 'Add organisation token' }));

      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Access forbidden'));
      expect(localStorage.getItem(OWNER_TOKENS_KEY)).toBeNull();
    });

    it('replaces the token of an organisation already listed, without listing it twice', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ orgs: [ 'Comunica' ]}));
      localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'comunica', token: 'old' }]));
      getViewerMock.mockResolvedValue(VIEWER);
      checkOrgAccessMock.mockImplementation(async() => {});
      render(<App />);
      await screen.findByRole('button', { name: 'Sign out' });
      await openSettings();

      fireEvent.change(screen.getByLabelText('Add one'), { target: { value: 'COMUNICA' }});
      fireEvent.change(screen.getByLabelText('Organisation token'), { target: { value: 'new' }});
      fireEvent.click(screen.getByRole('button', { name: 'Add organisation token' }));

      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem(OWNER_TOKENS_KEY) ?? '[]'))
          .toEqual([{ owner: 'COMUNICA', token: 'new' }]));
      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').orgs).toEqual([ 'Comunica' ]);
    });

    it('keeps an organisation token in session storage when the main one is there', async() => {
      sessionStorage.setItem(TOKEN_KEY, 'stored');
      getViewerMock.mockResolvedValue(VIEWER);
      checkOrgAccessMock.mockImplementation(async() => {});
      render(<App />);
      await screen.findByRole('button', { name: 'Sign out' });
      await openSettings();

      fireEvent.change(screen.getByLabelText('Add one'), { target: { value: 'comunica' }});
      fireEvent.change(screen.getByLabelText('Organisation token'), { target: { value: 'org' }});
      fireEvent.click(screen.getByRole('button', { name: 'Add organisation token' }));

      await waitFor(() => expect(sessionStorage.getItem(OWNER_TOKENS_KEY)).not.toBeNull());
      expect(localStorage.getItem(OWNER_TOKENS_KEY)).toBeNull();
    });

    it('removes one', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'comunica', token: 'org' }]));
      getViewerMock.mockResolvedValue(VIEWER);
      render(<App />);
      await screen.findByRole('button', { name: 'Sign out' });
      await openSettings();

      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(localStorage.getItem(OWNER_TOKENS_KEY)).toBeNull());
    });
  });

  describe('leaving', () => {
    it('removing the token returns to setup but keeps the organisation tokens', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'comunica', token: 'org' }]));
      getViewerMock.mockResolvedValue(VIEWER);
      render(<App />);
      await screen.findByRole('button', { name: 'Sign out' });
      await openSettings();

      fireEvent.click(screen.getByRole('button', { name: 'Remove stored token' }));
      expect(await screen.findByRole('button', { name: 'Connect' })).toBeDefined();
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(OWNER_TOKENS_KEY)).not.toBeNull();
    });

    it('signing out wipes both storages', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'comunica', token: 'org' }]));
      getViewerMock.mockResolvedValue(VIEWER);
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

      expect(await screen.findByRole('button', { name: 'Connect' })).toBeDefined();
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(OWNER_TOKENS_KEY)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('replacing the token from the settings keeps the session going', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      getViewerMock.mockResolvedValue(VIEWER);
      render(<App />);
      await screen.findByRole('button', { name: 'Sign out' });
      await openSettings();

      fireEvent.change(screen.getByLabelText('Replace it'), { target: { value: 'fresh' }});
      fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
      await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBe('fresh'));
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined();
    });
  });
});
