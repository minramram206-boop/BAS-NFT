import type { Metadata } from 'next';
import { SeasonScreen } from '@/components/season/SeasonScreen';
import { MESSAGES } from '@/messages';

export const metadata: Metadata = { title: MESSAGES.metadata.season };

export default function SeasonPage() {
  return <SeasonScreen />;
}
