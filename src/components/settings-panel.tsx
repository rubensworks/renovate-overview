import { useEffect, useState } from 'react';
import { TOKEN_URL } from '../lib/links';
import type { IOwnerToken, ISettings, Theme, TokenLocation } from '../lib/types';
import { DEFAULT_RENOVATE_AUTHORS } from '../lib/types';

export interface ISettingsPanelProps {
  settings: ISettings;
  tokenLocation: TokenLocation;
  /**
   * Extra tokens, one per owner, shown by owner only — the tokens themselves are never rendered.
   */
  ownerTokens: IOwnerToken[];
  onChange: (settings: ISettings) => void;
  onTokenSave: (token: string, remember: boolean) => Promise<void>;
  onTokenRemove: () => void;
  onOwnerTokenSave: (owner: string, token: string) => Promise<void>;
  onOwnerTokenRemove: (owner: string) => void;
}

const TOKEN_STATUS: Record<TokenLocation, string> = {
  local: 'A token is stored in this browser.',
  session: 'A token is stored for this tab only, and is dropped when it closes.',
  none: 'No token is stored.',
};

function toList(value: string): string[] {
  return value
    .split(/[\s,]+/u)
    .map(entry => entry.trim().replace(/^@/u, ''))
    .filter(entry => entry.length > 0);
}

/**
 * The settings drawer: which accounts and bots to watch, whether write actions are offered, and
 * the tokens that reach them.
 */
export function SettingsPanel(props: ISettingsPanelProps) {
  const { settings, tokenLocation, onChange, onTokenSave, onTokenRemove } = props;
  const { ownerTokens, onOwnerTokenSave, onOwnerTokenRemove } = props;
  const [ orgsDraft, setOrgsDraft ] = useState(settings.orgs.join('\n'));
  const [ authorsDraft, setAuthorsDraft ] = useState(settings.extraAuthors.join('\n'));
  const [ ownerDraft, setOwnerDraft ] = useState('');
  const [ ownerTokenDraft, setOwnerTokenDraft ] = useState('');
  const [ ownerBusy, setOwnerBusy ] = useState(false);
  const [ ownerError, setOwnerError ] = useState<string | undefined>();
  const [ tokenDraft, setTokenDraft ] = useState('');
  const [ tokenRemember, setTokenRemember ] = useState(tokenLocation !== 'session');
  const [ tokenBusy, setTokenBusy ] = useState(false);
  const [ tokenError, setTokenError ] = useState<string | undefined>();
  const [ tokenSaved, setTokenSaved ] = useState(false);

  useEffect(() => {
    setOrgsDraft(settings.orgs.join('\n'));
    setAuthorsDraft(settings.extraAuthors.join('\n'));
  }, [ settings.orgs, settings.extraAuthors ]);

  async function submitToken(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = tokenDraft.trim();
    if (trimmed.length === 0) {
      setTokenError('Paste a token first.');
      return;
    }
    setTokenBusy(true);
    setTokenError(undefined);
    setTokenSaved(false);
    try {
      await onTokenSave(trimmed, tokenRemember);
      setTokenDraft('');
      setTokenSaved(true);
    } catch (cause: unknown) {
      setTokenError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTokenBusy(false);
    }
  }

  async function submitOwnerToken(event: React.FormEvent) {
    event.preventDefault();
    const owner = ownerDraft.trim().replace(/^@/u, '');
    const token = ownerTokenDraft.trim();
    if (owner.length === 0 || token.length === 0) {
      setOwnerError('Both an organisation and a token are needed.');
      return;
    }
    setOwnerBusy(true);
    setOwnerError(undefined);
    try {
      await onOwnerTokenSave(owner, token);
      setOwnerDraft('');
      setOwnerTokenDraft('');
    } catch (cause: unknown) {
      setOwnerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOwnerBusy(false);
    }
  }

  return (
    <div className="settings">
      <section className="settings__section">
        <h2 className="settings__heading">Where to look</h2>
        <div className="settings__field">
          <label className="settings__label" htmlFor="settings-orgs">Organisations</label>
          <textarea
            id="settings-orgs"
            className="settings__textarea"
            rows={3}
            spellCheck={false}
            placeholder={'comunica\nrubensworks'}
            value={orgsDraft}
            onChange={event => setOrgsDraft(event.target.value)}
            onBlur={() => onChange({ ...settings, orgs: toList(orgsDraft) })}
          />
          <span className="settings__hint">
            One per line. Your own repositories are always included; these are searched alongside
            them.
          </span>
        </div>
      </section>

      <section className="settings__section">
        <h2 className="settings__heading">Which bots count</h2>
        <p className="settings__hint">
          Recognised out of the box: {DEFAULT_RENOVATE_AUTHORS.map((author, index) => (
            <span key={author}>{index > 0 ? ', ' : ''}<code>{author}</code></span>
        ))}.
        </p>
        <div className="settings__field">
          <label className="settings__label" htmlFor="settings-authors">Extra bot logins</label>
          <textarea
            id="settings-authors"
            className="settings__textarea"
            rows={2}
            spellCheck={false}
            placeholder="my-renovate-runner"
            value={authorsDraft}
            onChange={event => setAuthorsDraft(event.target.value)}
            onBlur={() => onChange({ ...settings, extraAuthors: toList(authorsDraft) })}
          />
          <span className="settings__hint">
            For a self-hosted Renovate running under its own account. One per line.
          </span>
        </div>
        <label className="settings__checkbox">
          <input
            type="checkbox"
            checked={settings.includeDependabot}
            onChange={event => onChange({ ...settings, includeDependabot: event.target.checked })}
          />
          <span>
            Include Dependabot pull requests too. The same dashboard shape fits them, but their
            titles and bodies are parsed separately.
          </span>
        </label>
      </section>

      <section className="settings__section">
        <h2 className="settings__heading">Write actions</h2>
        <label className="settings__checkbox">
          <input
            type="checkbox"
            checked={settings.writeActions}
            onChange={event => onChange({ ...settings, writeActions: event.target.checked })}
          />
          <span>
            Offer merge, approve, rebase and close. Off by default: the dashboard is fully useful
            read-only, and leaving this off means nothing here can change anything.
          </span>
        </label>
        {settings.writeActions ?
            (
              <p className="settings__warning" role="status">
                Enabled. These need a token with <strong>Pull requests: read and write</strong>, and{' '}
                <strong>Contents: read and write</strong> to merge. Without them the buttons are
                there but GitHub refuses the call — the error is reported per pull request.
              </p>
            ) :
          null}
      </section>

      <section className="settings__section">
        <h2 className="settings__heading">Presentation</h2>
        <div className="settings__field">
          <label className="settings__label" htmlFor="settings-theme">Theme</label>
          <select
            id="settings-theme"
            className="settings__select"
            value={settings.theme}
            onChange={event => onChange({ ...settings, theme: event.target.value as Theme })}
          >
            <option value="auto">Follow system</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
      </section>

      <section className="settings__section">
        <h2 className="settings__heading">Token</h2>
        <p className="settings__hint">{TOKEN_STATUS[tokenLocation]}</p>
        <form className="settings__form" onSubmit={submitToken}>
          <label className="settings__label" htmlFor="settings-token">Replace it</label>
          <input
            id="settings-token"
            className="settings__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="github_pat_..."
            value={tokenDraft}
            onChange={event => setTokenDraft(event.target.value)}
          />
          <label className="settings__checkbox">
            <input
              type="checkbox"
              checked={!tokenRemember}
              onChange={event => setTokenRemember(!event.target.checked)}
            />
            <span>Don&apos;t remember me — keep it for this tab only.</span>
          </label>
          {tokenError === undefined ? null : <p className="settings__error" role="alert">{tokenError}</p>}
          {tokenSaved ? <p className="settings__ok" role="status">Token replaced.</p> : null}
          <div className="settings__row">
            <button className="button button--primary" type="submit" disabled={tokenBusy}>
              {tokenBusy ? 'Checking…' : 'Save token'}
            </button>
            <button className="button button--danger" type="button" onClick={onTokenRemove}>
              Remove stored token
            </button>
          </div>
        </form>
      </section>

      <section className="settings__section">
        <h2 className="settings__heading">Organisation tokens</h2>
        <p className="settings__hint">
          A fine-grained token reaches exactly one resource owner, so an organisation&apos;s private
          pull requests need a token created with that organisation as its{' '}
          <a className="link" href={TOKEN_URL} target="_blank" rel="noreferrer noopener">
            resource owner
          </a>. It is checked against that organisation&apos;s repository listing before it is
          stored, so a wrongly scoped one is refused here rather than quietly showing you public
          results only.
        </p>
        {ownerTokens.length === 0 ?
          <p className="settings__hint">None stored.</p> :
            (
              <ul className="settings__tokens">
                {ownerTokens.map(entry => (
                  <li key={entry.owner.toLowerCase()} className="settings__token">
                    <span>{entry.owner}</span>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => onOwnerTokenRemove(entry.owner)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
        <form className="settings__form" onSubmit={submitOwnerToken}>
          <label className="settings__label" htmlFor="settings-owner">Add one</label>
          <div className="settings__row">
            <input
              id="settings-owner"
              className="settings__input"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="organisation"
              value={ownerDraft}
              onChange={event => setOwnerDraft(event.target.value)}
            />
            <input
              className="settings__input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="github_pat_..."
              aria-label="Organisation token"
              value={ownerTokenDraft}
              onChange={event => setOwnerTokenDraft(event.target.value)}
            />
          </div>
          {ownerError === undefined ? null : <p className="settings__error" role="alert">{ownerError}</p>}
          <button className="button" type="submit" disabled={ownerBusy}>
            {ownerBusy ? 'Checking…' : 'Add organisation token'}
          </button>
        </form>
      </section>
    </div>
  );
}
