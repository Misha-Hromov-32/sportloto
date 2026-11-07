import { PlusIcon } from '@phosphor-icons/react';
import { useDataProvider } from '@refinedev/core';
import { useQuery } from '@tanstack/react-query';

import { Button, ErrorState } from '@/components';
import { count, WORDS } from '@/lib/plural';
import { cityLocationFilters } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { EventView, Identity } from '@/types/api';
import type { District } from '@/types/domain';

import { orderEvents, type EventOrder } from './ranking';
import styles from './Feed.module.css';
import { CreateCard, FeedCard } from './FeedCard';
import {
  activeKeys,
  chipLabel,
  clearKey,
  createHref,
  EMPTY_FILTERS,
  isOpenForFeed,
  toCrudFilters,
  type FeedFilters,
  type FilterKey,
} from './filters';
import { LazyEventMap } from './LazyMap';
import { FeedBlock, GridSkeleton } from './Sections';
import { ViewSwitch, type FeedView } from './ViewSwitch';
import { usePagedEvents } from './usePagedEvents';

interface ResultsProps {
  order?: EventOrder;
  filters: FeedFilters;
  onChange: (next: FeedFilters) => void;
  districts: District[];
  sportName: (id: string) => string;
  view: FeedView;
  onView: (view: FeedView) => void;
  me: Identity | null;
  simple: boolean;
  /** Заголовок вместо «Нашлось N», когда фильтров нет. */
  title?: string;
}

export function Results({
  order = 'relevance',
  filters,
  onChange,
  districts,
  sportName,
  view,
  onView,
  me,
  simple,
  title,
}: ResultsProps) {
  const data = usePagedEvents(toCrudFilters(filters, districts), {
    sorters: order === 'time' ? [{ field: 'startsAt', order: 'asc' }] : [],
  });
  const { query } = data;
  const events = orderEvents(
    data.events.filter(isOpenForFeed),
    order,
    filters.q,
    me?.interests.map((sport) => sport.id),
  );
  const origin = filters.near
    ? (districts.find((d) => d.id === filters.from) ??
      me?.home ??
      districts.find((d) => d.id === me?.districtId) ??
      null)
    : null;

  const heading =
    title ??
    (query.isLoading
      ? 'Ищем…'
      : events.length
        ? `Нашлось ${count(data.total, WORDS.event)}`
        : 'Ничего не нашлось');

  return (
    <FeedBlock
      id="results"
      title={heading}
      action={!simple && events.length > 0 ? <ViewSwitch value={view} onChange={onView} /> : undefined}
    >
      <p className="sr-only" aria-live="polite">
        {query.isLoading ? '' : heading}
      </p>
      {query.isLoading ? (
        <GridSkeleton />
      ) : query.isError && events.length === 0 ? (
        <ErrorState onRetry={() => void query.refetch()}>
          Не удалось загрузить события. Проверьте интернет и нажмите «Повторить».
        </ErrorState>
      ) : events.length === 0 ? (
        <NothingFound
          filters={filters}
          onChange={onChange}
          districts={districts}
          sportName={sportName}
          me={me}
        />
      ) : view === 'map' ? (
        <LazyEventMap
          events={events}
          origin={origin}
          radiusKm={filters.near ? filters.radiusKm : null}
          height={520}
        />
      ) : (
        <ul data-stagger="" className={[styles.grid, simple && styles.gridLarge].filter(Boolean).join(' ')}>
          {events.map((e) => (
            <li key={e.id} className={styles.cell}>
              <FeedCard event={e} large={simple} />
            </li>
          ))}
          {!simple && (
            <li className={styles.cell}>
              <CreateCard
                to={createHref(filters, me)}
                text="Условия поиска подставим в форму: останется выбрать время и место."
              />
            </li>
          )}
        </ul>
      )}
      {events.length > 0 && data.hasMore && (
        <Button block size="lg" loading={data.loadingMore} onClick={data.loadMore}>
          {query.isFetchNextPageError
            ? 'Повторить загрузку'
            : `Показать ещё · загружено ${events.length} из ${data.total}`}
        </Button>
      )}
    </FeedBlock>
  );
}

/**
 * Пустая выдача: считаем, сколько найдётся без каждого фильтра, и предлагаем убрать тот,
 * без которого находится больше всего. Плюс — создать своё событие с теми же условиями.
 */
export function NothingFound({
  filters,
  onChange,
  districts,
  sportName,
  me,
}: {
  filters: FeedFilters;
  onChange: (next: FeedFilters) => void;
  districts: District[];
  sportName: (id: string) => string;
  me: Identity | null;
}) {
  const city = useSelectedCity();
  const getDataProvider = useDataProvider();
  const keys = activeKeys(filters);
  const relax = useQuery({
    queryKey: ['events', 'relax', city.id, JSON.stringify(filters), districts.length],
    queryFn: async () => {
      const dp = getDataProvider();
      const counts = await Promise.all(
        keys.map(async (key) => {
          const res = await dp.getList<EventView>({
            resource: 'events',
            filters: [...toCrudFilters(clearKey(filters, key), districts), ...cityLocationFilters(city)],
            pagination: { currentPage: 1, pageSize: 1, mode: 'server' },
          });
          return { key, total: res.total };
        }),
      );
      return counts.sort((a, b) => b.total - a.total)[0] ?? null;
    },
    enabled: keys.length > 0,
  });

  const best: { key: FilterKey; total: number } | null =
    relax.data && relax.data.total > 0 ? relax.data : null;
  const bestLabel = best
    ? chipLabel(best.key, filters, {
        sportName,
        districtName: (id) => districts.find((d) => d.id === id)?.name ?? null,
      })
    : '';

  return (
    <div className={styles.empty}>
      <h3 className={styles.emptyTitle}>Подходящих событий пока нет</h3>
      <p className={styles.emptyText}>
        {relax.isLoading
          ? 'Смотрим, что найдётся, если ослабить условия…'
          : best
            ? `Если убрать «${bestLabel}», найдётся ${count(best.total, WORDS.event)}. Или создайте своё событие: условия поиска подставим в форму.`
            : 'Попробуйте другой день или направление. Или создайте своё событие: условия поиска подставим в форму.'}
      </p>
      <div className={styles.emptyActions}>
        {best && (
          <Button variant="primary" onClick={() => onChange(clearKey(filters, best.key))}>
            Убрать «{bestLabel}»
          </Button>
        )}
        <Button
          variant={best ? 'secondary' : 'primary'}
          icon={<PlusIcon size={20} weight="bold" aria-hidden />}
          to={createHref(filters, me)}
        >
          Создать своё
        </Button>
        <Button variant="quiet" onClick={() => onChange({ ...EMPTY_FILTERS })}>
          Сбросить всё
        </Button>
      </div>
    </div>
  );
}
