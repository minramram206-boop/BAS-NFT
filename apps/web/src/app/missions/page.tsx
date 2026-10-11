import type { Metadata } from 'next';
import { MissionsScreen } from '@/components/missions/MissionsScreen';
import { MESSAGES } from '@/messages';

export const metadata: Metadata = { title: MESSAGES.metadata.missions };

export default function MissionsPage() {
  return <MissionsScreen />;
}
