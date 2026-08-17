import { useCallback, useEffect, useState } from 'react';
import { AppShell } from './components/app-shell';
import { SetupScreen } from './components/setup-screen';
import { GitHubClient, describeError } from './lib/githubClient';
import {
  clearOwnerTokens,
  clearToken,
  loadOwnerTokens,
  loadSettings,
  loadToken,
  saveOwnerTokens,
  saveSettings,
  saveToken,
  tokenLocation,
} from './lib/storage';
import type { IOwnerToken, ISettings, IViewer, TokenLocation } from './lib/types';

/**
 * The application root: owns the session and the persisted settings.
 *
 * A session exists once a token has been checked against `GET /user`. Until then the setup screen
 * is all there is, and nothing has been fetched.
 */
export function App() {
  const [ settings, setSettings ] = useState<ISettings>(() => loadSettings());
  const [ viewer, setViewer ] = useState<IViewer | undefined>();
  const [ booting, setBooting ] = useState(true);
  const [ authError, setAuthError ] = useState<string | undefined>();
  const [ tokenAt, setTokenAt ] = useState<TokenLocation>(() => tokenLocation());
  const [ ownerTokens, setOwnerTokens ] = useState<IOwnerToken[]>(() => loadOwnerTokens());

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [ settings.theme ]);

  // Both ways in check the token before storing it, so a typo never ends up persisted.
  const connect = useCallback(async(fresh: string, remember: boolean) => {
    let checked: IViewer;
    try {
      checked = await new GitHubClient(fresh, ownerTokens).getViewer();
    } catch (error: unknown) {
      throw new Error(describeError(error));
    }
    saveToken(fresh, remember);
    saveOwnerTokens(ownerTokens, remember);
    setTokenAt(remember ? 'local' : 'session');
    setAuthError(undefined);
    setViewer(checked);
  }, [ ownerTokens ]);

  // An organisation token is checked against the organisation listing before it is kept, since
  // that is the one call a token belonging to another resource owner cannot make. Adding one also
  // puts the organisation on the dashboard, which is invariably what it was added for.
  const saveOwnerToken = useCallback(async(owner: string, fresh: string) => {
    try {
      await new GitHubClient(fresh, [{ owner, token: fresh }]).checkOrgAccess(owner);
    } catch (error: unknown) {
      throw new Error(describeError(error));
    }
    const others = ownerTokens.filter(entry => entry.owner.toLowerCase() !== owner.toLowerCase());
    const next = [ ...others, { owner, token: fresh }];
    saveOwnerTokens(next, tokenAt !== 'session');
    setOwnerTokens(next);
    setSettings((current) => {
      if (current.orgs.some(entry => entry.toLowerCase() === owner.toLowerCase())) {
        return current;
      }
      const updated = { ...current, orgs: [ ...current.orgs, owner ]};
      saveSettings(updated);
      return updated;
    });
  }, [ ownerTokens, tokenAt ]);

  const removeOwnerToken = useCallback((owner: string) => {
    const next = ownerTokens.filter(entry => entry.owner.toLowerCase() !== owner.toLowerCase());
    saveOwnerTokens(next, tokenAt !== 'session');
    setOwnerTokens(next);
  }, [ ownerTokens, tokenAt ]);

  // Removing the token without signing out leaves the organisation tokens in place, so the next
  // one pasted picks them straight back up.
  const removeToken = useCallback(() => {
    clearToken();
    setTokenAt('none');
    setViewer(undefined);
  }, []);

  useEffect(() => {
    const stored = loadToken();
    if (stored === undefined) {
      setTokenAt('none');
      setBooting(false);
      return;
    }
    let cancelled = false;
    new GitHubClient(stored.token, loadOwnerTokens()).getViewer()
      .then((checked) => {
        if (!cancelled) {
          setViewer(checked);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          clearToken();
          setTokenAt('none');
          setAuthError(`Stored token could not be used: ${describeError(error)}`);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBooting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback((next: ISettings) => {
    saveSettings(next);
    setSettings(next);
  }, []);

  const leave = useCallback(() => {
    clearToken();
    clearOwnerTokens();
    setOwnerTokens([]);
    setTokenAt('none');
    setViewer(undefined);
    setAuthError(undefined);
  }, []);

  if (booting) {
    return <div className="boot">Checking stored token…</div>;
  }

  if (viewer === undefined) {
    return <SetupScreen onConnect={connect} initialError={authError} />;
  }

  return (
    <AppShell
      viewer={viewer}
      settings={settings}
      tokenLocation={tokenAt}
      ownerTokens={ownerTokens}
      onSettingsChange={updateSettings}
      onTokenSave={connect}
      onTokenRemove={removeToken}
      onOwnerTokenSave={saveOwnerToken}
      onOwnerTokenRemove={removeOwnerToken}
      onLeave={leave}
    >
      <p className="placeholder">
        Signed in as {viewer.login}. The pull request list arrives in the next milestone.
      </p>
    </AppShell>
  );
}
