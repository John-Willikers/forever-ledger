import { useSearchParams } from 'react-router';
import { loginError } from '../loginError';

/** Shows the fixed message for the server's `?error=` code (failed Battle.net login) until dismissed. */
export function ErrorBanner() {
  const [params, setParams] = useSearchParams();
  const message = loginError(params);
  if (!message) return null;
  const dismiss = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('error');
        return next;
      },
      { replace: true },
    );
  return (
    <div className="banner" role="alert">
      <span>{message}</span>
      <button type="button" className="link" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
