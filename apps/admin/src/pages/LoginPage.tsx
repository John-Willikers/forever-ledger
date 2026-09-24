import { LOGIN_URL } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';

export function LoginPage({ loginConfigured }: { loginConfigured: boolean }) {
  return (
    <div className="center">
      <div className="card login">
        <h1>Forever Ledger</h1>
        <p className="muted">Admin panel for the World of Warcraft: Forever data collector.</p>
        <ErrorBanner />
        {loginConfigured ? (
          <a className="button bnet" href={LOGIN_URL}>
            Log in with Battle.net
          </a>
        ) : (
          <p className="muted">Battle.net login isn't configured on this server yet.</p>
        )}
      </div>
    </div>
  );
}
