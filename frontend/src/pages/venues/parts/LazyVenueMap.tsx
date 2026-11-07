import { lazy, Suspense, type ComponentProps } from 'react';

import { SkeletonBlock } from '@/components';

const VenueMap = lazy(() => import('./VenueMap'));

export function LazyVenueMap(props: ComponentProps<typeof VenueMap>) {
  const height = props.height ?? 480;
  return (
    <Suspense
      fallback={
        <div role="status" aria-live="polite">
          <span className="sr-only">Загружаем карту…</span>
          <SkeletonBlock height={height} radius="media" />
        </div>
      }
    >
      <VenueMap {...props} />
    </Suspense>
  );
}
