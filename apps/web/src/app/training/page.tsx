import type { Metadata } from 'next';
import { TrainingScreen } from '@/components/training/TrainingScreen';
import { MESSAGES } from '@/messages';

export const metadata: Metadata = { title: MESSAGES.metadata.training };

/** Training for the selected citizen. Shares the session store seeded in `app/layout.tsx`. */
export default function TrainingPage() {
  return <TrainingScreen />;
}
