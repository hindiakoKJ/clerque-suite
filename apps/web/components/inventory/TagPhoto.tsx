'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { photoApiPath } from '@/lib/inventory/tags';

/**
 * One tag photo. The photo route needs the sign-in token, so a plain
 * <img src> gets a 401: it is fetched through the api client as a blob and
 * shown from an object URL, which is let go when the photo leaves the screen.
 *
 * The blob is cached by React Query, so the same photo on Find a tag, Waiting
 * for cost and the till's cart line is downloaded once.
 */
export function TagPhoto({
  url,
  alt,
  className,
  fit = 'cover',
}: {
  url: string;
  alt: string;
  className?: string;
  fit?: 'cover' | 'contain';
}) {
  const path = photoApiPath(url);
  const { data: blob, isLoading, isError } = useQuery<Blob>({
    queryKey: ['tag-photo', path],
    queryFn: () => api.get<Blob>(path, { responseType: 'blob' }).then((r) => r.data),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
  });

  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setSrc(null); return; }
    const objectUrl = URL.createObjectURL(blob);
    setSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return (
    <div className={cn('relative overflow-hidden bg-muted', className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- an object URL, not a static asset
        <img src={src} alt={alt} className={cn('h-full w-full', fit === 'cover' ? 'object-cover' : 'object-contain')} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : isError ? <ImageOff className="h-4 w-4" /> : null}
        </div>
      )}
    </div>
  );
}
