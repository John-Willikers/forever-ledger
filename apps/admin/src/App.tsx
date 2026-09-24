import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ApiError } from './api';
import { lazy, Suspense } from 'react';
import type { ReactElement } from 'react';
import { NAV } from './nav';
import type { NavItem } from './nav';
import { Loading } from './components/State';
import { NotFound } from './pages/NotFound';
import { Placeholder } from './pages/Placeholder';
import { Shell } from './Shell';

// Pages load on demand: the login page and shell stay small, ECharts comes with the pages that chart.
const OverviewPage = lazy(() =>
  import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const CharactersPage = lazy(() =>
  import('./pages/CharactersPage').then((m) => ({ default: m.CharactersPage })),
);
const HealthPage = lazy(() =>
  import('./pages/HealthPage').then((m) => ({ default: m.HealthPage })),
);
const AccessPage = lazy(() =>
  import('./pages/AccessPage').then((m) => ({ default: m.AccessPage })),
);

/** Pages that have shipped; the rest show their placeholder until their phase lands. */
const PAGES: Readonly<Record<string, () => ReactElement>> = {
  '': () => <OverviewPage />,
  characters: () => <CharactersPage />,
  health: () => <HealthPage />,
  access: () => <AccessPage />,
};

function pageFor(item: NavItem) {
  const page = PAGES[item.path];
  return page ? <Suspense fallback={<Loading />}>{page()}</Suspense> : <Placeholder item={item} />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 401/403 won't fix itself by retrying.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <Shell />,
      children: [
        ...NAV.map((item) =>
          item.path === ''
            ? { index: true, element: pageFor(item) }
            : { path: item.path, element: pageFor(item) },
        ),
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  { basename: '/admin' },
);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
