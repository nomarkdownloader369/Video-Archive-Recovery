import { twMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getProxyThumb = (url?: string | null) => {
  if (!url) return '';
  if (url.startsWith('/api/pf/thumb?')) return url;
  return `/api/pf/thumb?url=${encodeURIComponent(url.replace(/^http:\/\//i, 'https://'))}`;
};
