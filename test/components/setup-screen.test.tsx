import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '../../src/components/setup-screen';
import { SOURCE_URL, TOKEN_URL } from '../../src/lib/links';

afterEach(cleanup);

function noConnect(): Promise<void> {
  return Promise.resolve();
}

function renderSetup(
  onConnect: (token: string, remember: boolean) => Promise<void> = noConnect,
  initialError?: string,
): HTMLInputElement {
  render(<SetupScreen onConnect={onConnect} initialError={initialError} />);
  return screen.getByPlaceholderText('github_pat_...');
}

function connect(): HTMLElement {
  return screen.getByRole('button', { name: 'Connect' });
}

describe('SetupScreen', () => {
  it('links to the fine-grained token page', () => {
    renderSetup();
    const link = screen.getByRole('link', { name: 'Create a fine-grained token' });
    expect(link.getAttribute('href')).toBe(TOKEN_URL);
  });

  it('links to its own source, since it is asking for a token', () => {
    renderSetup();
    const links = screen.getAllByRole('link', { name: /read the source|rubensworks\/renovate-overview/u });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe(SOURCE_URL);
      expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    }
  });

  it('names the three read-only permissions it needs', () => {
    renderSetup();
    const section = screen.getByRole('heading', { name: 'Which permissions does it need?' }).parentElement;
    expect(section?.textContent).toContain('Pull requests: read-only');
    expect(section?.textContent).toContain('Checks: read-only');
    expect(section?.textContent).toContain('Commit statuses: read-only');
  });

  it('says that the write actions are off until asked for', () => {
    renderSetup();
    expect(document.body.textContent).toContain('switched off');
  });

  it('shows an error carried over from a rejected stored token', () => {
    renderSetup(noConnect, 'Stored token could not be used: Token is invalid or expired');
    expect(screen.getByRole('alert').textContent).toContain('Token is invalid or expired');
  });

  it('refuses to submit an empty token', () => {
    const onConnect = vi.fn(noConnect);
    renderSetup(onConnect);
    fireEvent.click(connect());
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Paste a token first.');
  });

  it('refuses a token that is only whitespace', () => {
    const onConnect = vi.fn(noConnect);
    const input = renderSetup(onConnect);
    fireEvent.change(input, { target: { value: '   ' }});
    fireEvent.click(connect());
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('connects with a trimmed token, remembered by default', async() => {
    const onConnect = vi.fn(noConnect);
    const input = renderSetup(onConnect);
    fireEvent.change(input, { target: { value: ' github_pat_x ' }});
    fireEvent.click(connect());
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('github_pat_x', true));
  });

  it('keeps the token for this tab only when asked to forget', async() => {
    const onConnect = vi.fn(noConnect);
    const input = renderSetup(onConnect);
    fireEvent.change(input, { target: { value: 'github_pat_x' }});
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(connect());
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('github_pat_x', false));
  });

  it('masks the token field and keeps it out of autocomplete', () => {
    const input = renderSetup();
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
  });

  it('reports a rejected token', async() => {
    const input = renderSetup(async() => {
      throw new Error('Token is invalid or expired');
    });
    fireEvent.change(input, { target: { value: 'bad' }});
    fireEvent.click(connect());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Token is invalid or expired'));
  });

  it('reports a rejection that is not an error', async() => {
    const input = renderSetup(async() => {
      // eslint-disable-next-line no-throw-literal
      throw 'odd';
    });
    fireEvent.change(input, { target: { value: 'bad' }});
    fireEvent.click(connect());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('odd'));
  });

  it('blocks a second submission while the first is still being checked', async() => {
    let release = (): void => {};
    const onConnect = vi.fn(async() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const input = renderSetup(onConnect);
    fireEvent.change(input, { target: { value: 'github_pat_x' }});
    fireEvent.click(connect());

    const busy = await screen.findByRole('button', { name: 'Checking token…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeDefined());
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});
