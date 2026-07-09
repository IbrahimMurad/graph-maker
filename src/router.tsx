import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const queryClient = new QueryClient();

export const router = createRouter({
  routeTree,
  context: { queryClient },
  // App is hosted under a sub-path on GitHub Pages (Vite `base`, e.g. "/graph-maker/").
  // Without this the router matches against the full "/graph-maker/…" path and 404s.
  basepath: import.meta.env.BASE_URL,
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
