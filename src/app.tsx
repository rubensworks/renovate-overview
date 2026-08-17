import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from './components/app-shell';
import { Dashboard } from './components/dashboard';
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
import { DashboardStore } from './lib/store';
import type { IOwnerToken, ISettings, IViewer, TokenLocation } from './lib/types';

/**
 * A checked token and the account it belongs to. The two are never apart: a viewer without the
 * token that proved it could not fetch anything.
 */
interface ISession {
  token: string;
  viewer: IViewer;
}

interface ISignedInProps {
  session: ISession;
  settings: ISettings;
  tokenLocation: TokenLocation;
  ownerTokens: IOwnerToken[];
  onSettingsChange: (settings: ISettings) => void;
  onTokenSave: (token: string, remember: boolean) => Promise<void>;
  onTokenRemove: () => void;
  onOwnerTokenSave: (owner: string, token: string) => Promise<void>;
  onOwnerTokenRemove: (owner: string) => void;
  onLeave: () => void;
}

/**
 * Everything that only exists while signed in, most of all the store.
 *
 * Keeping this apart from {@link App} is what makes the store's lifetime exactly the session's:
 * signing out unmounts it, and swapping a token builds a new one instead of leaving one account's
 * rows sitting under another account's token.
 */
export function SignedIn(props: ISignedInProps) {
  const { session, settings, ownerTokens } = props;

  const store = useMemo(
    () => new DashboardStore(
      new GitHubClient(session.token, ownerTokens),
      session.viewer.login,
      settings,
      ownerTokens,
    ),
    // Settings are deliberately not a dependency: they are pushed into the store by the effect
    // below, so changing one re-searches without throwing the rows away and rebuilding the client.
    [ session, ownerTokens ],
  );

  useEffect(() => {
    void store.refresh();
    return () => store.dispose();
  }, [ store ]);

  useEffect(() => {
    store.configure(settings, ownerTokens);
  }, [ store, settings, ownerTokens ]);

  return (
    <AppShell
      viewer={session.viewer}
      settings={settings}
      tokenLocation={props.tokenLocation}
      ownerTokens={ownerTokens}
      onSettingsChange={props.onSettingsChange}
      onTokenSave={props.onTokenSave}
      onTokenRemove={props.onTokenRemove}
      onOwnerTokenSave={props.onOwnerTokenSave}
      onOwnerTokenRemove={props.onOwnerTokenRemove}
      onLeave={props.onLeave}
    >
      <Dashboard store={store} settings={settings} />
    </AppShell>
  );
}

/**
 * The application root: owns the session and the persisted settings.
 *
 * A session exists once a token has been checked against `GET /user`. Until then the setup screen
 * is all there is, and nothing has been fetched.
 */
export function App() {
  const [ settings, setSettings ] = useState<ISettings>(() => loadSettings());
  const [ session, setSession ] = useState<ISession | undefined>();
  const [ booting, setBooting ] = useState(true);
  const [ authError, setAuthError ] = useState<string | undefined>();
  const [ tokenAt, setTokenAt ] = useState<TokenLocation>(() => tokenLocation());
  const [ ownerTokens, setOwnerTokens ] = useState<IOwnerToken[]>(() => loadOwnerTokens());

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [ settings.theme ]);

  // Both ways in check the token before storing it, so a typo never ends up persisted.
  const connect = useCallback(async(fresh: string, remember: boolean) => {
    let viewer: IViewer;
    try {
      viewer = await new GitHubClient(fresh, ownerTokens).getViewer();
    } catch (error: unknown) {
      throw new Error(describeError(error));
    }
    saveToken(fresh, remember);
    saveOwnerTokens(ownerTokens, remember);
    setTokenAt(remember ? 'local' : 'session');
    setAuthError(undefined);
    setSession({ token: fresh, viewer });
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
    setSession(undefined);
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
      .then((viewer) => {
        if (!cancelled) {
          setSession({ token: stored.token, viewer });
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
    setSession(undefined);
    setAuthError(undefined);
  }, []);

  if (booting) {
    return <div className="boot">Checking stored token…</div>;
  }

  if (session === undefined) {
    return <SetupScreen onConnect={connect} initialError={authError} />;
  }

  return (
    <SignedIn
      session={session}
      settings={settings}
      tokenLocation={tokenAt}
      ownerTokens={ownerTokens}
      onSettingsChange={updateSettings}
      onTokenSave={connect}
      onTokenRemove={removeToken}
      onOwnerTokenSave={saveOwnerToken}
      onOwnerTokenRemove={removeOwnerToken}
      onLeave={leave}
    />
  );
}
