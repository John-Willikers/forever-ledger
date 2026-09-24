import type { NavItem } from '../nav';

export function Placeholder({ item }: { item: NavItem }) {
  return (
    <section>
      <h1>{item.label}</h1>
      <p className="muted">{item.summary}</p>
      <div className="card placeholder">Coming in phase {item.phase} of the admin panel plan.</div>
    </section>
  );
}
