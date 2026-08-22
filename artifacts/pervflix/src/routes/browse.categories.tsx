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

  // Keep the card grounded in catalog data; hide the image if its direct URL fails.
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
      className="group relative overflow-hidden rounded-sm focus:outline-none text-left"
      style={{ aspectRatio: "4 / 3" }}
    >
      {/* Highest-viewed catalog thumbnail for this category */}
      {imgSrc && (
        <img
          src={imgSrc}
          alt={label}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={handleImgError}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
      )}

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
