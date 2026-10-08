import type { Metadata } from 'next';
import { Pixelify_Sans, Silkscreen } from 'next/font/google';
import { loadCitizens } from '@bas/content/server';
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
  return (
    <html lang="en" className={`${silkscreen.variable} ${pixelify.variable}`}>
      <body className="m-0 h-screen w-screen select-none overflow-hidden bg-[#0c1622] p-1.5 font-pixel text-[#1a2734] antialiased selection:bg-[#4d7ca8] selection:text-white md:p-2">
        {/*
          One store for the whole session, seeded with the validated roster.
          Living in the layout keeps session progression (trained stats, minted
          citizens) across client-side navigation between the district and dojo.
        */}
        <BasStoreProvider citizens={loadCitizens()}>{children}</BasStoreProvider>
      </body>
    </html>
  );
}
