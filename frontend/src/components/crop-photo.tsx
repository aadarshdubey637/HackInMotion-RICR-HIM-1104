'use client';

/**
 * A crop photo, fetched with the farmer's token.
 *
 * Crop photos are private to the farm that took them, so the route serving them
 * requires a bearer token. `<img src>` cannot send one — the browser issues that
 * request on its own, with no headers we control — so the bytes are fetched here
 * and handed over as a `blob:` URL instead.
 *
 * `next/image` is deliberately not used: it would route the URL through the Next
 * image optimizer, which fetches server-side and has no access to the farmer's
 * token. These are 64px thumbnails, so there is nothing to optimise anyway.
 */

import { useEffect, useState } from 'react';
import { requestObjectUrl } from '@/lib/api';

interface CropPhotoProps {
  /** The stored `imageUrl`. Only its trailing filename is used. */
  src: string;
  alt?: string;
  className?: string;
}

export function CropPhoto({ src, alt = '', className }: CropPhotoProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Rows written before photos were made private hold `/uploads/<filename>`;
    // newer ones hold the API path. Taking the last segment resolves both, and
    // the server validates the shape before it looks anything up.
    const filename = src.split('/').pop();
    if (!filename) {
      setFailed(true);
      return;
    }

    const controller = new AbortController();
    let created: string | null = null;

    requestObjectUrl(`/crop-health/photo/${filename}`, controller.signal)
      .then((url) => {
        created = url;
        setObjectUrl(url);
      })
      .catch((err) => {
        // An aborted fetch is this effect being cleaned up, not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      });

    return () => {
      controller.abort();
      // Releasing the blob is not optional: without it the bytes stay resident
      // for the life of the document, and this list re-renders as logs change.
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-soil-100 text-[10px] text-slate-400">
        No photo
      </div>
    );
  }

  if (!objectUrl) {
    return <div className="h-full w-full animate-pulse bg-soil-100" />;
  }

  // eslint-disable-next-line @next/next/no-img-element -- blob: URL, see above
  return <img src={objectUrl} alt={alt} className={className} />;
}
