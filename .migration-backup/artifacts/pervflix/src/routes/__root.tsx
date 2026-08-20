import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { MenuSidebar } from "../components/MenuSidebar";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn&apos;t load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. Try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <SiteHeader />
      <main className="min-h-[calc(100vh-8rem)]">
        <Outlet />
      </main>
      <SiteFooter />
    </QueryClientProvider>
  );
}

// ─── Site Header ─────────────────────────────────────────────────────────────

function SiteHeader() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = inputRef.current?.value.trim();
    if (q) {
      navigate({ to: "/", search: (prev: Record<string, unknown>) => ({ ...prev, q, page: 1 }) });
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-900 bg-black/95 backdrop-blur">
      <div className="mx-auto flex h-14 items-center justify-between px-4 w-full">

        {/* 1. Left Block: Complete Horizontal 3D Logo */}
        <Link to="/" className="flex shrink-0 items-center justify-start">
          <img src="/logo-horizontal.png?v=11" alt="PERVFLIX" className="h-11 w-auto shrink-0 object-contain" />
        </Link>

        {/* 2. Center Block: Symmetrical, Non-Collapsing, Sharp Rectangular Search Bar */}
        <div className="flex-1 flex justify-center mx-2">
          <form role="search" onSubmit={handleSearch} className="flex w-full items-center">
            <input
              ref={inputRef}
              name="q"
              type="text"
              placeholder="Search..."
              className="w-full h-8 px-2.5 rounded-l-md border border-neutral-800 bg-neutral-950 text-[11px] text-white focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Search"
              className="h-8 px-2.5 bg-primary rounded-r-md flex items-center justify-center text-white shrink-0"
              style={{ backgroundColor: "#E60000" }}
            >
              <Search className="w-3.5 h-3.5 text-white" />
            </button>
          </form>
        </div>

        {/* 3. Right Block: Mobile Menu Button Container */}
        <div className="flex shrink-0 items-center justify-end">
          <MenuSidebar
            trigger={
              <button
                aria-label="Open menu"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface-2)] text-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            }
          />
        </div>

      </div>
    </header>
  );
}

// ─── Site Footer ──────────────────────────────────────────────────────────────

function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-[color:var(--hairline)] bg-[color:var(--surface)]">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center">
            <img src="/logo-vertical.png" alt="PERVFLIX" className="h-20 w-auto shrink-0 object-contain" />
          </div>
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            A cinematic theater for full-length studio releases. Curated,
            high-fidelity, free forever.
          </p>
        </div>
        <FooterCol title="Browse" items={["Home", "Performers", "4K", "New Releases"]} />
        <FooterCol title="Discover" items={["Trending", "Most Viewed", "Editor's Picks", "By Category", "By Year"]} />
        <FooterCol title="Legal" items={["Terms", "Privacy", "DMCA", "2257", "Report Content"]} />
      </div>
      <div className="border-t border-[color:var(--hairline)]">
        <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-2 px-6 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} PervFlix. Adults only (18+).</span>
          <span>No accounts. No sign-up. 100% free catalog.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-[11px] font-bold uppercase tracking-widest text-primary">
        {title}
      </h4>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item}>
            <a
              href="#"
              className="text-sm text-foreground/75 transition-colors hover:text-primary"
            >
              {item}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
