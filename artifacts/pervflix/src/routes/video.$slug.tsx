import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { type Video } from "@/lib/videos";
import { api } from "@/lib/api";
import { VideoCard } from "@/components/VideoCard";
import { toggleWatchlist, isInWatchlist } from "@/lib/watchlist";

export const Route = createFileRoute("/video/$slug")({
  loader: async ({ params }): Promise<{ video: Video; related: Video[] }> => {
    const slug = params.slug;
    const [video, paged] = await Promise.all([
      api.getVideo(params.slug),
      api
        .listVideos({ sort: "new", limit: 9 })
        .catch(() => ({ videos: [], pagination: { total: 0, pages: 1, page: 1, limit: 9 } })),
    ]);
    if (!video) throw notFound();
    const related = paged.videos.filter((v) => v.slug !== params.slug).slice(0, 8);
    return { video, related };
  },
  component: WatchPage,
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-3xl font-black">Video not found</h1>
      <p className="mt-2 text-muted-foreground">
        This film may have been removed or the link is broken.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-sm bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground"
      >
        Back home
      </Link>
    </div>
  ),
});

/** Format raw seconds into "26M 44S" display label */
function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}M ${String(s).padStart(2, "0")}S`;
}

/** Normalise "HD" to "1080P" for display */
function displayQuality(q: string): string {
  if (!q || q === "HD") return "1080P";
  return q.toUpperCase();
}

/**
 * Filter out studio-name tags — only show real genre/keyword tags.
 */
const KNOWN_STUDIOS = new Set([
  "brazzers", "blacked", "blacked raw", "tushy", "bangbros", "mofos", "nubiles",
  "reality kings", "naughty america", "digital playground", "pure taboo", "missax",
  "family strokes", "sweet sinner", "oops family", "dad crush", "daughter swap",
  "brattysis", "my family pies", "moms teach sex", "pervmom", "pervtherapy", "pervnana",
  "pervdoctor", "team skeet", "dorcel", "hqporner", "21sextury", "kink",
  "girlfriendsfilms", "passion-hd", "fakehub", "wicked", "vivid",
  "adult time", "mylf", "deeper", "vixen", "score", "score group",
  "mom comes first", "dating my stepson",
]);

function isStudioTag(tag: string): boolean {
  const lower = tag.toLowerCase();
  if (KNOWN_STUDIOS.has(lower)) return true;
  if (/^[A-Z][a-zA-Z]+$/.test(tag) && !tag.includes(" ")) {
    const allowedCaps = ["POV", "HD", "UHD"];
    return !allowedCaps.includes(tag.toUpperCase());
  }
  return false;
}

function WatchPage() {
  const { video, related } = Route.useLoaderData() as { video: Video; related: Video[] };
  const [bookmarked, setBookmarked] = useState(false);

  useEffect(() => {
    setBookmarked(isInWatchlist(video.slug));
  }, [video.slug]);

  const handleWatchlist = () => {
    const added = toggleWatchlist(video);
    setBookmarked(added);
  };

  const quality = displayQuality(video.quality);

  const is4K =
    video.title.toLowerCase().includes("4k") ||
    video.tags.some(
      (t) =>
        t.toLowerCase() === "4k" ||
        t.toLowerCase() === "2160p" ||
        t.toLowerCase() === "#4k" ||
        t.toLowerCase() === "#4k porn",
    );
  const playerQualityText = is4K ? "4K" : "1080P";
  const metadataQualityText = is4K ? "ULTRA" : "HD";

  // Filter out studio tags — only show genre/keyword tags
  const visibleTags = video.tags.filter((t) => !isStudioTag(t));

  // Build deduplicated category pills: primary category + matching genre tags.
  // "hd", "HD", "4k", resolution strings, and studio names are excluded.
  const KNOWN_CATS = new Set([
    "milf","stepmom","teen","pov","anal","lesbian","amateur","blowjob","big tits",
    "creampie","threesome","interracial","cosplay","public","hardcore","solo","squirt",
    "deepthroat","gangbang","massage","casting","compilation","stepsister","family",
    "mature","femdom","old","young","old/young","freeuse","brattysis","taboo","incest",
    "stepdaughter","stepdad","redhead","blonde","brunette","stockings","glasses","office",
  ]);
  // Terms that are never useful as browseable category pills
  const PILL_BLOCKLIST = new Set([
    "hd","4k","uhd","1080p","720p","480p","4k porn","60fps","1080","sd",
  ]);
  const categoryPills: string[] = [];
  if (video.category) {
    const catLow = video.category.toLowerCase();
    if (!PILL_BLOCKLIST.has(catLow) && !KNOWN_STUDIOS.has(catLow)) {
      categoryPills.push(video.category);
    }
  }
  for (const t of video.tags) {
    const low = t.toLowerCase();
    if (
      KNOWN_CATS.has(low) &&
      !PILL_BLOCKLIST.has(low) &&
      !KNOWN_STUDIOS.has(low) &&
      !categoryPills.some((c) => c.toLowerCase() === low)
    ) {
      categoryPills.push(t);
    }
  }

  const videoAliases = video as typeof video & {
    primaryEmbedUrl?: string | null;
    embedUrl?: string | null;
    videoUrl?: string | null;
  };
  const embedUrl = videoAliases.primaryEmbedUrl || video.embed_url || videoAliases.embedUrl || "";
  const directVideoUrl = videoAliases.videoUrl || "";
  const isDirectVideo = /\.(?:mp4|webm|ogg|m3u8)(?:$|[?#])/i.test(directVideoUrl);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── Player column ───────────────────────────────────────────────── */}
        <div className="min-w-0">
          {/* Player */}
          <div className="relative aspect-video w-full overflow-hidden rounded-sm border-none bg-black">
            {isDirectVideo ? (
              <video
                controls
                playsInline
                className="h-full w-full"
                src={directVideoUrl}
              >
                Your browser does not support embedded video playback.
              </video>
            ) : (
              <iframe
                key={video.id}
                src={videoAliases.primaryEmbedUrl || video.embed_url || undefined}
                allowFullScreen
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                className="h-full w-full border-0"
                title={video.title}
              />
            )}
            {/* Quality badge — pulsing red dot */}
            <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/80 rounded-full px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-wider text-white uppercase shadow-md">
              <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-[#E60000] animate-pulse"></span>
              {playerQualityText}
            </div>
          </div>

          {embedUrl && (
            <div className="mt-3 flex justify-end">
              <a
                href={embedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-sm border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                Watch Direct Stream / Server 2
              </a>
            </div>
          )}

          {/* Metadata row */}
          <div className="mt-5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
              {video.category && !PILL_BLOCKLIST.has(video.category.toLowerCase()) && (
                <Link
                  to="/"
                  search={{ category: video.category }}
                  className="rounded-sm bg-primary px-2 py-0.5 text-white transition-opacity hover:opacity-90"
                >
                  {video.category}
                </Link>
              )}
              <span className="rounded-sm bg-primary px-2 py-0.5 text-white">
                {metadataQualityText}
              </span>
              <span className="text-muted-foreground">
                {(() => {
                  const dur =
                    video.duration && video.duration !== "0:00"
                      ? video.duration
                      : video.duration_seconds > 0
                        ? formatDuration(video.duration_seconds)
                        : null;
                  return [video.year, dur, video.views ? `${video.views} views` : null]
                    .filter(Boolean)
                    .join(" • ");
                })()}
              </span>
            </div>
            <h1
              className="mt-2 text-2xl font-black tracking-tight text-foreground sm:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {video.title}
            </h1>
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton icon="download" label="Download" />
            <ActionButton icon="share" label="Share" />

            {/* Watchlist toggle */}
            <button
              onClick={handleWatchlist}
              className={
                "inline-flex items-center gap-2 rounded-sm border px-4 py-2 text-xs font-bold uppercase tracking-wide transition-all " +
                (bookmarked
                  ? "border-primary bg-primary text-white shadow-[0_0_12px_rgba(230,0,0,0.4)] hover:bg-primary/90"
                  : "border-[color:var(--hairline)] bg-[color:var(--surface)] text-foreground/85 hover:border-primary hover:text-primary")
              }
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill={bookmarked ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              {bookmarked ? "− Remove from Watchlist" : "+ Watchlist"}
            </button>

            <ActionButton icon="flag" label="Report Broken Link" />
          </div>

          {video.description && (
            <p className="mt-6 max-w-3xl text-sm leading-relaxed text-foreground/80">
              {video.description}
            </p>
          )}

          {/* Performer links — crimson red (#E60000), clickable */}
          {video.stars.length > 0 && (
            <div className="mt-6">
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Models
              </p>
              <div className="flex flex-wrap gap-2">
                {video.stars.map((s) => (
                  <Link
                    key={s}
                    to="/browse/pornstar/$name"
                    params={{ name: encodeURIComponent(s) }}
                    className="inline-flex items-center gap-1 rounded-sm border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold transition-all hover:border-primary hover:bg-primary/20 hover:shadow-[0_0_8px_rgba(230,0,0,0.3)]"
                    style={{ color: "#E60000" }}
                  >
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    {s}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Categories — crimson clickable pills (Task 2) */}
          {categoryPills.length > 0 && (
            <div className="mt-6">
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Categories
              </p>
              <div className="flex flex-wrap gap-2">
                {categoryPills.map((c) => (
                  <Link
                    key={c}
                    to="/"
                    search={{ category: c.toLowerCase() }}
                    className="inline-flex items-center rounded-sm border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all hover:border-primary hover:bg-primary/20 hover:shadow-[0_0_8px_rgba(230,0,0,0.3)]"
                    style={{ color: "#E60000" }}
                  >
                    {c}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Tags — genre/keyword pills only, NO studio tags */}
          {visibleTags.length > 0 && (
            <div className="mt-5">
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Tags
              </p>
              <div className="flex flex-wrap gap-2">
                {visibleTags.map((t) => (
                  <Link
                    key={t}
                    to="/"
                    search={{ tag: t }}
                    className="inline-flex items-center rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-all hover:border-primary/50 hover:text-primary"
                  >
                    #{t}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Related Films — sidebar grid ─────────────────────────────────── */}
        <aside className="min-w-0">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Related Films
          </h2>

          {/* 2-column grid at all breakpoints within the sidebar */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-5">
            {related.map((r) => (
              <VideoCard key={r.slug} video={r} />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
}: {
  icon: "download" | "share" | "flag";
  label: string;
}) {
  const paths: Record<string, string> = {
    download: "M12 3v12m0 0-4-4m4 4 4-4M4 21h16",
    share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
    flag: "M4 21V4h13l-2 5 2 5H4",
  };
  return (
    <button className="inline-flex items-center gap-2 rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface)] px-4 py-2 text-xs font-bold uppercase tracking-wide text-foreground/85 transition-colors hover:border-primary hover:text-primary">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={paths[icon]} />
      </svg>
      {label}
    </button>
  );
}
