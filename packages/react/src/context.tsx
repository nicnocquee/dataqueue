'use client';

import { createContext, useContext } from 'react';
import type { DataqueueConfig } from './types.js';

const DataqueueContext = createContext<DataqueueConfig | null>(null);

/**
 * Provides default configuration (fetcher, pollingInterval) to all
 * `useJob` hooks in the subtree. Optional -- hooks can also accept
 * inline config via their options parameter.
 */
export function DataqueueProvider({
  children,
  ...config
}: DataqueueConfig & { children: React.ReactNode }) {
  return (
    <DataqueueContext.Provider value={config}>
      {children}
    </DataqueueContext.Provider>
  );
}

/**
 * Internal hook to read the provider config. Returns null when no provider
 * is present (hooks fall back to their own options).
 */
export function useDataqueueConfig(): DataqueueConfig | null {
  return useContext(DataqueueContext);
}
