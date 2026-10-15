import type { Metadata } from 'next';
import { MintScreen } from '@/components/mint/MintScreen';
import { MESSAGES } from '@/messages';

export const metadata: Metadata = { title: MESSAGES.metadata.mint };

/** Mint a citizen. Shares the session store seeded in `app/layout.tsx`. */
export default function MintPage() {
  return <MintScreen />;
}
