/**
 * The application root.
 *
 * The scaffold renders a placeholder shell; the setup screen and the dashboard land in the
 * milestones that follow. Everything this app ever does happens in the browser: the only host it
 * contacts at runtime is https://api.github.com, and the token is only ever attached to requests
 * the browser makes there directly.
 */
export function App() {
  return (
    <main className="shell">
      <h1 className="shell-title">Renovate Overview</h1>
      <p className="shell-lead">
        Every open Renovate pull request across your repositories and organisations, in one list.
      </p>
      <p className="shell-note">
        Scaffold only — connect a token and the dashboard arrives in the next milestone.
      </p>
    </main>
  );
}
