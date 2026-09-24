import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state muted" role="status">
      {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state empty muted">{children}</div>;
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="state error" role="alert">
      <span>Couldn't load this: {error.message}</span>
      {retry && (
        <button type="button" className="secondary small" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Loading / error / data for one query; `children` renders the data. */
export function QueryState<T>({
  query,
  children,
  loading,
}: {
  query: UseQueryResult<T, Error>;
  children: (data: T) => ReactNode;
  loading?: string;
}) {
  if (query.isPending) return <Loading label={loading} />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}
