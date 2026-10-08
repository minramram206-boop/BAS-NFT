import type { Metadata } from 'next';
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const citizens = loadCitizens();
  const telemetry = loadDistrictTelemetry();

  return (
    <html lang="en">
      <body className="m-0 h-screen w-screen select-none overflow-hidden bg-[#0c1622] p-1.5 font-pixel text-[#1a2734] antialiased selection:bg-[#4d7ca8] selection:text-white md:p-2">
        {/*
          Static cluster telemetry plus one session store seeded with the
          validated roster. Both live in the layout so session progression
          (trained stats, minted citizens) survives client-side navigation
          between the district and the dojo.
        */}
        <DistrictTelemetryProvider telemetry={telemetry}>
          <BasStoreProvider
            citizens={citizens}
            maxSupply={telemetry.maxSupply}
            trainingConfig={{
              baseTrainingCostAtoms: telemetry.baseTrainingCostAtoms,
              tokenDecimals: telemetry.tokenDecimals,
              tokenSymbol: MESSAGES.app.burnTokenSymbol,
            }}
          >
            {children}
          </BasStoreProvider>
        </DistrictTelemetryProvider>
      </body>
    </html>
  );
}
