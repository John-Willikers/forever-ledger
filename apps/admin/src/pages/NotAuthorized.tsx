import type { User } from '../api';
import { LogoutButton } from '../components/LogoutButton';

export function NotAuthorized({ user, csrf }: { user: User; csrf: string | null }) {
  return (
    <div className="center">
      <div className="card">
        <h1>Not authorized yet</h1>
        <p>
          You're logged in as <strong>{user.battletag}</strong>, but this panel is admin-only for
          now. Ask the ledger's admin for access.
        </p>
        <LogoutButton csrf={csrf} />
      </div>
    </div>
  );
}
