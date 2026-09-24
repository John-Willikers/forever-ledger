import { Link } from 'react-router';

export function NotFound() {
  return (
    <section>
      <h1>Page not found</h1>
      <p className="muted">
        <Link to="/">Back to the overview</Link>
      </p>
    </section>
  );
}
