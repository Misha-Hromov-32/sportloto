import { ListBulletsIcon, MapTrifoldIcon } from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { Button, ErrorState } from '@/components';
import { useLiveRefetch } from '@/lib/api';
import { cityLocationFilters } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { SportView, VenueView } from '@/types/api';
import type { District } from '@/types/domain';

import { LazyVenueMap } from '../../venues/parts/LazyVenueMap';
import { VenueCard } from '../../venues/parts/VenueCard';
import feedStyles from '../feed/Feed.module.css';
import { FeedBlock, GridSkeleton } from '../feed/Sections';
import { ViewSwitch, type FeedView } from '../feed/ViewSwitch';
import {
  dateWord,
  EMPTY_VENUE_FILTERS,
  hasVenueFilters,
  readVenueFilters,
  toVenueCrudFilters,
  writeVenueFilters,
  type VenueFilters as Filters,
} from './filters';
import { VenueFilters } from './VenueFilters';
import styles from './VenuesMode.module.css';

const plural = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'площадка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'площадки';
  return 'площадок';
};

/** Третий режим ленты: площадки города со свободными окнами, списком или на карте. */
export function VenuesMode({ onView }: { onView: (view: FeedView) => void }) {
  const city = useSelectedCity();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readVenueFilters(params), [params]);
  const apply = (next: Filters) => setParams(writeVenueFilters(params, next), { replace: true });

  const sports = useList<SportView>({ resource: 'sports', pagination: { mode: 'off' } }).result.data ?? [];
  const districts =
    useList<District>({
      resource: 'districts',
      filters: cityLocationFilters(city, ''),
      pagination: { mode: 'off' },
    }).result.data ?? [];
  const { result, query } = useList<VenueView>({
    resource: 'venues',
    filters: [...toVenueCrudFilters(filters), ...cityLocationFilters(city, '')],
    pagination: { mode: 'off' },
  });
  useLiveRefetch(['venues', 'organizations'], () => void query.refetch());
  const venues = result.data ?? [];
  const filtered = hasVenueFilters(filters);

  const heading = query.isLoading
    ? 'Ищем площадки…'
    : venues.length
      ? filtered
        ? `Нашлось ${venues.length} ${plural(venues.length)}`
        : 'Площадки для встреч'
      : filtered
        ? 'Ничего не нашлось'
        : 'Площадок пока нет';

  return (
    <>
      <div className={feedStyles.discovery}>
        <div className={feedStyles.discoveryHead}>
          <p className={feedStyles.searchLabel}>
            <MapTrifoldIcon size={18} aria-hidden /> Площадки вашего города
          </p>
          <ViewSwitch value="venues" onChange={onView} />
        </div>
        <VenueFilters filters={filters} onChange={apply} sports={sports} districts={districts} />
      </div>
      <div className={feedStyles.feed}>
        <FeedBlock
          id="venues"
          title={heading}
          count={!filtered && venues.length ? venues.length : undefined}
          action={
            <div className={styles.switches}>
              {venues.length > 0 && (
                <Button
                  variant="quiet"
                  size="sm"
                  icon={
                    filters.map ? (
                      <ListBulletsIcon size={18} aria-hidden />
                    ) : (
                      <MapTrifoldIcon size={18} aria-hidden />
                    )
                  }
                  onClick={() => apply({ ...filters, map: !filters.map })}
                >
                  {filters.map ? 'Показать списком' : 'Показать на карте'}
                </Button>
              )}
              <ViewSwitch value="venues" onChange={onView} />
            </div>
          }
          lead={
            <p className={styles.lead}>
              Свободные окна отмечают сами площадки. Бронирования здесь нет: выберите окно, предложите встречу
              и договоритесь с площадкой по телефону.
            </p>
          }
        >
          <p className="sr-only" aria-live="polite">
            {query.isLoading ? '' : heading}
          </p>
          {query.isLoading ? (
            <GridSkeleton />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()}>
              Не удалось загрузить площадки. Проверьте интернет и нажмите «Повторить».
            </ErrorState>
          ) : venues.length === 0 ? (
            <div className={feedStyles.empty}>
              <h3 className={feedStyles.emptyTitle}>
                {filtered ? 'Под эти условия площадок нет' : `В ${city.in} площадки ещё не добавлены`}
              </h3>
              <p className={feedStyles.emptyText}>
                {filtered
                  ? 'Попробуйте другой день, район или уберите одно из условий. Встречу можно провести и во дворе или парке.'
                  : 'Посмотрите площадки Красноярска или создайте встречу со своим адресом.'}
              </p>
              <div className={feedStyles.emptyActions}>
                {filtered && (
                  <Button
                    variant="primary"
                    onClick={() => apply({ ...EMPTY_VENUE_FILTERS, map: filters.map })}
                  >
                    Сбросить фильтры
                  </Button>
                )}
                <Button variant="secondary" onClick={() => onView('list')}>
                  Вернуться к событиям
                </Button>
              </div>
            </div>
          ) : filters.map ? (
            <LazyVenueMap venues={venues} height={520} />
          ) : (
            <ul className={feedStyles.grid}>
              {venues.map((v) => (
                <li key={v.id} className={feedStyles.cell}>
                  <VenueCard venue={v} dateLabel={dateWord(filters.date)} />
                </li>
              ))}
            </ul>
          )}
        </FeedBlock>
      </div>
    </>
  );
}
