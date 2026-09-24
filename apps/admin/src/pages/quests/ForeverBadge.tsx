/** Marks a quest the "Forever-only" heuristic says is new in Forever (id ≥ 90000, decided by the server). */
export function ForeverBadge() {
  return (
    <span className="pill forever" title="Quest id ≥ 90000: new in Forever">
      Forever
    </span>
  );
}
