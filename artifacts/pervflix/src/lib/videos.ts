export type Video = {
  slug: string;
  title: string;
  studio: string;
  category: string;
  stars: string[];
  year: number;
  duration: string;
  views: string;
  quality: "4K" | "1080p" | "HD";
  description: string;
  thumbSeed: string;
  tags: string[];
  embed_url?: string;
};

export const STUDIOS = [
  "Brazzers",
  "BLACKED",
  "BLACKED RAW",
  "TUSHY",
  "Team Skeet",
  "Bangbros",
  "Nubiles",
  "Reality Kings",
  "Mofos",
  "Naughty America",
  "Digital Playground",
  "Pure Taboo",
  "MissaX",
  "Family Strokes",
  "Sweet Sinner",
  "Oops Family",
  "Dad Crush",
  "Dating My Stepson",
  "Daughter Swap",
  "BrattySis",
  "My Family Pies",
  "Moms Teach Sex",
  "PervMom",
  "PervTherapy",
  "PervNana",
  "PervDoctor",
];

export const TRENDING = [
  "4k",
  "stepmom",
  "milf",
  "teen",
  "pov",
  "creampie",
  "big tits",
  "anal",
  "threesome",
  "lesbian",
  "amateur",
  "public",
];

export const CATEGORIES = [
  "Anal",
  "MILF",
  "Lesbian",
  "Teen",
  "POV",
  "Amateur",
  "Interracial",
  "Blowjob",
  "Big Tits",
  "Creampie",
  "Threesome",
  "Stepmom",
  "Cosplay",
  "Public",
];

export type Pornstar = {
  name: string;
  slug: string;
  avatarSeed: string;
  videoCount?: number;
  totalViews?: number;
  topThumbnail?: string | null;
  /** Dynamic portrait from backend — proxied video thumbnail or guaranteed fallback */
  photo?: string | null;
};

export const PORNSTARS: Pornstar[] = [
  { name: "Wendy Raine",    slug: "wendy-raine",    avatarSeed: "ps-wendy",    photo: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80" },
  { name: "Rachel Steele",  slug: "rachel-steele",  avatarSeed: "ps-rachel",   photo: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80" },
  { name: "Andi James",     slug: "andi-james",     avatarSeed: "ps-andi",     photo: "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=300&q=80" },
  { name: "Seka Black",     slug: "seka-black",     avatarSeed: "ps-seka",     photo: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80" },
  { name: "Melony Melons",  slug: "melony-melons",  avatarSeed: "ps-melony",   photo: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=300&q=80" },
  { name: "Ryan Keely",     slug: "ryan-keely",     avatarSeed: "ps-ryan",     photo: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=300&q=80" },
  { name: "Aderes Quin",    slug: "aderes-quin",    avatarSeed: "ps-aderes",   photo: "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=300&q=80" },
  { name: "Eva Notty",      slug: "eva-notty",      avatarSeed: "ps-evanotty", photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80" },
  { name: "Katie Monroe",   slug: "katie-monroe",   avatarSeed: "ps-katie",    photo: "https://images.unsplash.com/photo-1512484776495-a09d228f7383?auto=format&fit=crop&w=300&q=80" },
  { name: "Kendra Lust",    slug: "kendra-lust",    avatarSeed: "ps-kendra",   photo: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=300&q=80" },
  { name: "Coco Lovelock",  slug: "coco-lovelock",  avatarSeed: "ps-coco",     photo: "https://images.unsplash.com/photo-1481214110143-ed630356e1bb?auto=format&fit=crop&w=300&q=80" },
  { name: "Angela White",   slug: "angela-white",   avatarSeed: "ps-angela",   photo: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=300&q=80" },
  { name: "Julia Ann",      slug: "julia-ann",      avatarSeed: "ps-julia",    photo: "https://images.unsplash.com/photo-1543132220-3ec99c6094ec?auto=format&fit=crop&w=300&q=80" },
  { name: "Syren de Mer",   slug: "syren-de-mer",   avatarSeed: "ps-syren",    photo: "https://images.unsplash.com/photo-1516575307990-616c829a3842?auto=format&fit=crop&w=300&q=80" },
  { name: "Ava Addams",     slug: "ava-addams",     avatarSeed: "ps-ava",      photo: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=300&q=80" },
  { name: "Lana Rhoades",   slug: "lana-rhoades",   avatarSeed: "ps-lana",     photo: "https://images.unsplash.com/photo-1485178575877-1a13bf4896f8?auto=format&fit=crop&w=300&q=80" },
  { name: "Riley Reid",     slug: "riley-reid",     avatarSeed: "ps-riley",    photo: "https://images.unsplash.com/photo-1506919258185-6078bba55d2a?auto=format&fit=crop&w=300&q=80" },
  { name: "Abella Danger",  slug: "abella-danger",  avatarSeed: "ps-abella",   photo: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&q=80" },
  { name: "Eva Elfie",      slug: "eva-elfie",      avatarSeed: "ps-eva",      photo: "https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?auto=format&fit=crop&w=300&q=80" },
  { name: "Lena Paul",      slug: "lena-paul",      avatarSeed: "ps-lena",     photo: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=300&q=80" },
  { name: "Brandi Love",    slug: "brandi-love",    avatarSeed: "ps-brandi",   photo: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=300&q=80" },
  { name: "Cory Chase",     slug: "cory-chase",     avatarSeed: "ps-cory",     photo: "https://images.unsplash.com/photo-1481437156560-3205f6a55735?auto=format&fit=crop&w=300&q=80" },
  { name: "Dani Daniels",   slug: "dani-daniels",   avatarSeed: "ps-dani",     photo: "https://images.unsplash.com/photo-1552058544-f2b08422138a?auto=format&fit=crop&w=300&q=80" },
  { name: "Emily Willis",   slug: "emily-willis",   avatarSeed: "ps-emily",    photo: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80" },
  { name: "Mia Malkova",    slug: "mia-malkova",    avatarSeed: "ps-mia",      photo: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80" },
  { name: "Alyssia Kent",   slug: "alyssia-kent",   avatarSeed: "ps-alyssia",  photo: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80" },
  { name: "Kiara Mia",      slug: "kiara-mia",      avatarSeed: "ps-kiara",    photo: "https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=300&q=80" },
  { name: "Dredd xxx",      slug: "dredd-xxx",      avatarSeed: "ps-dredd",    photo: "https://images.unsplash.com/photo-1506919258185-6078bba55d2a?auto=format&fit=crop&w=300&q=80" },
  { name: "Jasmine Jae",    slug: "jasmine-jae",    avatarSeed: "ps-jasmine",  photo: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80" },
  { name: "London River",   slug: "london-river",   avatarSeed: "ps-london",   photo: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=300&q=80" },
  { name: "Raissa Bellini", slug: "raissa-bellini", avatarSeed: "ps-raissa",   photo: "https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=300&q=80" },
  { name: "Miss Raquel",    slug: "miss-raquel",    avatarSeed: "ps-raquel",   photo: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=300&q=80" },
  { name: "Sophia Deluxe",  slug: "sophia-deluxe",  avatarSeed: "ps-sophia",   photo: "https://images.unsplash.com/photo-1516575307990-616c829a3842?auto=format&fit=crop&w=300&q=80" },
];

export function thumbUrl(seed: string, _w = 800, _h = 450) {
  const full = seed.startsWith("//") ? `https:${seed}` : seed;
  if (
    full.includes("fastporndelivery.hqporner.com") ||
    full.includes("hqporner.com/imgs")
  ) {
    return `/api/pf/thumb?url=${encodeURIComponent(full)}`;
  }
  if (full.startsWith("https://") || full.startsWith("http://")) return full;
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/800/450`;
}
