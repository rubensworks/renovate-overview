import { useState } from 'react';
import { SOURCE_URL } from '../lib/links';
import type { IOwnerToken, ISettings, IViewer, TokenLocation } from '../lib/types';
import { SettingsPanel } from './settings-panel';

export interface IAppShellProps {
  viewer: IViewer;
  settings: ISettings;
  tokenLocation: TokenLocation;
  ownerTokens: IOwnerToken[];
  onSettingsChange: (settings: ISettings) => void;
  onTokenSave: (token: string, remember: boolean) => Promise<void>;
  onTokenRemove: () => void;
  onOwnerTokenSave: (owner: string, token: string) => Promise<void>;
  onOwnerTokenRemove: (owner: string) => void;
  onLeave: () => void;
  children: React.ReactNode;
}

/**
 * The frame around the dashboard: who is signed in, whether the app may write, the settings
 * drawer, and the way out.
 *
 * The viewer is shown by login only. Rendering their avatar would make the browser fetch from
 * `avatars.githubusercontent.com`, and `api.github.com` is the only host this app contacts.
 */
export function AppShell(props: IAppShellProps) {
  const { viewer, settings, onLeave, children } = props;
  const [ settingsOpen, setSettingsOpen ] = useState(false);
  const modeHint = settings.writeActions ?
    'Merge, approve, rebase and close are available.' :
    'Nothing on this page can change anything on GitHub.';

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">Renovate Overview</h1>
        <span
          className={`badge ${settings.writeActions ? 'badge--write' : 'badge--read'}`}
          title={modeHint}
        >
          {settings.writeActions ? 'Write actions on' : 'Read-only'}
        </span>
        <span className="header__spacer" />
        <span className="header__viewer">{viewer.login}</span>
        <button
          className={`button button--ghost ${settingsOpen ? 'button--active' : ''}`}
          type="button"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(open => !open)}
        >
          Settings
        </button>
        <button className="button button--ghost" type="button" onClick={onLeave}>Sign out</button>
      </header>

      {settingsOpen ?
          (
            <SettingsPanel
              settings={settings}
              tokenLocation={props.tokenLocation}
              ownerTokens={props.ownerTokens}
              onChange={props.onSettingsChange}
              onTokenSave={props.onTokenSave}
              onTokenRemove={props.onTokenRemove}
              onOwnerTokenSave={props.onOwnerTokenSave}
              onOwnerTokenRemove={props.onOwnerTokenRemove}
            />
          ) :
        null}

      <main className="app__body">{children}</main>

      <footer className="footer">
        <a className="link" href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
          rubensworks/renovate-overview
        </a>
        <span className="footer__note">
          Your token stays in this browser; the only host contacted is api.github.com.
        </span>
      </footer>
    </div>
  );
}
