'use client';

import React, { createContext, useContext } from 'react';
import type { DistrictTelemetry } from '@/config/telemetry';

/**
 * Static cluster telemetry for this deployment.
 *
 * Kept in its own context instead of the zustand store because it never
 * changes during a session: it is resolved once on the server from
 * `config/<network>.json` and passed down as a prop.
 */
const DistrictTelemetryContext = createContext<DistrictTelemetry | null>(null);

export interface DistrictTelemetryProviderProps {
  telemetry: DistrictTelemetry;
  children: React.ReactNode;
}

export const DistrictTelemetryProvider: React.FC<DistrictTelemetryProviderProps> = ({
  telemetry,
  children,
}) => (
  <DistrictTelemetryContext.Provider value={telemetry}>
    {children}
  </DistrictTelemetryContext.Provider>
);

export function useDistrictTelemetry(): DistrictTelemetry {
  const telemetry = useContext(DistrictTelemetryContext);
  if (!telemetry) {
    throw new Error('useDistrictTelemetry must be used inside <DistrictTelemetryProvider>');
  }
  return telemetry;
}
