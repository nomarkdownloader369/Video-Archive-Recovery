import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/browse/categories")({
  component: CategoriesPage,
});

// Per-category Unsplash fallbacks shown while the API photo loads or when
// the category has 0 videos yet.
const FALLBACK_PHOTOS: Record<string, string> = {
  milf:         "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=600&q=80",
  stepmom:      "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=600&q=80",
  teen:         "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80",
  anal:         "https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=600&q=80",
  pov:          "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80",
  lesbian:      "https://images.unsplash.com/photo-1516575307990-616c829a3842?auto=format&fit=crop&w=600&q=80",
  amateur:      "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=600&q=80",
  blowjob:      "https://images.unsplash.com/photo-1506919258185-6078bba55d2a?auto=format&fit=crop&w=600&q=80",
  "big tits":   "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=600&q=80",
  "big ass":    "https://images.unsplash.com/photo-1509610973595-c0f79e1df865?auto=format&fit=crop&w=600&q=80",
  bbc:          "https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?auto=format&fit=crop&w=600&q=80",
  creampie:     "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80",
  threesome:    "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=600&q=80",
  interracial:  "https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=600&q=80",
  public:       "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=600&q=80",
  solo:         "https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?auto=format&fit=crop&w=600&q=80",
  squirt:       "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=600&q=80",
  deepthroat:   "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=600&q=80",
  gangbang:     "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=600&q=80",
  massage:      "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=600&q=80",
  casting:      "https://images.unsplash.com/photo-1512484776495-a09d228f7383?auto=format&fit=crop&w=600&q=80",
  family:       "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80",
  mature:       "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=600&q=80",
  "old/young":  "https://images.unsplash.com/photo-1496345875659-11f7dd282d1d?auto=format&fit=crop&w=600&q=80",
  femdom:       "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=600&q=80",
  stepdad:      "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=600&q=80",
  brunette:     "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=600&q=80",
  blonde:       "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80",
  redhead:      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80",
  stockings:    "https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=600&q=80",
  japanese:     "https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=600&q=80",
  ebony:        "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=600&q=80",
  bbw:          "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?auto=format&fit=crop&w=600&q=80",
  college:      "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=600&q=80",
  uniform:      "https://images.unsplash.com/photo-1551836022-b06b24df99c7?auto=format&fit=crop&w=600&q=80",
  onlyfans:     "https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&w=600&q=80",
  erotic:       "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80",
  fetish:       "https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=600&q=80",
  footjob:      "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=600&q=80",
};

const DARK_PLACEHOLDER =
  "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&q=80";

interface CategoryRow {
  name: string;
  video_count: number;
  photo: string | null;
}

// Pretty-print category name (handle slugs like "big tits", "old/young")
function displayName(slug: string): string {
  return slug
    .split(/[\s/]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(slug.includes("/") ? "/" : " ");
}

function CategoryCard({ row }: { row: CategoryRow }) {
  const navigate = useNavigate();
  const [imgSrc, setImgSrc] = useState<string>(
    row.photo ?? FALLBACK_PHOTOS[row.name] ?? DARK_PLACEHOLDER,
  );

  // If the proxied real photo fails, fall back to Unsplash
  function handleImgError() {
    setImgSrc(FALLBACK_PHOTOS[row.name] ?? DARK_PLACEHOLDER);
  }

  function handleClick() {
    navigate({ to: "/", search: { category: row.name } });
  }

  const label = displayName(row.name);
  const countLabel = row.video_count === 1 ? "1 Video" : `${row.video_count} Videos`;

  return (
    <button
      onClick={handleClick}
      className="group relative overflow-hidden rounded-sm focus:outline-none text-left"
      style={{ aspectRatio: "4 / 3" }}
    >
      {/* Cover photo */}
      <img
        src={imgSrc}
        alt={label}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={handleImgError}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
      />

      {/* 75% dark gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.75) 45%, rgba(0,0,0,0.35) 100%)",
        }}
      />

      {/* Crimson left-edge accent on hover */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: "#E60000" }}
      />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-start justify-end p-3 sm:p-4 gap-0.5">
        <span
          className="font-black uppercase tracking-widest text-white leading-none transition-colors duration-300 group-hover:text-[#E60000]"
          style={{ fontSize: "clamp(0.65rem, 1.7vw, 0.95rem)", letterSpacing: "0.12em" }}
        >
          {label}
        </span>

        {/* Video count badge */}
        <span
          className="text-[10px] font-semibold uppercase tracking-widest transition-colors duration-300"
          style={{
            color: row.video_count > 0 ? "#a3a3a3" : "#525252",
            letterSpacing: "0.1em",
          }}
        >
          {countLabel}
        </span>

        {/* Hover CTA */}
        <span
          className="text-[10px] uppercase tracking-widest mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ color: "#E60000" }}
        >
          Browse →
        </span>
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div
      className="rounded-sm animate-pulse"
      style={{ aspectRatio: "4 / 3", background: "#0a0a0a" }}
    />
  );
}

function CategoriesPage() {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch("/api/pf/browse/categories")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ data: { name: string; video_count: number; photo: string | null }[] }>;
      })
      .then(({ data }) => {
        if (!cancelled) {
          setRows(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  const totalVideos = rows.reduce((s, r) => s + r.video_count, 0);

  return (
    <div className="min-h-screen" style={{ background: "#000000" }}>
      {/* Page header */}
      <div className="px-4 sm:px-6 lg:px-8 pt-10 pb-8">
        <p
          className="text-xs uppercase tracking-[0.25em] mb-2"
          style={{ color: "#E60000" }}
        >
          Browse
        </p>
        <h1
          className="font-black uppercase text-white"
          style={{ fontSize: "clamp(1.6rem, 4vw, 2.8rem)", letterSpacing: "-0.01em" }}
        >
          All Categories
        </h1>
        <p className="mt-2 text-sm" style={{ color: "#a3a3a3" }}>
          {loading
            ? "Loading categories…"
            : error
            ? "Could not load categories"
            : `${rows.length} premium categories · ${totalVideos.toLocaleString()} videos indexed`}
        </p>
      </div>

      {/* Grid */}
      <div className="px-4 sm:px-6 lg:px-8 pb-16">
        {error ? (
          <p className="text-sm" style={{ color: "#E60000" }}>{error}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
            {loading
              ? Array.from({ length: 40 }).map((_, i) => <SkeletonCard key={i} />)
              : rows.map((row) => <CategoryCard key={row.name} row={row} />)}
          </div>
        )}
      </div>
    </div>
  );
}
