/**
 * Premium performer stats — Total Views, Approval Rate, Global Rank.
 * Seeded PRNG so numbers are deterministic per performer name across renders.
 */

function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  let state = h || 1;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    return (state >>> 0) / 4294967296;
  };
}

export type PerformerStats = {
  totalViews: number;
  approvalRate: number;
  globalRank: number;
};

export function simulatePerformerStats(name: string): PerformerStats {
  const rand = seededRandom(name.toLowerCase().trim());
  const totalViews = Math.round(1_200_000 + rand() * (5_800_000 - 1_200_000));
  const approvalRate = Math.round((96.5 + rand() * (99.1 - 96.5)) * 10) / 10;
  const globalRank = Math.round(5 + rand() * (45 - 5));
  return { totalViews, approvalRate, globalRank };
}

export function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
