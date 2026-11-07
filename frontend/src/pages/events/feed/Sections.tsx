import { SparkleIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useList, type CrudFilter } from '@refinedev/core';
import { type ReactNode } from 'react';
import { Link } from 'react-router';

import { Avatar, Button, ErrorState, SportIcon } from '@/components';
import { formatDistance } from '@/lib/geo';
import { cityLocationFilters } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import { READINESS } from '@/lib/labels';
import { count, WORDS } from '@/lib/plural';
import { truncate } from '@/lib/text';
import type { CompanionView, EventView, Identity } from '@/types/api';

import styles from './Feed.module.css';
import { CreateCard, FeedCard, FeedCardSkeleton, Tag } from './FeedCard';
import { LazyEventMap } from './LazyMap';
import { isOpenForFeed } from './filters';
import { ViewSwitch, type FeedView } from './ViewSwitch';
import { usePagedEvents } from './usePagedEvents';
import { UrgentBlock } from './urgent/Urgent'; // С3

const eq = (field: string, value: unknown): CrudFilter => ({ field, operator: 'eq', value });

function useEvents(filters: CrudFilter[], enabled = true) {
  const city = useSelectedCity();
  const { result, query } = useList<EventView>({
    resource: 'events',
    filters: [...filters, ...cityLocationFilters(city)],
    pagination: { currentPage: 1, pageSize: 12, mode: 'server' },
    queryOptions: { enabled },
  });
  return { events: (result.data ?? []).filter(isOpenForFeed), total: result.total ?? 0, query };
}

const PAGE = 8;

/** Блок ленты: заголовок, справа — действие. */
export function FeedBlock({
  id,
  title,
  count: n,
  action,
  lead,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  action?: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.block} aria-labelledby={`${id}-title`}>
      <header className={styles.blockHead} data-reveal="">
        <h2 id={`${id}-title`} className={styles.blockTitle}>
          {title}
          {n !== undefined && <span className={styles.blockCount}>{n}</span>}
        </h2>
        {action}
      </header>
      {lead}
      {children}
    </section>
  );
}

export function GridSkeleton({ n = 3 }: { n?: number }) {
  return (
    <div className={styles.grid} role="status" aria-live="polite">
      <span className="sr-only">Загружаем события…</span>
      {Array.from({ length: n }, (_, i) => (
        <FeedCardSkeleton key={i} />
      ))}
    </div>
  );
}

interface SectionsProps {
  me: Identity | null;
  view: FeedView;
  onView: (view: FeedView) => void;
  onWhen: (when: 'today' | 'weekend') => void;
  createTo: string;
}

/** Лента без фильтров: подборка, сегодня, выходные, ищут компанию, все ближайшие. */
export function Sections({ me, view, onView, onWhen, createTo }: SectionsProps) {
  const personal = Boolean(me && me.role !== 'admin');
  const forYou = useEvents([eq('forYou', true)], personal);
  const today = useEvents([eq('when', 'today')]);
  const weekend = useEvents([eq('when', 'weekend')]);
  const all = usePagedEvents([], { pageSize: PAGE });

  if (view === 'map') {
    return (
      <FeedBlock
        id="map"
        title="Все ближайшие на карте"
        count={all.query.isSuccess ? all.total : undefined}
        action={<ViewSwitch value={view} onChange={onView} />}
      >
        <LazyEventMap events={all.events} origin={me?.home ?? null} height={560} />
        <p className={styles.lead}>
          На карте показано {all.events.length} из {all.total} встреч.
        </p>
        {all.hasMore && (
          <Button block loading={all.loadingMore} onClick={all.loadMore}>
            Показать ещё на карте
          </Button>
        )}
      </FeedBlock>
    );
  }

  const forYouItems = forYou.events.slice(0, 3);
  const todayItems = today.events.filter((e) => !forYouItems.some((x) => x.id === e.id)).slice(0, 3);
  const weekendItems = weekend.events
    .filter((e) => ![...forYouItems, ...todayItems].some((x) => x.id === e.id))
    .slice(0, 3);
  const taken = new Set([...forYouItems, ...todayItems, ...weekendItems].map((e) => e.id));
  const rest = all.events.filter((e) => !taken.has(e.id));

  return (
    <div className={styles.sections}>
      <UrgentBlock /> {/* С3 */}
      {personal && (forYou.query.isLoading || forYouItems.length > 0) && (
        <FeedBlock
          id="for-you"
          title="Для вас"
          lead={
            <p className={styles.lead}>
              <SparkleIcon size={18} weight="fill" aria-hidden className={styles.sparkle} />
              Подобрал помощник по вашему профилю. На карточке написано, чем событие подходит.
            </p>
          }
        >
          {forYou.query.isLoading ? <GridSkeleton /> : <EventGrid events={forYouItems} showMatch />}
        </FeedBlock>
      )}
      <FeedBlock
        id="today"
        title="Сегодня"
        count={today.query.isSuccess ? today.total : undefined}
        action={
          today.total > todayItems.length && (
            <MoreLink onClick={() => onWhen('today')}>Все на сегодня</MoreLink>
          )
        }
      >
        <BlockBody
          query={today.query}
          items={todayItems}
          empty={
            today.events.length
              ? 'Сегодняшние события уже показаны выше.'
              : 'На сегодня событий больше нет. Загляните в выходные или в общий список ниже.'
          }
        />
      </FeedBlock>
      <FeedBlock
        id="weekend"
        title="На выходных"
        count={weekend.query.isSuccess ? weekend.total : undefined}
        action={
          weekend.events.length > 0 && <MoreLink onClick={() => onWhen('weekend')}>Все на выходных</MoreLink>
        }
      >
        <BlockBody
          query={weekend.query}
          items={weekendItems}
          empty={
            weekend.events.length
              ? 'События выходных уже показаны выше.'
              : 'На выходные пока ничего не запланировано. Можно создать своё событие.'
          }
        />
      </FeedBlock>
      <CompanionsBlock />
      <FeedBlock
        id="all"
        title="Все ближайшие"
        count={all.query.isSuccess ? all.total : undefined}
        action={<ViewSwitch value={view} onChange={onView} />}
      >
        {all.query.isLoading ? (
          <GridSkeleton />
        ) : all.query.isError ? (
          <ErrorState onRetry={() => void all.query.refetch()}>
            Не удалось загрузить события. Проверьте интернет и нажмите «Повторить».
          </ErrorState>
        ) : (
          <>
            <ul className={styles.grid} data-stagger="">
              {rest.map((e) => (
                <li key={e.id} className={styles.cell}>
                  <FeedCard event={e} />
                </li>
              ))}
              {!all.hasMore && (
                <li className={styles.cell}>
                  <CreateCard to={createTo} />
                </li>
              )}
            </ul>
            {all.hasMore && (
              <Button variant="secondary" size="lg" block loading={all.loadingMore} onClick={all.loadMore}>
                Показать ещё
              </Button>
            )}
          </>
        )}
      </FeedBlock>
    </div>
  );
}

function MoreLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="quiet" onClick={onClick}>
      {children}
    </Button>
  );
}

export function EventGrid({
  events,
  showMatch,
  large,
}: {
  events: EventView[];
  showMatch?: boolean;
  large?: boolean;
}) {
  return (
    <ul className={[styles.grid, large && styles.gridLarge].filter(Boolean).join(' ')}>
      {events.map((e) => (
        <li key={e.id} className={styles.cell}>
          <FeedCard event={e} showMatch={showMatch} large={large} />
        </li>
      ))}
    </ul>
  );
}

function BlockBody({
  query,
  items,
  empty,
}: {
  query: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  items: EventView[];
  empty: string;
}) {
  if (query.isLoading) return <GridSkeleton />;
  if (query.isError)
    return (
      <ErrorState onRetry={() => void query.refetch()}>
        Не удалось загрузить события. Проверьте интернет и нажмите «Повторить».
      </ErrorState>
    );
  if (!items.length) return <p className={styles.quietEmpty}>{empty}</p>;
  return <EventGrid events={items} />;
}

/** «Ищут компанию рядом»: три объявления, ближе всего к профилю, и переход в раздел. */
function CompanionsBlock() {
  const city = useSelectedCity();
  const { result, query } = useList<CompanionView>({
    resource: 'companions',
    filters: [{ field: 'city', operator: 'eq', value: city.name }],
    pagination: { currentPage: 1, pageSize: 3 },
  });
  const items = result.data ?? [];
  return (
    <FeedBlock
      id="companions"
      title="Ищут компанию рядом"
      action={
        <Button variant="quiet" to="/companions">
          Все объявления
        </Button>
      }
    >
      {query.isLoading ? (
        <GridSkeleton />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()}>Не удалось загрузить объявления.</ErrorState>
      ) : items.length === 0 ? (
        <p className={styles.quietEmpty}>
          Пока никто не ищет компанию. <Link to="/companions/new">Напишите, с кем хотите заниматься</Link>.
        </p>
      ) : (
        <ul className={styles.grid} data-stagger="">
          {items.map((c) => (
            <li key={c.id} className={styles.cell}>
              <Link to="/companions" className={styles.companion}>
                <span className={styles.companionTags}>
                  <Tag tone="plain" icon={<SportIcon sport={c.sport} size={16} />}>
                    {c.sport.name}
                  </Tag>
                  <Tag tone={c.readiness === 'organize' ? 'dark' : 'plain'}>
                    {READINESS[c.readiness].label}
                  </Tag>
                </span>
                <span className={styles.companionWhen}>{c.when}</span>
                <span className={styles.companionText}>{truncate(c.text, 120)}</span>
                {c.matchReasons.length > 0 && (
                  <span className={styles.companionMatch}>
                    <SparkleIcon size={16} weight="fill" aria-hidden />
                    {c.matchReasons.join(', ')}
                  </span>
                )}
                <span className={styles.companionFoot}>
                  <Avatar
                    name={c.author.name}
                    initials={c.author.initials}
                    src={c.author.avatarUrl}
                    size={32}
                  />
                  <span className={styles.companionWho}>
                    {c.author.name}
                    <span className={styles.companionMeta}>
                      {[c.districtName, c.distanceKm !== null ? formatDistance(c.distanceKm) : null]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </span>
                  {c.metooCount > 0 && (
                    <span className={styles.companionMetoo}>
                      <UsersThreeIcon size={16} aria-hidden />
                      {count(c.metooCount, WORDS.response)}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </FeedBlock>
  );
}
