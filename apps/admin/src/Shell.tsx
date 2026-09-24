import { NavLink, Outlet } from 'react-router';
import { useMe } from './api';
import type { User } from './api';
import { ErrorBanner } from './components/ErrorBanner';
import { LogoutButton } from './components/LogoutButton';
import { NAV } from './nav';
import { LoginPage } from './pages/LoginPage';
import { NotAuthorized } from './pages/NotAuthorized';

/** Decides between login, "not authorized" and the panel, from /admin/auth/me. */
export function Shell() {
  const me = useMe();
  if (me.isPending) return <div className="center muted">Loading…</div>;
  if (me.isError) {
    return (
      <div className="center">
        <div className="card">
          <h1>Can't reach the ledger</h1>
          <p className="muted">{me.error.message}</p>
          <button type="button" onClick={() => void me.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  const { user, csrf, loginConfigured } = me.data;
  if (!user) return <LoginPage loginConfigured={loginConfigured} />;
  if (user.role !== 'admin') return <NotAuthorized user={user} csrf={csrf} />;
  return <Layout user={user} csrf={csrf} />;
}

function Layout({ user, csrf }: { user: User; csrf: string | null }) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Forever Ledger</div>
        <nav aria-label="Pages">
          {NAV.map((item) => (
            <NavLink key={item.path} to={`/${item.path}`} end={item.path === ''}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <p className="tz muted">Times: America/Chicago</p>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="spacer" />
          <span className="who">
            {user.battletag} <span className="badge">{user.role}</span>
          </span>
          <LogoutButton csrf={csrf} />
        </header>
        <ErrorBanner />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
