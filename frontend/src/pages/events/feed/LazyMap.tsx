import { lazy, Suspense, type ComponentProps } from 'react';

import { SkeletonBlock } from '@/components';

/** Карта грузится отдельным куском только тогда, когда её открыли: Leaflet не нужен тем, кто смотрит список. */
const EventMap = lazy(() => import('@/components/EventMap/EventMap').then((m) => ({ default: m.EventMap })));

export function LazyEventMap(props: ComponentProps<typeof EventMap>) {
  const height = props.height ?? 420;
  return (
    <Suspense
      fallback={
        <div role="status" aria-live="polite">
          <span className="sr-only">Загружаем карту…</span>
          <SkeletonBlock height={height} radius="media" />
        </div>
      }
    >
      <EventMap {...props} />
    </Suspense>
  );
}
