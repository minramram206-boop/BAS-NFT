import type { Metadata } from 'next';
import { StudioScreen } from '@/components/studio/StudioScreen';
import { MESSAGES } from '@/messages';

export const metadata: Metadata = { title: MESSAGES.metadata.studio };

/** BAS Studio, reached from its building in the city. The player itself lives in `app/layout.tsx`. */
export default function StudioPage() {
  return <StudioScreen />;
}
