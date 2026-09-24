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
const LootPage = lazy(() => import('./pages/loot/LootPage').then((m) => ({ default: m.LootPage })));
const ItemPage = lazy(() =>
  import('./pages/items/ItemPage').then((m) => ({ default: m.ItemPage })),
);
const DungeonsPage = lazy(() =>
  import('./pages/dungeons/DungeonsPage').then((m) => ({ default: m.DungeonsPage })),
);
const RunPage = lazy(() =>
  import('./pages/dungeons/RunPage').then((m) => ({ default: m.RunPage })),
);

/** Pages that have shipped; the rest show their placeholder until their phase lands. */
const PAGES: Readonly<Record<string, () => ReactElement>> = {
  '': () => <OverviewPage />,
  characters: () => <CharactersPage />,
  health: () => <HealthPage />,
  access: () => <AccessPage />,
  loot: () => <LootPage />,
  dungeons: () => <DungeonsPage />,
};

/** Detail pages reached from a listing (not in the sidebar). */
const DETAIL_ROUTES: readonly { path: string; page: () => ReactElement }[] = [
  { path: 'items/:id', page: () => <ItemPage /> },
  { path: 'dungeons/runs/:id', page: () => <RunPage /> },
];

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
        ...DETAIL_ROUTES.map((r) => ({
          path: r.path,
          element: <Suspense fallback={<Loading />}>{r.page()}</Suspense>,
        })),
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
