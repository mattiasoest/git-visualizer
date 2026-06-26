import { useState } from 'react';

export type CosmosNavTarget = 'global' | 'active' | string;

export function useCosmosNavigation() {
  const [navTarget, setNavTarget] = useState<CosmosNavTarget>('global');

  return { navTarget, setNavTarget };
}
