import { CopySimpleIcon } from '@phosphor-icons/react';
import { useOne } from '@refinedev/core';
import type { ReactNode } from 'react';

import { Button, ErrorState, GoneState, NoAccessState, PageSkeleton, type ButtonSize } from '@/components';
import type { ApiError } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import type { EventDetails } from '@/types/api';

import { fromEvent, startsAtOf, type EventForm } from '../model';

/** С11: «Создать похожее» — мастер создания с полями этой встречи. */
export function CreateSimilarButton({
  eventId,
  size,
  variant = 'secondary',
}: {
  eventId: string;
  size?: ButtonSize;
  variant?: 'secondary' | 'quiet';
}) {
  return (
    <Button
      variant={variant}
      size={size}
      to={`/events/new?from=${eventId}`}
      icon={<CopySimpleIcon size={20} aria-hidden />}
    >
      Создать похожее
    </Button>
  );
}

/** Копия встречи для мастера: те же поля и время, дата — через неделю (и не в прошлом), без серии и объявления. */
function similarForm(e: EventDetails, now = dayjs()): EventForm {
  const base = fromEvent(e);
  let date = dayjs(base.date).add(1, 'week');
  const startOf = (d: dayjs.Dayjs) => startsAtOf({ ...base, date: d.format('YYYY-MM-DD') });
  for (let i = 0; i < 60; i++) {
    const iso = startOf(date);
    if (!iso || dayjs(iso).isAfter(now.add(1, 'hour'))) break;
    date = date.add(1, 'week');
  }
  return {
    ...base,
    date: date.format('YYYY-MM-DD'),
    repeat: false,
    repeatUntil: '',
    companionId: null,
    gear: base.gear.map((l) => ({ name: l.name, kind: l.kind, quantity: l.quantity })),
  };
}

export interface SimilarSource {
  form: EventForm;
  title: string;
}

/** Загружает исходную встречу и отдаёт копию мастеру. Копировать можно только свою встречу. */
export function SimilarGate({
  id,
  again = false,
  children,
}: {
  id: string;
  again?: boolean;
  children: (source: SimilarSource) => ReactNode;
}) {
  const { result: event, query } = useOne<EventDetails>({
    resource: 'events',
    id,
    queryOptions: { retry: false },
  });
  if (query.isLoading)
    return (
      <div className="container">
        <PageSkeleton label="Копируем встречу…" />
      </div>
    );
  if (query.isError || !event) {
    const code = (query.error as ApiError | null)?.code;
    return (
      <div className="container">
        {code === 'not_found' || code === 'event_deleted' ? (
          <GoneState
            title="Исходной встречи нет"
            actions={
              <Button variant="primary" to="/events/new">
                Создать с чистого листа
              </Button>
            }
          >
            Возможно, её удалили. Новую встречу можно заполнить с нуля или по шаблону.
          </GoneState>
        ) : (
          <ErrorState
            layout="page"
            title="Не удалось скопировать встречу"
            onRetry={() => void query.refetch()}
          />
        )}
      </div>
    );
  }
  if (!event.isOrganizer)
    return (
      <div className="container">
        <NoAccessState
          title="Скопировать можно только свою встречу"
          actions={
            <Button variant="primary" to="/events/new">
              Создать с чистого листа
            </Button>
          }
        >
          «{event.title}» проводит другой организатор. Создайте свою встречу с нуля или по шаблону.
        </NoAccessState>
      </div>
    );
  return (
    <>{children({ form: { ...similarForm(event), againFrom: again ? id : null }, title: event.title })}</>
  );
}
