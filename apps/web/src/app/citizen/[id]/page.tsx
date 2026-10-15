import type { Metadata } from 'next';
import { loadCitizens } from '@bas/content/server';
import { ProfileScreen } from '@/components/citizen/ProfileScreen';
import { MESSAGES } from '@/messages';

export const metadata: Metadata = { title: MESSAGES.metadata.citizen };

/**
 * One page per citizen of the roster, built ahead of time. Rendering a profile on request would
 * read the content files again at run time, which a deployed bundle may not have; an id outside
 * the roster is a real 404 instead of an empty profile.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return loadCitizens().map((citizen) => ({ id: String(citizen.id) }));
}

export default async function CitizenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProfileScreen id={Number.parseInt(id, 10)} />;
}
