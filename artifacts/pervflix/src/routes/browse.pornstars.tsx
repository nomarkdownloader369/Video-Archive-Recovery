import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCompactNumber } from "@/lib/performerStats";
import { SIDEBAR_PERFORMERS } from "@/lib/performers";

export const PERFORMER_WHITELIST = [
  "Wendy Raine",
  "Rachel Steele",
  "Andi James",
  "Seka Black",
  "Melony Melons",
  "Ryan Keely",
  "Aderes Quin",
  "Eva Notty",
  "Katie Monroe",
  "Kendra Lust",
  "Coco Lovelock",
  "Angela White",
  "Julia Ann",
  "Syren de Mer",
  "Ava Addams",
  "Lana Rhoades",
  "Riley Reid",
  "Abella Danger",
  "Eva Elfie",
  "Lena Paul",
  "Brandi Love",
  "Cory Chase",
  "Dani Daniels",
  "Emily Willis",
  "Mia Malkova",
  "Alyssia Kent",
  "Kiara Mia",
  "Dredd xxx",
  "Jasmine Jae",
  "London River",
  "Raissa Bellini",
  "Miss Raquel",
  "Sophia Deluxe",
] as const;

export const Route = createFileRoute("/browse/pornstars")({
  component: BrowseAllPerformers,
});

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
}

/** Lookup map for static Unsplash fallback portraits (used when API hasn't loaded yet) */
const WHITELIST_PORTRAITS = new Map(
  SIDEBAR_PERFORMERS.map((p) => [p.name.toLowerCase(), p.portrait])
);

/** Merge API performers with the curated whitelist, deduped by name */
function mergePerformers(
  apiList: Array<{ name: string; slug: string; videoCount?: number; totalViews?: number; photo?: string | null }>,
) {
  const seen = new Set(apiList.map((p) => p.name.toLowerCase()));
  const extras = SIDEBAR_PERFORMERS
    .filter((p) => !seen.has(p.name.toLowerCase()))
    .map((p) => ({
      name: p.name,
      slug: p.name.toLowerCase().replace(/\s+/g, "-"),
      videoCount: 0,
      totalViews: 0,
      photo: p.portrait,   // static fallback while API hasn't loaded
    }));
  return [...apiList, ...extras];
}

/**
 * Resolve portrait for a performer card.
 * Priority: API-provided dynamic photo → static whitelist portrait → null (initials).
 */
function resolvePortrait(p: { name: string; photo?: string | null }): string | null {
  if (p.photo) return p.photo;
  return WHITELIST_PORTRAITS.get(p.name.toLowerCase()) ?? null;
}

function BrowseAllPerformers() {
  const { data: pornstars, isLoading } = useQuery({
    queryKey: ["all-pornstars"],
    queryFn: () => api.listPornstars(),
    staleTime: 5 * 60_000,
  });

  const list = mergePerformers(pornstars ?? []);

  return (
    <div className="bg-background">
      <section className="mx-auto max-w-[1400px] px-4 pt-10 pb-16 sm:px-6">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-primary"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </Link>

        <h1 className="text-3xl font-black tracking-tight sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
          All Performers
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Browse the full model catalog — {list.length} performers and counting.
        </p>

        {isLoading ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-sm bg-[color:var(--surface-2)]" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-muted-foreground">No performers found yet.</p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {list.map((p) => (
              <Link
                key={p.name}
                to="/browse/pornstar/$name"
                params={{ name: encodeURIComponent(p.name) }}
                className="group flex flex-col items-center gap-2 rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface)] p-4 text-center transition-all duration-300 hover:border-primary/70 hover:shadow-[0_0_20px_rgba(230,0,0,0.35)]"
              >
                {(() => {
                  const portrait = resolvePortrait(p);
                  return (
                    <span className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-black ring-2 ring-primary/40 shadow-[0_0_6px_rgba(230,0,0,0.5)] transition-all duration-300 group-hover:scale-105 group-hover:ring-primary/80 group-hover:shadow-[0_0_10px_rgba(230,0,0,0.7)]">
                      {portrait ? (
                        <img
                          src={portrait}
                          alt={p.name}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          className="h-full w-full object-cover object-top"
                        />
                      ) : (
                        <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-primary via-primary/70 to-primary/30 text-lg font-black text-white">
                          {getInitials(p.name)}
                        </span>
                      )}
                    </span>
                  );
                })()}
                <span className="line-clamp-2 text-xs font-semibold leading-tight text-foreground/85 group-hover:text-primary">
                  {p.name}
                </span>
                {typeof p.videoCount === "number" && p.videoCount > 0 && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {p.videoCount} {p.videoCount === 1 ? "video" : "videos"}
                  </span>
                )}
                {typeof p.totalViews === "number" && p.totalViews > 0 && (
                  <span className="text-[10px] text-primary/80">{formatCompactNumber(p.totalViews)} views</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
