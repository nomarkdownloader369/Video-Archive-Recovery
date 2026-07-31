import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TRENDING, thumbUrl, type Video } from "@/lib/videos";
import { api } from "@/lib/api";
import { VideoCard } from "@/components/VideoCard";
import { toggleWatchlist, isInWatchlist } from "@/lib/watchlist";

const SORT_OPTIONS = [
  { label: "New",         value: "new"   },
  { label: "Top Rated",   value: "top"   },
  { label: "Most Viewed", value: "views" },
] as const;

type SortValue = typeof SORT_OPTIONS[number]["value"];

function validateSearch(search: Record<string, unknown>) {
  const validSorts: SortValue[] = ["new", "top", "views"];
  return {
    sort: validSorts.includes(search.sort as SortValue)
      ? (search.sort as SortValue)
      : ("new" as SortValue),
    q:        typeof search.q        === "string" ? search.q        : undefined,
    category: typeof search.category === "string" ? search.category : undefined,
    tag:      typeof search.tag      === "string" ? search.tag      : undefined,
    page:     typeof search.page     === "string"
      ? Math.max(1, parseInt(search.page, 10) || 1)
      : 1,
  };
}

export const Route = createFileRoute("/")({
  validateSearch,
  component: Index,
});

function Index() {
  return (
    <div className="bg-background">
      <HeroSlider />
      <VideoGrid />
      <TrendingSearches />
      <FaqSection />
    </div>
  );
}

// ─── Hero Slider ─────────────────────────────────────────────────────────────

function HeroSlider() {
  const [i, setI] = useState(0);

  const { data: slides } = useQuery({
    queryKey: ["hero-videos"],
    queryFn: () => api.listHero(),
    staleTime: 5 * 60_000,
  });

  const heroSlides = slides ?? [];
  const total = heroSlides.length;

  useEffect(() => {
    if (total < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % total), 6500);
    return () => clearInterval(t);
  }, [total]);

  if (heroSlides.length === 0) {
    return (
      <section className="mx-auto max-w-[1400px] px-2 pt-6 sm:px-6">
        <div className="aspect-video w-full animate-pulse rounded-sm bg-[color:var(--surface-2)] sm:aspect-[21/9]" />
      </section>
    );
  }

  const slide = heroSlides[i % heroSlides.length];

  return (
    <section className="mx-auto max-w-[1400px] px-2 pt-6 sm:px-6">
      <div className="overflow-hidden rounded-sm border border-[color:var(--hairline)] bg-black">
        <div className="relative aspect-video w-full sm:aspect-[21/9]">
          {heroSlides.map((s, idx) => (
            <img
              key={s.slug}
              src={thumbUrl(s.thumbSeed, 1600, 700)}
              alt={s.title}
              className={
                "absolute inset-0 h-full w-full object-cover transition-opacity duration-700 " +
                (idx === i ? "opacity-100" : "opacity-0")
              }
            />
          ))}
          <div className="absolute inset-0 hidden bg-gradient-to-r from-black via-black/70 to-transparent sm:block" />
          <div className="absolute inset-0 hidden bg-gradient-to-t from-black/90 via-transparent to-transparent sm:block" />

          {/* Desktop hero text */}
          <div className="absolute inset-0 hidden h-full w-full items-end p-6 sm:flex sm:p-10 lg:p-14">
            <div className="max-w-2xl">
              <HeroMeta slide={slide} />
              <h1
                className="text-3xl font-black leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {slide.title}
              </h1>
              <HeroStats slide={slide} />
              {slide.description && (
                <p className="mt-4 max-w-xl text-sm text-foreground/75">
                  {slide.description}
                </p>
              )}
              <HeroActions slide={slide} />
            </div>
          </div>

          {/* Dot nav */}
          {total > 1 && (
            <div className="absolute bottom-3 right-3 flex gap-1.5 sm:bottom-4 sm:right-4">
              {heroSlides.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setI(idx)}
                  aria-label={`Slide ${idx + 1}`}
                  className={
                    "h-1.5 rounded-full transition-all " +
                    (idx === i ? "w-8 bg-primary" : "w-4 bg-white/30 hover:bg-white/60")
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Mobile card */}
        <div className="block hero-mobile-card sm:hidden">
          <HeroMeta slide={slide} />
          <h1
            className="hero-mobile-title mt-1.5 text-base font-black tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {slide.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            {[
              slide.year,
              slide.duration && slide.duration !== "0:00" ? slide.duration : null,
              slide.views ? `${slide.views} views` : null,
            ].filter(Boolean).join(" • ")}
          </div>
          {slide.description && (
            <p className="mt-1.5 line-clamp-2 text-[10px] leading-snug text-foreground/75">
              {slide.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <Link
              to="/video/$slug"
              params={{ slug: slide.slug }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-primary/90"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Watch Movie
            </Link>
            <HeroWatchlistButton slide={slide} compact />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMeta({ slide }: { slide: Video }) {
  const is4K =
    slide.title.toLowerCase().includes("4k") ||
    slide.tags.some(
      (t) =>
        t.toLowerCase() === "4k" ||
        t.toLowerCase() === "2160p" ||
        t.toLowerCase() === "#4k" ||
        t.toLowerCase() === "#4k porn",
    );
  const qualityText = is4K ? "ULTRA" : "HD";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
      <span className="rounded-sm bg-primary px-2 py-0.5 text-white">Featured</span>
      <span className="text-muted-foreground">{qualityText}</span>
    </div>
  );
}

function HeroStats({ slide }: { slide: Video }) {
  const metaItems = [
    slide.year,
    slide.duration && slide.duration !== "0:00" ? slide.duration : null,
    slide.views ? `${slide.views} views` : null,
  ].filter(Boolean);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:mt-4 sm:text-sm">
      {metaItems.join(" • ")}
    </div>
  );
}

function HeroWatchlistButton({ slide, compact = false }: { slide: Video; compact?: boolean }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(isInWatchlist(slide.slug)); }, [slide.slug]);

  const handleClick = () => {
    const added = toggleWatchlist(slide);
    setSaved(added);
  };

  if (compact) {
    return (
      <button
        onClick={handleClick}
        className={
          "inline-flex items-center justify-center gap-1 rounded-sm border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors " +
          (saved
            ? "border-primary bg-primary text-white"
            : "border-[color:var(--hairline)] bg-transparent text-foreground hover:border-primary hover:text-primary")
        }
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        {saved ? "Saved" : "+ Watchlist"}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={
        "inline-flex items-center gap-2 rounded-sm border px-5 py-3 text-sm font-bold uppercase tracking-wide transition-all " +
        (saved
          ? "border-primary bg-primary text-white shadow-[0_0_16px_rgba(230,0,0,0.4)] hover:bg-primary/90"
          : "border-[color:var(--hairline)] bg-transparent text-foreground hover:border-primary hover:text-primary")
      }
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      {saved ? "Saved" : "+ Watchlist"}
    </button>
  );
}

function HeroActions({ slide }: { slide: Video }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Link
        to="/video/$slug"
        params={{ slug: slide.slug }}
        className="inline-flex items-center gap-2 rounded-sm bg-primary px-5 py-3 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-primary/90"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
        Watch Movie
      </Link>
      <HeroWatchlistButton slide={slide} />
    </div>
  );
}

// ─── Video Grid + smooth loading overlay ─────────────────────────────────────

const PAGE_SIZE = 24;

function VideoGrid() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/" });

  const selectedSort: SortValue = search.sort ?? "new";
  const currentPage = search.page ?? 1;
  const activeCategory = search.category;
  const activeTag = search.tag;

  const { data: paged, isLoading, isFetching } = useQuery({
    queryKey: ["videos", { sort: selectedSort, q: search.q, category: activeCategory, tag: activeTag, page: currentPage }],
    queryFn: () =>
      api.listVideos({
        sort: selectedSort,
        q:    search.q,
        category: activeCategory,
        tag:  activeTag,
        page: currentPage,
        limit: PAGE_SIZE,
      }),
    staleTime: 30_000,
  });

  const videos     = paged?.videos ?? [];
  const totalPages = paged?.pagination.pages ?? 1;

  const setPage = (p: number) =>
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, page: p }) });

  const clearFilter = (key: "category" | "tag") =>
    navigate({
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        delete next[key];
        next.page = 1;
        return next;
      },
    });

  const heading = activeTag
    ? `#${activeTag}`
    : activeCategory
    ? activeCategory
    : "Latest Releases";

  return (
    <section className="mx-auto max-w-[1400px] px-0 py-8 sm:px-6 sm:py-12">
      {/* Section header */}
      <div className="mb-4 sm:mb-6 sm:flex sm:items-end sm:justify-between">
        <div>
          <h2
            className="px-2 text-2xl font-black capitalize tracking-tight sm:px-0 sm:text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {heading}
          </h2>
          {(activeCategory || activeTag) && (
            <button
              onClick={() => clearFilter(activeTag ? "tag" : "category")}
              className="mt-1 inline-flex items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-primary hover:text-primary/80 sm:px-0"
            >
              ✕ Clear filter
            </button>
          )}
        </div>

        <div className="-mx-2 mt-3 flex gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:mt-0 sm:overflow-visible sm:px-0 sm:pb-0">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() =>
                navigate({
                  search: (prev: Record<string, unknown>) => ({
                    ...prev,
                    sort: opt.value,
                    page: 1,
                  }),
                })
              }
              className={
                "shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide sm:rounded-sm sm:px-3 sm:py-1.5 sm:text-xs " +
                (selectedSort === opt.value
                  ? "border-primary bg-primary text-white"
                  : "border-[color:var(--hairline)] text-foreground/80 hover:border-primary hover:text-primary")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid with smooth crimson loading overlay */}
      <div className="relative">
        {isFetching && !isLoading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center rounded-sm pt-16">
            <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-black/90 px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary backdrop-blur">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
              Loading…
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 gap-x-1 gap-y-4 lg:grid-cols-4 lg:gap-x-3 lg:gap-y-6">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="aspect-video w-full animate-pulse rounded-sm bg-[color:var(--surface-2)]" />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-muted-foreground">No videos found. Try a different filter.</p>
          </div>
        ) : (
          <div
            className={
              "grid grid-cols-2 gap-x-1 gap-y-4 lg:grid-cols-4 lg:gap-x-3 lg:gap-y-6 transition-opacity duration-300 " +
              (isFetching ? "opacity-50" : "opacity-100")
            }
          >
            {videos.map((v) => (
              <VideoCard key={v.slug} video={v} />
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
      )}
    </section>
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Prev
      </button>

      {pages.map((p, idx) =>
        p === "…" ? (
          <span key={`ellipsis-${idx}`} className="flex h-9 w-9 items-center justify-center text-sm text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p as number)}
            aria-current={p === currentPage ? "page" : undefined}
            className={
              "flex h-9 w-9 items-center justify-center rounded-sm border text-sm font-bold transition-colors " +
              (p === currentPage
                ? "border-primary bg-primary text-white"
                : "border-[color:var(--hairline)] bg-[color:var(--surface)] text-foreground/80 hover:border-primary hover:text-primary")
            }
          >
            {p}
          </button>
        ),
      )}

      <button
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className="flex h-9 items-center gap-1 rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface)] px-3 text-xs font-semibold uppercase tracking-wide text-foreground/80 transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-30"
      >
        Next
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
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

// ─── Trending Searches ────────────────────────────────────────────────────────

function TrendingSearches() {
  const navigate = useNavigate({ from: "/" });
  return (
    <section className="mx-auto max-w-[1400px] px-2 pb-10 sm:px-6">
      <div className="rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface)] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-primary" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Trending Searches
          </h3>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {TRENDING.map((t) => (
            <button
              key={t}
              onClick={() =>
                navigate({
                  search: (prev: Record<string, unknown>) => ({ ...prev, q: t, page: 1 }),
                })
              }
              className="rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-primary hover:text-primary"
            >
              #{t}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

const FAQS = [
  {
    q: "Is PervFlix really free?",
    a: "Yes. Every full-length film in our catalog streams for free, in the highest available quality, with no account required and no paywall.",
  },
  {
    q: "Do I need to sign up or create an account?",
    a: "Never. PervFlix is a 100% open catalog. There are no logins, memberships, or personal data required to watch.",
  },
  {
    q: "Where do the films come from?",
    a: "We curate full-length releases from premier studios including Brazzers, MYLF, BLACKED, TUSHY, Adult Time and many more.",
  },
  {
    q: "Can I download films?",
    a: "Yes — every watch page includes a direct download button so you can save your favorites for offline viewing.",
  },
  {
    q: "What quality is available?",
    a: "Most releases are available in native 4K UHD or 1080p Full HD. Look for the pulsing quality badge on each thumbnail.",
  },
];

function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mx-auto max-w-[1400px] px-2 pb-16 sm:px-6">
      <h2
        className="text-2xl font-black tracking-tight sm:text-3xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Frequently Asked Questions
      </h2>
      <div className="mt-6 divide-y divide-[color:var(--hairline)] rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface)]">
        {FAQS.map((f, idx) => {
          const isOpen = open === idx;
          return (
            <div key={f.q}>
              <button
                onClick={() => setOpen(isOpen ? null : idx)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[color:var(--surface-2)]"
              >
                <span className="text-sm font-semibold text-foreground sm:text-base">
                  {f.q}
                </span>
                <span
                  className={
                    "grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-[color:var(--hairline)] text-primary transition-transform " +
                    (isOpen ? "rotate-45" : "")
                  }
                >
                  +
                </span>
              </button>
              {isOpen && (
                <div className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
                  {f.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
