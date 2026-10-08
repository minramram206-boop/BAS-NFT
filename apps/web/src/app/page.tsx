import { DistrictApp } from '@/components/district/DistrictApp';

/**
 * District 01 plaza.
 * The citizen roster is loaded and validated once in `app/layout.tsx` by
 * `@bas/content/server`. The dojo lives on `/training`.
 */
export default function DistrictPage() {
  return <DistrictApp />;
}
