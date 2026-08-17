import { useState } from 'react';
import { SOURCE_URL, TOKEN_URL } from '../lib/links';

export interface ISetupScreenProps {
  onConnect: (token: string, remember: boolean) => Promise<void>;
  initialError: string | undefined;
}

/**
 * The first-run screen where the user pastes a personal access token.
 */
export function SetupScreen({ onConnect, initialError }: ISetupScreenProps) {
  const [ token, setToken ] = useState('');
  const [ remember, setRemember ] = useState(true);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | undefined>(initialError);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      setError('Paste a token first.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onConnect(trimmed, remember);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup">
      <div className="setup__card">
        <h1 className="setup__title">Renovate Overview</h1>
        <p className="setup__lead">
          Every open Renovate pull request across your repositories and organisations, in one list —
          grouped by dependency, so you can see that <code>@types/node</code> is waiting in fourteen
          repositories rather than meeting it fourteen times. Everything runs in this browser tab:
          there is no server, and the only host this page talks to for data is{' '}
          <code>api.github.com</code>. Don&apos;t take our word for it:{' '}
          <a className="link" href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
            read the source
          </a>.
        </p>

        <form className="setup__form" onSubmit={submit}>
          <label className="setup__label" htmlFor="token">Fine-grained personal access token</label>
          <input
            id="token"
            className="setup__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="github_pat_..."
            value={token}
            onChange={event => setToken(event.target.value)}
          />

          <label className="setup__checkbox">
            <input
              type="checkbox"
              checked={!remember}
              onChange={event => setRemember(!event.target.checked)}
            />
            <span>
              Don&apos;t remember me — keep the token in <code>sessionStorage</code> only, so that it
              is dropped as soon as this tab closes.
            </span>
          </label>

          {error === undefined ? null : <p className="setup__error" role="alert">{error}</p>}

          <button className="button button--primary" type="submit" disabled={busy}>
            {busy ? 'Checking token…' : 'Connect'}
          </button>
        </form>

        <section className="setup__section">
          <h2>Which permissions does it need?</h2>
          <p>
            Less than you would expect — nothing that can change anything.{' '}
            <a className="link" href={TOKEN_URL} target="_blank" rel="noreferrer noopener">
              Create a fine-grained token
            </a> and work down the form:
          </p>
          <ul className="setup__list">
            <li>
              <strong>Resource owner</strong> — the setting that actually decides what the token can
              reach. A token only ever sees repositories owned by this one account, so pick yourself
              for your own repositories, and see the note below for organisations.
            </li>
            <li>
              <strong>Repository access</strong> — “All repositories”, or hand-pick the ones whose
              Renovate backlog you want to see.
            </li>
            <li>
              <strong>Repository permissions</strong> — <strong>Pull requests: read-only</strong> to
              list the pull requests, plus <strong>Checks: read-only</strong> and{' '}
              <strong>Commit statuses: read-only</strong> so each one can be coloured by its CI
              result. Picking any of them also sets <strong>Metadata: read-only</strong> for you:
              metadata is mandatory for every fine-grained token, which is why there is no separate
              checkbox to tick for it.
            </li>
          </ul>
          <p className="setup__note">
            <strong>Only public repositories?</strong> Then tick nothing at all. Fine-grained tokens
            carry read-only access to public data on their own, so a freshly created token with no
            permissions selected already works — it just cannot see anything private.
          </p>
          <p className="setup__note">
            <strong>Organisations take a token of their own.</strong> Because a token is bound to one
            resource owner, the one you made for your own account cannot see an organisation&apos;s
            private pull requests. Adding an organisation in the settings still works — its public
            repositories show up — and for the private ones, create a second token with the
            organisation as its <em>resource owner</em> (an organisation owner may have to approve
            it) and paste it into <strong>Settings → Organisation tokens</strong>. It is used for
            that organisation alongside this one, not instead of it.
          </p>
          <p className="setup__note">
            <strong>Merging, approving and the rest are switched off</strong> until you turn them on
            in the settings, and they need write permissions this token does not have. Start
            read-only; the dashboard is fully useful that way.
          </p>
        </section>

        <section className="setup__section">
          <h2>Where does the token go?</h2>
          <p>
            Into your browser, and nowhere else. It is kept in <code>localStorage</code> (or in{' '}
            <code>sessionStorage</code> when you tick the box above) and sent as an{' '}
            <code>Authorization</code> header on requests that go straight from this tab to{' '}
            <code>api.github.com</code>. There is no backend to send it to. The only other host this
            page reaches is <code>avatars.githubusercontent.com</code>, for your avatar image — an{' '}
            <code>&lt;img&gt;</code> carries no <code>Authorization</code> header, so your token is
            not involved. “Sign out” wipes it from both storages.
          </p>
        </section>

        <footer className="setup__footer">
          <a className="link" href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
            rubensworks/renovate-overview
          </a>
          {' '}— MIT licensed, and open to issues and pull requests.
        </footer>
      </div>
    </div>
  );
}
