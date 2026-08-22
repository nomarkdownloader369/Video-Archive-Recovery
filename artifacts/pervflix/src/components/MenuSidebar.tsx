import { Link } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CATEGORIES } from "@/lib/videos";
import { SIDEBAR_PERFORMERS } from "@/lib/performers";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ReactNode } from "react";
import { Heart } from "lucide-react";

export function MenuSidebar({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const onClose = () => setOpen(false);

  // Fetch dynamic performer portraits from the backend (cached 5 min).
  // Backend returns a pre-proxied `photo` field for every whitelisted performer.
  const { data: performerPhotos } = useQuery({
    queryKey: ["performer-photos-sidebar"],
    queryFn:  () => api.listPornstars(),
    staleTime: 5 * 60_000,
  });

  // Build a fast name → photo lookup from the API response.
  const photoMap = new Map<string, string>(
    (performerPhotos ?? [])
      .filter((p) => !!p.photo)
      .map((p) => [p.name.toLowerCase(), p.photo as string]),
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-l border-[color:var(--hairline)] bg-black p-0 text-foreground sm:max-w-md"
      >
        <SheetHeader className="p-0">
          <div className="flex items-center justify-between w-full pb-4 border-b border-neutral-900 pl-4 pr-12 pt-2">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <div className="flex items-center gap-2">
              <Link to="/" onClick={onClose} className="flex shrink-0 items-center">
                <img src="/logo-vertical.png?v=11" alt="PERVFLIX" className="h-14 w-auto shrink-0 object-contain" />
              </Link>
              <span className="text-base font-black uppercase tracking-wider text-white">Menu</span>
            </div>
            <Link to="/watchlist" onClick={onClose} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary bg-transparent text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-all hover:bg-primary/10">
              <Heart className="w-3.5 h-3.5 text-primary fill-primary animate-pulse" />
              <span className="text-white">My Watchlist</span>
            </Link>
          </div>
        </SheetHeader>

        {/* Categories */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Categories</SectionLabel>
            {/* SEE ALL — routes to /browse/categories and closes sidebar */}
            <Link
              to="/browse/categories"
              onClick={onClose}
              className="text-[10px] font-bold uppercase tracking-widest text-primary transition-opacity hover:text-primary/80"
            >
              See All →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <Link
                key={c}
                to="/"
                search={{ category: c.toLowerCase() }}
                onClick={onClose}
                className="rounded-sm border border-[color:var(--hairline)] bg-[color:var(--surface-2)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-foreground/85 transition-colors hover:border-primary hover:text-primary"
              >
                {c}
              </Link>
            ))}
          </div>
        </div>

        {/* Performers — exact 33-person whitelist */}
        <div className="border-t border-[color:var(--hairline)] p-5">
          <div className="flex items-center justify-between">
            <SectionLabel>Performers</SectionLabel>
            <Link
              to="/browse/pornstars"
              onClick={onClose}
              className="text-[10px] font-bold uppercase tracking-widest text-primary transition-opacity hover:text-primary/80"
            >
              See All →
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-x-2 gap-y-4">
            {SIDEBAR_PERFORMERS.map((p) => (
              <Link
                key={p.name}
                to="/browse/pornstar/$name"
                params={{ name: encodeURIComponent(p.name) }}
                onClick={onClose}
                className="group flex flex-col items-center gap-1.5"
              >
                {/* Portrait avatar — dynamic frame from the performer's top-viewed video */}
                <span className="relative grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-black ring-2 ring-primary/40 shadow-[0_0_6px_rgba(230,0,0,0.5)] transition-all duration-300 group-hover:scale-110 group-hover:ring-primary/80 group-hover:shadow-[0_0_10px_rgba(230,0,0,0.7)]">
                  <img
                    src={photoMap.get(p.name.toLowerCase()) ?? p.portrait}
                    alt={p.name}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="h-full w-full object-cover object-top"
                  />
                </span>
                <span className="line-clamp-2 text-center text-[9px] font-semibold leading-tight text-foreground/75 transition-colors group-hover:text-primary">
                  {p.name}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-t border-[color:var(--hairline)] p-5">
          <Link
            to="/"
            onClick={onClose}
            className="block rounded-sm bg-primary px-4 py-3 text-center text-sm font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
          >
            Back to Home
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-[11px] font-bold uppercase tracking-widest text-primary">
      {children}
    </h4>
  );
}
