import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * A two-step button (no window.confirm): the first click asks inline, the second does it. Cancel, or a finished
 * action, puts it back.
 */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  disabled,
  danger,
  title,
}: {
  children: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        type="button"
        className="secondary small"
        disabled={disabled}
        title={title}
        onClick={() => setAsking(true)}
      >
        {children}
      </button>
    );
  return (
    <span className="confirm">
      <button
        type="button"
        className={`small${danger ? ' danger' : ''}`}
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="secondary small" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
