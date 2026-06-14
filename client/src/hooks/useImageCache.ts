import { useEffect, useRef } from 'react';

export function useImageCache(urls: string[]) {
  const cacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const urlsKey = urls.join('\0');

  useEffect(() => {
    for (const url of urls) {
      if (!url || cacheRef.current.has(url)) continue;
      const image = new Image();
      image.src = url;
      cacheRef.current.set(url, image);
    }
  }, [urlsKey]);

  return cacheRef;
}
