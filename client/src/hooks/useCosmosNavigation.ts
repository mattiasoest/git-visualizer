import { useEffect, useRef, useState } from 'react';

export type CosmosNavTarget = 'global' | 'active' | string;

export function useCosmosNavigation(archiveCount: number) {
  const [navTarget, setNavTarget] = useState<CosmosNavTarget>('global');
  const prevArchiveCount = useRef(archiveCount);

  useEffect(() => {
    if (archiveCount > prevArchiveCount.current) {
      setNavTarget('global');
    }
    prevArchiveCount.current = archiveCount;
  }, [archiveCount]);

  return { navTarget, setNavTarget };
}
