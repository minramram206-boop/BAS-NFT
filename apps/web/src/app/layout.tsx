import type { Metadata, Viewport } from 'next';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-500.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import '@fontsource/silkscreen/latin-400.css';
import '@fontsource/silkscreen/latin-700.css';
import { loadCitizens } from '@bas/content/server';
import { loadDistrictTelemetry } from '@/config/telemetry';
import { DistrictTelemetryProvider } from '@/components/layout/DistrictTelemetryProvider';
import { BasStoreProvider } from '@/stores/BasStoreProvider';
import { MESSAGES } from '@/messages';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: MESSAGES.metadata.title,
    template: MESSAGES.metadata.titleTemplate,
  },
  description: MESSAGES.metadata.description,
  applicationName: MESSAGES.metadata.applicationName,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0c1622',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const citizens = loadCitizens();
  const telemetry = loadDistrictTelemetry();

  return (
    <html lang="en">
      <body className="m-0 h-dvh w-screen overflow-hidden bg-[#0c1622] font-pixel text-[#1a2734] antialiased">
        {/*
          Cluster telemetry plus one session store seeded with the validated
          roster. Both live in the layout so progress made in mock mode
          (training, missions) survives navigation between screens.
        */}
        <DistrictTelemetryProvider telemetry={telemetry}>
          <BasStoreProvider
            citizens={citizens}
            trainingConfig={{
              baseTrainingCostAtoms: telemetry.baseTrainingCostAtoms,
              tokenDecimals: telemetry.tokenDecimals,
              tokenSymbol: MESSAGES.app.tokenSymbol,
            }}
          >
            {children}
          </BasStoreProvider>
        </DistrictTelemetryProvider>
      </body>
    </html>
  );
}
