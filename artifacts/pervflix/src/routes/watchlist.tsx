import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { VideoCard } from "@/components/VideoCard";
import { getWatchlist, removeFromWatchlist, clearWatchlist } from "@/lib/watchlist";
import type { Video } from "@/lib/videos";

export const Route = createFileRoute("/watchlist")({
  component: WatchlistPage,
});

function WatchlistPage() {
  const [videos, setVideos] = useState<Video[]>([]);

  useEffect(() => {
    setVideos(getWatchlist());
  }, []);

  const handleRemove = (slug: string) => {
    removeFromWatchlist(slug);
    setVideos((prev) => prev.filter((v) => v.slug !== slug));
  };

  const handleClearAll = () => {
    clearWatchlist();
    setVideos([]);
  };

  return (
    <div style={{ backgroundColor: "#000000" }} className="min-h-screen">
      <section className="mx-auto max-w-[1400px] px-4 pt-10 pb-20 sm:px-6">

        {/* Back link */}
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#a3a3a3] transition-colors hover:text-[#E60000]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </Link>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest" style={{ color: "#E60000" }}>
              My Collection
            </p>
            <h1
              className="text-3xl font-black tracking-tight text-white sm:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              My Watchlist
            </h1>
            <p className="mt-2 text-sm text-[#a3a3a3]">
              {videos.length === 0
                ? "Your watchlist is empty. Explore our catalog to add some premium movies."
                : `${videos.length} ${videos.length === 1 ? "film" : "films"} saved`}
            </p>
          </div>

          {videos.length > 0 && (
            <button
              onClick={handleClearAll}
              className="mt-1 rounded-sm border border-[#262626] px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[#a3a3a3] transition-colors hover:border-[#E60000] hover:text-[#E60000]"
            >
              Clear All
            </button>
          )}
        </div>

        {/* Empty state */}
        {videos.length === 0 ? (
          <div className="mt-20 flex flex-col items-center justify-center gap-8 pb-10 text-center">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-full blur-2xl"
                style={{ background: "rgba(230,0,0,0.2)" }}
              />
              <div
                className="relative grid h-28 w-28 place-items-center rounded-full shadow-2xl ring-2 ring-offset-2"
                style={{
                  background: "linear-gradient(to bottom, rgba(230,0,0,0.2), rgba(230,0,0,0.05))",
                  border: "1px solid rgba(230,0,0,0.3)",
                  boxShadow: "0 0 60px rgba(230,0,0,0.2), 0 0 0 2px rgba(230,0,0,0.3)",
                  outline: "2px solid rgba(230,0,0,0.3)",
                  outlineOffset: "2px",
                }}
              >
                <svg
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style={{ color: "#E60000" }}
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </div>
            </div>

            <div className="max-w-xs">
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "#E60000" }}>
                My Collection
              </p>
              <p className="mt-3 text-xl font-black text-white">Nothing saved yet</p>
              <p className="mt-2 text-sm leading-relaxed text-[#a3a3a3]">
                Your watchlist is empty. Explore our catalog to add some premium movies.
              </p>
            </div>

            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-sm px-7 py-3 text-sm font-bold uppercase tracking-widest text-white transition-all"
              style={{
                backgroundColor: "#E60000",
                boxShadow: "0 0 20px rgba(230,0,0,0.4)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 0 28px rgba(230,0,0,0.55)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 0 20px rgba(230,0,0,0.4)";
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3-3" />
              </svg>
              Browse the Catalog
            </Link>
          </div>
        ) : (
          <>
            <div
              className="mt-8 mb-6 h-px w-full"
              style={{ background: "linear-gradient(to right, rgba(230,0,0,0.6), rgba(230,0,0,0.2), transparent)" }}
            />
            <div className="grid grid-cols-2 gap-x-1 gap-y-4 lg:grid-cols-4 lg:gap-x-3 lg:gap-y-6">
              {videos.map((v) => (
                <div key={v.slug} className="group/wl relative">
                  <VideoCard video={v} />
                  <button
                    onClick={() => handleRemove(v.slug)}
                    aria-label="Remove from watchlist"
                    title="Remove from watchlist"
                    className="absolute right-1.5 top-1.5 z-20 grid h-6 w-6 place-items-center rounded-[3px] text-white opacity-0 backdrop-blur-sm transition-all duration-200 group-hover/wl:opacity-100"
                    style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#E60000";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.85)";
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
