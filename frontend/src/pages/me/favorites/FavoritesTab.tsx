import {
  ArrowUpRightIcon,
  BellRingingIcon,
  BookmarkSimpleIcon,
  HeartIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { App } from 'antd';
import { useState, type ReactNode } from 'react';

import { Avatar, Button, EmptyState, ErrorState, SkeletonBlock } from '@/components';
import { ENGAGEMENT_API, useAction, useLiveGet } from '@/lib/api';
import { EVENT_STATE } from '@/lib/labels';
import { plural } from '@/lib/plural';
import type { EventView } from '@/types/api';
import type { FavoritesView, FollowView, SavedSearchView } from '@/types/engagement';

import { participantStatus, type RowStatus } from '../parts/groups';
import { MyEventRow } from '../parts/MyEventRow';
import styles from './favorites.module.css';

const MEETINGS = ['встреча', 'встречи', 'встреч'] as const;
const EVENTS = ['событие', 'события', 'событий'] as const;

/** Вкладка «Избранное» в «Моих занятиях»: сохранённые события, подписки и поиски. */
export function FavoritesTab() {
  const { data, isLoading, isError, refetch } = useLiveGet<FavoritesView>(ENGAGEMENT_API.favorites, [
    'events',
    'participations',
    'organizations',
    'users',
  ]);

  if (isLoading)
    return (
      <div className={styles.skeleton} role="status">
        <span className="sr-only">Загружаем избранное…</span>
        <SkeletonBlock width={180} height={24} />
        <SkeletonBlock height={96} />
        <SkeletonBlock height={96} />
      </div>
    );
  if (isError || !data)
    return (
      <ErrorState onRetry={() => void refetch()}>
        Не удалось загрузить избранное. Проверьте интернет и нажмите «Повторить».
      </ErrorState>
    );

  if (!data.events.length && !data.follows.length && !data.searches.length)
    return (
      <EmptyState
        title="Вы пока ничего не сохранили"
        icon={<HeartIcon size={28} aria-hidden />}
        actions={
          <Button variant="primary" to="/events" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
            Найти встречу
          </Button>
        }
      >
        Нажмите сердечко на карточке события, и оно появится здесь.
      </EmptyState>
    );

  return (
    <div className={styles.tab}>
      <EventsBlock events={data.events} />
      {/* Подписки и сохранённые поиски в интерфейсе не создаются: блоки видны, только когда есть что убрать. */}
      {data.follows.length > 0 && <FollowsBlock follows={data.follows} />}
      {data.searches.length > 0 && <SearchesBlock searches={data.searches} />}
    </div>
  );
}

function BlockTitle({
  id,
  icon,
  title,
  count,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  count: number;
}) {
  return (
    <h2 id={id} className={styles.blockTitle}>
      {icon}
      {title}
      <span className={styles.blockCount}>{count}</span>
    </h2>
  );
}

function rowStatus(e: EventView): RowStatus {
  if (e.my && e.my.status !== 'cancelled') return participantStatus(e);
  return { meta: EVENT_STATE[e.state], detail: null, changes: [], action: { kind: 'open' } };
}

function EventsBlock({ events }: { events: EventView[] }) {
  const { run } = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  const remove = async (e: EventView) => {
    setBusy(e.id);
    try {
      await run(ENGAGEMENT_API.favorite(e.id), {}, { method: 'delete', success: 'Убрано из избранного' });
    } catch {
      /* текст ошибки уже показан */
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className={styles.block} aria-labelledby="fav-events">
      <BlockTitle
        id="fav-events"
        icon={<HeartIcon size={22} aria-hidden />}
        title="События"
        count={events.length}
      />
      {events.length === 0 ? (
        <p className={styles.blockEmpty}>
          Нажмите сердечко на карточке события, чтобы вернуться к нему позже.
        </p>
      ) : (
        <ul className={styles.rows}>
          {events.map((e) => (
            <MyEventRow
              key={e.id}
              event={e}
              variant="history"
              status={rowStatus(e)}
              caption={e.organizerView.name}
              action={
                <>
                  <Button size="sm" variant="secondary" to={`/events/${e.id}`}>
                    Открыть
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    icon={<TrashIcon size={18} aria-hidden />}
                    loading={busy === e.id}
                    loadingText="Убираем…"
                    onClick={() => void remove(e)}
                  >
                    Убрать из избранного
                  </Button>
                </>
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FollowsBlock({ follows }: { follows: FollowView[] }) {
  const { run } = useAction();
  const { modal } = App.useApp();
  const unfollow = (f: FollowView) =>
    modal.confirm({
      title: `Отписаться от «${f.name.replace(/[«»]/g, '')}»?`,
      content: 'Уведомления о новых встречах перестанут приходить.',
      okText: 'Отписаться',
      cancelText: 'Остаться',
      onOk: () =>
        run(
          ENGAGEMENT_API.follow(f.kind, f.id),
          {},
          { method: 'delete', success: 'Подписка отменена' },
        ).catch(() => undefined),
    });
  return (
    <section className={styles.block} aria-labelledby="fav-follows">
      <BlockTitle
        id="fav-follows"
        icon={<BellRingingIcon size={22} aria-hidden />}
        title="Подписки"
        count={follows.length}
      />
      <ul className={styles.cards}>
        {follows.map((f) => (
          <li key={`${f.kind}-${f.id}`} className={styles.card}>
            <Avatar name={f.name} src={f.avatarUrl} size={48} shape={f.kind === 'org' ? 'org' : 'person'} />
            <div className={styles.cardBody}>
              <p className={styles.cardCaption}>{f.caption}</p>
              <p className={styles.cardTitle}>{f.name}</p>
              <p className={styles.cardMeta}>
                {f.upcoming
                  ? `Впереди ${f.upcoming} ${plural(f.upcoming, MEETINGS)}`
                  : 'Новых встреч пока нет'}
              </p>
            </div>
            <div className={styles.cardActions}>
              <Button
                size="sm"
                variant="secondary"
                to={f.link}
                iconAfter={<ArrowUpRightIcon size={16} aria-hidden />}
              >
                Открыть
              </Button>
              <Button size="sm" variant="quiet" onClick={() => unfollow(f)}>
                Отписаться
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SearchesBlock({ searches }: { searches: SavedSearchView[] }) {
  const { run } = useAction();
  const { modal } = App.useApp();
  const remove = (s: SavedSearchView) =>
    modal.confirm({
      title: `Удалить поиск «${s.name}»?`,
      content: 'Уведомления по нему перестанут приходить.',
      okText: 'Удалить поиск',
      okButtonProps: { danger: true },
      cancelText: 'Оставить',
      onOk: () =>
        run(ENGAGEMENT_API.savedSearch(s.id), {}, { method: 'delete', success: 'Поиск удалён' }).catch(
          () => undefined,
        ),
    });
  return (
    <section className={styles.block} aria-labelledby="fav-searches">
      <BlockTitle
        id="fav-searches"
        icon={<BookmarkSimpleIcon size={22} aria-hidden />}
        title="Сохранённые поиски"
        count={searches.length}
      />
      <ul className={styles.cards}>
        {searches.map((s) => (
          <li key={s.id} className={styles.card}>
            <span className={styles.cardIcon} aria-hidden>
              <MagnifyingGlassIcon size={24} />
            </span>
            <div className={styles.cardBody}>
              <p className={styles.cardTitle}>{s.name}</p>
              {s.summary && s.summary !== s.name && <p className={styles.cardCaption}>{s.summary}</p>}
              <p className={styles.cardMeta}>
                {s.matches
                  ? `Сейчас подходит: ${s.matches} ${plural(s.matches, EVENTS)}`
                  : 'Сейчас ничего не подходит'}
              </p>
            </div>
            <div className={styles.cardActions}>
              <Button size="sm" variant="secondary" to={`/events${s.query ? `?${s.query}` : ''}`}>
                Открыть
              </Button>
              <Button
                size="sm"
                variant="quiet"
                icon={<TrashIcon size={18} aria-hidden />}
                onClick={() => remove(s)}
              >
                Удалить
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
