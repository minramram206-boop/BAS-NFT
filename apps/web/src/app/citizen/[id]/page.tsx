import type { Metadata } from 'next';
import { ProfileScreen } from '@/components/citizen/ProfileScreen';
import { MESSAGES } from '@/messages';

export const metadata: Metadata = { title: MESSAGES.metadata.citizen };

export default async function CitizenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProfileScreen id={Number.parseInt(id, 10)} />;
}
