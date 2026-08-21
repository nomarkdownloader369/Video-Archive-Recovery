import type { Video } from "./videos";

const WATCHLIST_KEY = "pervflix_watchlist";

export function getWatchlist(): Video[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Video[];
  } catch {
    return [];
  }
}

export function toggleWatchlist(video: Video): boolean {
  const current = getWatchlist();
  const idx = current.findIndex((v) => v.slug === video.slug);
  if (idx >= 0) {
    current.splice(idx, 1);
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(current));
    return false; // removed
  } else {
    current.push(video);
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(current));
    return true; // added
  }
}

export function isInWatchlist(slug: string): boolean {
  return getWatchlist().some((v) => v.slug === slug);
}

export function removeFromWatchlist(slug: string): void {
  const current = getWatchlist().filter((v) => v.slug !== slug);
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(current));
}

export function clearWatchlist(): void {
  localStorage.removeItem(WATCHLIST_KEY);
}
