import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { VideoCard } from "@/components/VideoCard";
import { simulatePerformerStats, formatCompactNumber } from "@/lib/performerStats";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function validateSearch(search: Record<string, unknown>) {
  return {
    page: typeof search.page === "string" ? Math.max(1, parseInt(search.page, 10) || 1) : 1,
  };
}

export const Route = createFileRoute("/browse/pornstar/$name")({
  validateSearch,
  component: BrowsePornstar,
});

function BrowsePornstar() {
  const { name: rawName } = Route.useParams();
  // Safely decode the name — TanStack Router may leave it encoded if passed explicitly
  const name = (() => {
    try { return decodeURIComponent(rawName); } catch { return rawName; }
  })();

  const performerQuery = name.replace(/[-_]+/g, " ").trim();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/browse/pornstar/$name" });
  const currentPage = search.page ?? 1;

  const { data, isLoading } = useQuery({
    queryKey: ["pornstar-videos", name, currentPage],
    queryFn: () =>
      api.listVideos({ pornstar: performerQuery, page: currentPage, limit: 24, sort: "new" }),
    enabled: !!name,
  });

  const videos = data?.videos ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.pages ?? 1;
  const stats = simulatePerformerStats(name);

  const setPage = (p: number) =>
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, page: p }) });

  return (
    <div className="bg-background">
      {/* Performer Header */}
      <section className="mx-auto max-w-[1400px] px-4 pt-10 pb-8 sm:px-6">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-primary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </Link>
          <Link
            to="/browse/pornstars"
            className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-primary"
          >
            See All Performers
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        </div>

        <div className="flex flex-col items-center text-center">
          {/* Circular avatar — crimson gradient with initials */}
          <div className="relative mb-5">
            <div className="grid h-28 w-28 place-items-center rounded-full bg-gradient-to-br from-primary via-[color:var(--primary)] to-[rgba(0,0,0,0.4)] text-4xl font-black text-primary-foreground shadow-2xl shadow-primary/20 ring-2 ring-primary/30 ring-offset-2 ring-offset-background">
              {getInitials(name)}
            </div>
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-[8px] font-black text-primary-foreground ring-2 ring-background">
              ★
            </span>
          </div>

          {/* Name — crimson red */}
          <h1
            className="text-3xl font-black tracking-tight sm:text-4xl"
            style={{ fontFamily: "var(--font-display)", color: "#E60000" }}
          >
            {name}
          </h1>

          {/* Premium stat strip */}
          <div className="mt-6 grid w-full max-w-md grid-cols-3 gap-2 sm:gap-3">
            <StatCard label="Total Views" value={formatCompactNumber(stats.totalViews)} icon="👁" />
            <StatCard label="Approval" value={`${stats.approvalRate}%`} icon="✔" />
            <StatCard label="Global Rank" value={`#${stats.globalRank}`} icon="🏆" />
          </div>

          {/* Metadata grid */}
          <div className="mt-5 grid w-full max-w-xs grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface)] px-5 py-4 text-left text-xs">
            <MetaRow label="Country" value="N/A" />
            <MetaRow label="City" value="N/A" />
            <MetaRow label="Age" value="N/A" />
            <MetaRow label="Height" value="N/A" />
            <MetaRow label="Weight" value="N/A" />
            {pagination && (
              <MetaRow label="Videos" value={String(pagination.total)} highlight />
            )}
          </div>
        </div>
      </section>

      {/* Video grid */}
      <section className="mx-auto max-w-[1400px] px-0 pb-16 sm:px-6">
        <h2
          className="mb-4 px-4 text-2xl font-black tracking-tight sm:px-0 sm:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {name}&apos;s Films
        </h2>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-x-1 gap-y-4 lg:grid-cols-4 lg:gap-x-3 lg:gap-y-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-video w-full animate-pulse rounded-sm bg-[color:var(--surface-2)]" />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-muted-foreground">No videos found for {name}.</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Videos will appear here after the next scrape.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-1 gap-y-4 lg:grid-cols-4 lg:gap-x-3 lg:gap-y-6">
            {videos.map((v) => (
              <VideoCard key={v.slug} video={v} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-sm border border-[color:var(--hairline)] bg-gradient-to-b from-[color:var(--surface)] to-[color:var(--surface-2)] px-3 py-3 text-center shadow-[0_0_16px_rgba(230,0,0,0.12)] transition-shadow hover:shadow-[0_0_20px_rgba(230,0,0,0.28)]">
      <div className="text-lg">{icon}</div>
      <div className="mt-1 text-base font-black text-primary sm:text-lg">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function MetaRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <>
      <span className="font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={highlight ? "font-bold text-primary" : "text-foreground/70"}>{value}</span>
    </>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  const pages = buildPageList(currentPage, totalPages);
  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-1 sm:gap-1.5">
      <button
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        className="flex h-9 items-center gap-1 rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface)] px-3 text-xs font-semibold uppercase tracking-wide text-foreground/80 transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-30"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        Prev
      </button>
      {pages.map((p, idx) =>
        p === "…" ? (
          <span key={`e-${idx}`} className="flex h-9 w-9 items-center justify-center text-sm text-muted-foreground">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p as number)}
            aria-current={p === currentPage ? "page" : undefined}
            className={
              "flex h-9 w-9 items-center justify-center rounded-sm border text-sm font-bold transition-colors " +
              (p === currentPage
                ? "border-primary bg-primary text-primary-foreground"
                : "border-[color:var(--hairline)] bg-[color:var(--surface)] text-foreground/80 hover:border-primary hover:text-primary")
            }
          >{p}</button>
        )
      )}
      <button
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className="flex h-9 items-center gap-1 rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface)] px-3 text-xs font-semibold uppercase tracking-wide text-foreground/80 transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-30"
      >
        Next
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
      </button>
    </nav>
  );
}

function buildPageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [];
  const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };
  add(1);
  if (current > 3) pages.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) add(p);
  if (current < total - 2) pages.push("…");
  add(total);
  return pages;
}
