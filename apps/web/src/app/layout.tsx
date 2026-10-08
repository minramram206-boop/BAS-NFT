import type { Metadata } from 'next';
import { Silkscreen, Pixelify_Sans } from 'next/font/google';
import './globals.css';

const silkscreen = Silkscreen({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-heading',
});

const pixelify = Pixelify_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-pixel',
});

export const metadata: Metadata = {
  title: 'BAS - District 01 & Agent Training',
  description: 'Living Pixel Art World & Citizen Progression on Solana',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${silkscreen.variable} ${pixelify.variable}`}>
      <body className="font-pixel antialiased bg-[#0c1622] text-[#1a2734] w-screen h-screen m-0 p-1.5 md:p-2 overflow-hidden select-none selection:bg-[#4d7ca8] selection:text-white">
        {children}
      </body>
    </html>
  );
}
