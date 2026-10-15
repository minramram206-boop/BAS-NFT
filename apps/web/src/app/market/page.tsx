import type { Metadata } from 'next';
import { MarketScreen } from '@/components/market/MarketScreen';
import { MESSAGES } from '@/messages';

export const metadata: Metadata = { title: MESSAGES.metadata.market };

/** Buy and sell citizens at a fixed price. Shares the session store seeded in `app/layout.tsx`. */
export default function MarketPage() {
  return <MarketScreen />;
}
