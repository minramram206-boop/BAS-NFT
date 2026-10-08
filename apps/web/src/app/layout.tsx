import type { Metadata } from 'next';
import { Pixelify_Sans, Silkscreen } from 'next/font/google';
import { loadCitizens } from '@bas/content/server';
import { loadDistrictTelemetry } from '@/config/telemetry';
import { DistrictTelemetryProvider } from '@/components/layout/DistrictTelemetryProvider';
import { BasStoreProvider } from '@/stores/BasStoreProvider';
import './globals.css';

/**
 * Pixel fonts are fetched at build time by `next/font`.
 * In an offline CI runner, provide `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`
 * (see `docs/ARCHITECTURE.md`) so the build does not depend on the network.
 */
const silkscreen = Silkscreen({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap',
});

const pixelify = Pixelify_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-pixel',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'BAS - District 01 & Agent Training',
    template: '%s - BAS District 01',
  },
  description: 'Living Pixel Art World & Citizen Progression on Solana',
  applicationName: 'BAS Pixel District',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const citizens = loadCitizens();
  const telemetry = loadDistrictTelemetry();

  return (
    <html lang="en" className={`${silkscreen.variable} ${pixelify.variable}`}>
      <body className="m-0 h-screen w-screen select-none overflow-hidden bg-[#0c1622] p-1.5 font-pixel text-[#1a2734] antialiased selection:bg-[#4d7ca8] selection:text-white md:p-2">
        {/*
          Static cluster telemetry plus one session store seeded with the
          validated roster. Both live in the layout so session progression
          (trained stats, minted citizens) survives client-side navigation
          between the district and the dojo.
        */}
        <DistrictTelemetryProvider telemetry={telemetry}>
          <BasStoreProvider citizens={citizens}>{children}</BasStoreProvider>
        </DistrictTelemetryProvider>
      </body>
    </html>
  );
}
