import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { thumbUrl, type Video } from "@/lib/videos";
import { toggleWatchlist, isInWatchlist } from "@/lib/watchlist";

function isRealUrl(seed: string) {
  return seed.startsWith("//") || seed.startsWith("http://") || seed.startsWith("https://");
}

/**
 * Determine quality label from video quality field + title + tags.
 * Checks title and tags for "4K" / "4k" strings in addition to the quality field.
 */
function resolveQualityLabel(video: Video): "4K" | "1080P" {
  const q = (video.quality ?? "").toUpperCase().trim();
  if (q === "4K" || q === "UHD" || q === "ULTRA HD" || q === "2160P") return "4K";
  const haystack = `${video.title} ${video.tags.join(" ")}`.toLowerCase();
  if (haystack.includes("4k")) return "4K";
  return "1080P";
}

/**
 * Format a duration string to "FULL • 22M 53S".
 * Accepts: "22:53", "1:22:53", "22m 30s", "22m30s", "1h 22m".
 */
function formatFullDuration(dur: string): string {
  if (!dur || dur === "0:00") return "FULL VIDEO";
  const s = dur.trim();

  // HH:MM:SS
  const hms = s.match(/^(\d+):(\d+):(\d+)$/);
  if (hms) {
    const h = parseInt(hms[1]);
    const m = parseInt(hms[2]);
    const sec = parseInt(hms[3]);
    if (h > 0) return `FULL • ${h}H ${m}M ${sec}S`;
    return `FULL • ${m}M ${sec}S`;
  }

  // MM:SS
  const ms = s.match(/^(\d+):(\d+)$/);
  if (ms) {
    const m = parseInt(ms[1]);
    const sec = parseInt(ms[2]);
    return `FULL • ${m}M ${sec}S`;
  }

  // Text: "1h 22m 30s" / "22m 30s"
  const tm = s.match(/(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i);
  if (tm && (tm[1] || tm[2] || tm[3])) {
    const h = parseInt(tm[1] ?? "0") || 0;
    const m = parseInt(tm[2] ?? "0") || 0;
    const sec = parseInt(tm[3] ?? "0") || 0;
    if (h > 0) return `FULL • ${h}H ${m}M ${sec}S`;
    if (m > 0 && sec > 0) return `FULL • ${m}M ${sec}S`;
    if (m > 0) return `FULL • ${m}M`;
    if (sec > 0) return `FULL • ${sec}S`;
  }

  return `FULL • ${s.toUpperCase()}`;
}

export function VideoCard({ video }: { video: Video }) {
  const realUrl = isRealUrl(video.thumbSeed);
  const frames = realUrl
    ? [thumbUrl(video.thumbSeed, 800, 450)]
    : [
        thumbUrl(video.thumbSeed, 800, 450),
        thumbUrl(video.thumbSeed + "-f2", 800, 450),
        thumbUrl(video.thumbSeed + "-f3", 800, 450),
        thumbUrl(video.thumbSeed + "-f4", 800, 450),
      ];

  const [active, setActive] = useState(false);
  const [frame, setFrame] = useState(0);
  const [bookmarked, setBookmarked] = useState(false);

  useEffect(() => {
    setBookmarked(isInWatchlist(video.slug));
  }, [video.slug]);

  useEffect(() => {
    if (!active) { setFrame(0); return; }
    const t = setInterval(() => setFrame((n) => (n + 1) % frames.length), 700);
    return () => clearInterval(t);
  }, [active, frames.length]);

  const handleBookmark = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const added = toggleWatchlist(video);
    setBookmarked(added);
  };

  const qualityLabel = resolveQualityLabel(video);
  const durationOverlay = formatFullDuration(video.duration);

  return (
    <div
      className="group block"
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onTouchStart={() => setActive((a) => !a)}
    >
      {/* ── Thumbnail (wrapped in Link for navigation) ──────────────────── */}
      <Link to="/video/$slug" params={{ slug: video.slug }} className="block">
      <div className="relative aspect-video w-full overflow-hidden rounded-sm border-none bg-black transition-all duration-300 group-hover:shadow-[0_0_22px_rgba(230,0,0,0.45)]">
        {frames.map((src, idx) => (
          <img
            key={src}
            src={src}
            alt={video.title}
            loading="lazy"
            className={
              "absolute inset-0 h-full w-full object-cover transition-all duration-300 group-hover:scale-105 " +
              (idx === frame ? "opacity-100" : "opacity-0")
            }
          />
        ))}

        {/* Quality badge — capsule matching watch page badge exactly */}
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/80 rounded-full px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-wider text-white uppercase shadow-md">
          <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-[#E60000] animate-pulse"></span>
          {qualityLabel === "4K" ? "4K" : "1080P"}
        </div>

        {/* Duration badge — FULL • XM XS */}
        <div className="absolute bottom-1 right-1 h-[18px] min-w-[60px] flex items-center rounded-[3px] bg-black/80 px-1.5 py-0 text-[8px] font-bold uppercase tracking-wide text-white/90 backdrop-blur-sm whitespace-nowrap">
          {durationOverlay}
        </div>

        {/* Bookmark toggle */}
        <button
          onClick={handleBookmark}
          aria-label={bookmarked ? "Remove from watchlist" : "Add to watchlist"}
          title={bookmarked ? "Remove" : "Save"}
          className={
            "absolute bottom-1.5 left-1.5 z-10 grid h-6 w-6 place-items-center rounded-[3px] backdrop-blur-sm transition-all duration-200 " +
            (bookmarked
              ? "bg-primary text-white opacity-100 shadow-[0_0_8px_rgba(230,0,0,0.6)]"
              : "bg-black/75 text-white/70 opacity-0 group-hover:opacity-100 hover:bg-primary hover:text-white")
          }
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill={bookmarked ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* Play overlay */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary text-white shadow-[0_0_24px_rgba(230,0,0,0.5)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>
      </Link>

      {/* ── Card metadata ─────────────────────────────────────────────────── */}
      <div className="mt-2.5">
        <Link to="/video/$slug" params={{ slug: video.slug }} className="block">
        <h3 className="line-clamp-2 text-sm font-bold leading-snug text-foreground transition-colors group-hover:text-primary sm:text-[15px]">
          {video.title}
        </h3>
        </Link>

        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{video.year}</span>
          <span className="opacity-40">·</span>
          <span>{video.views} views</span>
        </div>

        {/* Performer chips — crimson, clickable Links */}
        {video.stars.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {video.stars.slice(0, 2).map((s) => (
              <Link
                key={s}
                to="/browse/pornstar/$name"
                params={{ name: encodeURIComponent(s) }}
                onClick={(e) => e.stopPropagation()}
                className="rounded-[3px] border border-[#E60000]/40 bg-[#E60000]/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide transition-all hover:border-[#E60000] hover:bg-[#E60000]/20 hover:shadow-[0_0_8px_rgba(230,0,0,0.4)]"
                style={{ color: "#E60000" }}
              >
                {s}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
