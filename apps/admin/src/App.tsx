import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ApiError } from './api';
import { NAV } from './nav';
import { NotFound } from './pages/NotFound';
import { Placeholder } from './pages/Placeholder';
import { Shell } from './Shell';

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
            ? { index: true, element: <Placeholder item={item} /> }
            : { path: item.path, element: <Placeholder item={item} /> },
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
