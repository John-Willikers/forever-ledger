import { useState } from 'react';
import type { ReactNode } from 'react';
import { formatNumber } from '../lib/format';

/**
 * A panel that folds: the title is the `<summary>`. Closed by default so secondary cards stay out of the way; pass
 * `defaultOpen` for the ones that should start expanded. The body mounts on first open (and unmounts when folded), so
 * a folded card's queries don't run and its charts are not laid out in a hidden, zero-width box. No actions slot on
 * purpose: controls inside a summary toggle it.
 */
export function Collapsible({
  title,
  count,
  defaultOpen = false,
  className = '',
  children,
}: {
  title: ReactNode;
  /** Shown after the title so the reader knows what is inside without opening it. */
  count?: number | null;
  /** Whether the panel starts expanded. Initial only: the reader's toggling owns it afterwards. */
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [isOpen, setOpen] = useState(defaultOpen);
  return (
    <details
      className={`panel collapsible ${className}`}
      open={isOpen}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="panel-head">
        <h2>
          {title}
          {count !== undefined && count !== null && (
            <span className="tab-count">{formatNumber(count)}</span>
          )}
        </h2>
      </summary>
      {isOpen && <div className="collapsible-body">{children}</div>}
    </details>
  );
}
