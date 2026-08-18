import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/browse/categories")({
  component: CategoriesPage,
});

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
  const [imgSrc, setImgSrc] = useState<string | null>(row.photo);

  function handleImgError() {
    setImgSrc(null);
  }

  function handleClick() {
    navigate({ to: "/", search: { category: row.name } });
  }

  const label = displayName(row.name);
  const countLabel = row.video_count === 1 ? "1 Video" : `${row.video_count} Videos`;

  return (
    <button
      onClick={handleClick}
      className="group relative aspect-[4/3] overflow-hidden rounded-sm text-left focus:outline-none"
    >
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={label}
          loading="lazy"
          onError={handleImgError}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
      ) : (
        <div className="absolute inset-0 bg-[color:var(--surface-2)]" aria-hidden="true" />
      )}

      {/* 75% dark gradient overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.75)_45%,rgba(0,0,0,0.35)_100%)]" />

      {/* Crimson left-edge accent on hover */}
      <div className="absolute bottom-0 left-0 top-0 w-[3px] bg-[#E60000] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-start justify-end p-3 sm:p-4 gap-0.5">
        <span
          className="text-[clamp(0.65rem,1.7vw,0.95rem)] font-black uppercase leading-none tracking-[0.12em] text-white transition-colors duration-300 group-hover:text-[#E60000]"
        >
          {label}
        </span>

        {/* Video count badge */}
        <span
          className={`text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors duration-300 ${row.video_count > 0 ? "text-[#a3a3a3]" : "text-[#525252]"}`}
        >
          {countLabel}
        </span>

        {/* Hover CTA */}
        <span
          className="mt-0.5 text-[10px] uppercase tracking-widest text-[#E60000] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
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
      className="aspect-[4/3] animate-pulse rounded-sm bg-[#0a0a0a]"
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
    <div className="min-h-screen bg-black">
      {/* Page header */}
      <div className="px-4 sm:px-6 lg:px-8 pt-10 pb-8">
        <p
          className="mb-2 text-xs uppercase tracking-[0.25em] text-[#E60000]"
        >
          Browse
        </p>
        <h1
          className="text-[clamp(1.6rem,4vw,2.8rem)] font-black uppercase tracking-[-0.01em] text-white"
        >
          All Categories
        </h1>
        <p className="mt-2 text-sm text-[#a3a3a3]">
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
          <p className="text-sm text-[#E60000]">{error}</p>
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
