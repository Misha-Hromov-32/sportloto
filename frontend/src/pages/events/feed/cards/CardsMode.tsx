import {
  FunnelSimpleIcon,
  HeartIcon,
  ListBulletsIcon,
  PlusIcon,
  SignInIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useDataProvider } from '@refinedev/core';
import { App, Drawer } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button, EmptyState, ErrorState, SkeletonBlock, SwipeDeck, type SwipeResult } from '@/components';
import {
  createDeck,
  drop,
  isDone,
  keysWith,
  type DeckState,
  type SwipeDir,
} from '@/components/SwipeDeck/deck';
import { ENGAGEMENT_API, errorMessage, useAction } from '@/lib/api';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { EventDetails, EventView, Identity } from '@/types/api';
import type { District, EventState, ParticipationStatus } from '@/types/domain';

import type { FeedFilters } from '../filters';
import type { EventOrder } from '../ranking';
import { NothingFound } from '../Results';
import styles from './CardsMode.module.css';
import { CardsSummary } from './CardsSummary';
import { JOINED_TEXT } from './cardsText';
import { loadDeck, saveDeck, setGuestSaved } from './deckStore';
import { EventSwipeCard } from './EventSwipeCard';
import { JoinPanel } from './JoinPanel';
import { fitsDeck, useDeckEvents } from './useDeckEvents';

interface CardsModeProps {
  results: boolean;
  filters: FeedFilters;
  order: EventOrder;
  onChange: (next: FeedFilters) => void;
  districts: District[];
  sportName: (id: string) => string;
  me: Identity | null;
  activeFilters: number;
  filtersPanel: ReactNode;
  createTo: string;
  onExit: () => void;
}

function goneText(title: string, state: EventState): string {
  switch (state) {
    case 'cancelled':
      return `Встречу «${title}» отменили`;
    case 'removed':
      return `Встречу «${title}» сняли с публикации`;
    case 'deleted':
      return `Встречу «${title}» удалили`;
    default:
      return `Встреча «${title}» уже началась, запись закрыта`;
  }
}

const getKey = (e: EventView) => e.id;
const itemLabel = (e: EventView) => e.title;
const compositionGate = (e: EventView) => Boolean(e.composition && e.composition !== 'mixed');

/** Режим «По одной»: те же события, что в списке, по одной карточке. Вправо — в избранное, влево — мимо. */
export function CardsMode({
  results,
  filters,
  order,
  onChange,
  districts,
  sportName,
  me,
  activeFilters,
  filtersPanel,
  createTo,
  onExit,
}: CardsModeProps) {
  const city = useSelectedCity();
  const { message } = App.useApp();
  const { run } = useAction();
  const getDataProvider = useDataProvider();
  const data = useDeckEvents({ results, filters, order, districts, me });
  const admin = me?.role === 'admin';

  const signature = JSON.stringify([city.id, results, filters, order]);
  const [deck, setDeck] = useState<{ signature: string; state: DeckState } | null>(() => {
    const stored = loadDeck(signature);
    return stored ? { signature, state: stored } : null;
  });
  const state = deck?.signature === signature ? deck.state : null;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [joinFor, setJoinFor] = useState<EventView | null>(null);
  const [notice, setNotice] = useState('');
  const joinResolve = useRef<((r: SwipeResult) => void) | null>(null);
  const addedFavorites = useRef(new Set<string>());
  const checked = useRef(new Set<string>());
  const known = useRef(new Map<string, EventView>());
  const [fetched, setFetched] = useState<ReadonlyMap<string, EventView>>(() => new Map());

  const fresh = useMemo(() => new Map(data.events.map((e) => [e.id, e])), [data.events]);
  fresh.forEach((e, id) => known.current.set(id, e));
  const fitting = data.events.filter(fitsDeck);
  const freshKey = data.events.map((e) => `${e.id}:${e.state}:${e.my?.status ?? ''}:${e.isOrganizer}`).join();

  const update = useCallback(
    (fn: (s: DeckState) => DeckState) =>
      setDeck((d) => (d && d.signature === signature ? { ...d, state: fn(d.state) } : d)),
    [signature],
  );

  const restart = useCallback(() => {
    checked.current.clear();
    setDeck({ signature, state: createDeck(fitting.map((e) => e.id)) });
    // fitting пересчитывается каждый раз из свежих данных
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, freshKey]);

  useEffect(() => {
    if (data.isLoading || data.isError) return;
    if (!state) {
      const stored = loadDeck(signature);
      setDeck({ signature, state: stored ?? createDeck(fitting.map((e) => e.id)) });
    } else if (state.order.length === 0 && fitting.length > 0) restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, signature, data.isLoading, data.isError, freshKey]);

  useEffect(() => {
    if (deck) saveDeck(deck.signature, deck.state);
  }, [deck]);

  // Новая страница дополняет стопку, сохраняя уже сделанные выборы и текущую позицию.
  useEffect(() => {
    if (!state || data.isLoading || data.isError) return;
    const knownIds = new Set(state.order);
    const added = fitting.map((event) => event.id).filter((id) => !knownIds.has(id));
    if (added.length) update((current) => ({ ...current, order: [...current.order, ...added] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshKey, state?.order.length, data.isLoading, data.isError]);

  // После входа или записи в другой вкладке неподходящие карточки уходят из стопки молча
  useEffect(() => {
    if (!state || data.isLoading) return;
    const stale = state.order
      .slice(state.index + 1)
      .filter((id) => fresh.get(id)?.state === 'upcoming' && !fitsDeck(fresh.get(id)!));
    if (stale.length) update((s) => drop(s, stale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshKey, state?.index]);

  // Живые обновления: карточка пропала из выдачи — узнаём почему; отменённые и снятые убираем с сообщением
  useEffect(() => {
    if (!state || data.isLoading || data.isError) return;
    state.order.forEach((id) => fresh.has(id) && checked.current.delete(id));
    // Сохранённая до пагинации стопка может содержать тысячи ID. Проверяем только видимые
    // карточки и последнюю для «Вернуть», остальные получим при продвижении по стопке.
    const visibleIds = new Set([
      ...state.order.slice(state.index, state.index + 3),
      ...(state.last ? [state.last.key] : []),
    ]);
    const missing = [...visibleIds].filter((id) => !fresh.has(id) && !checked.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => checked.current.add(id));
    const dp = getDataProvider();
    void Promise.all(
      missing.map(async (id) => {
        const title = known.current.get(id)?.title ?? 'без названия';
        try {
          const res = await dp.getOne<EventDetails>({ resource: 'events', id });
          return { id, title: res.data.title, state: res.data.state, event: res.data as EventView };
        } catch {
          return { id, title, state: 'deleted' as EventState, event: null };
        }
      }),
    ).then((found) => {
      const kept = found.filter((f) => f.state === 'upcoming' && f.event && !known.current.has(f.id));
      if (kept.length)
        setFetched((prev) => new Map([...prev, ...kept.map((f) => [f.id, f.event!] as const)]));
      const gone = found.filter((f) => f.state !== 'upcoming');
      if (!gone.length) return;
      update((s) =>
        drop(
          s,
          gone.map((g) => g.id),
        ),
      );
      const text = gone.map((g) => goneText(g.title, g.state)).join('. ');
      message.info(text);
      setNotice(text);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshKey, data.isLoading, data.isError, state?.order.length, state?.index]);

  const items = useMemo(
    () =>
      (state?.order ?? [])
        .map((id) => fresh.get(id) ?? known.current.get(id) ?? fetched.get(id))
        .filter((e): e is EventView => e !== undefined),
    [state?.order, fresh, fetched],
  );

  const setFavorite = (id: string, on: boolean) =>
    run(ENGAGEMENT_API.favorite(id), {}, { method: on ? 'put' : 'delete', silent: true });

  const onAction = async (e: EventView, dir: SwipeDir): Promise<SwipeResult> => {
    if (dir === 'left') return;
    if (dir === 'up') {
      return new Promise<SwipeResult>((resolve) => {
        joinResolve.current = resolve;
        setJoinFor(e);
      });
    }
    if (!me) {
      setGuestSaved(e.id, true);
      return;
    }
    if (e.favorite) return;
    try {
      await setFavorite(e.id, true);
      addedFavorites.current.add(e.id);
    } catch (error) {
      message.error(errorMessage(error, `Не удалось сохранить «${e.title}». Попробуйте ещё раз`));
      return false;
    }
  };

  const onUndo = (e: EventView, dir: SwipeDir) => {
    if (dir !== 'right') return;
    if (!me) {
      setGuestSaved(e.id, false);
      return;
    }
    if (!addedFavorites.current.has(e.id)) return;
    addedFavorites.current.delete(e.id);
    setFavorite(e.id, false).catch((error) =>
      message.error(errorMessage(error, `Не удалось убрать «${e.title}» из избранного`)),
    );
  };

  const closeJoin = () => {
    setJoinFor(null);
    joinResolve.current?.(false);
    joinResolve.current = null;
  };

  const onJoined = useCallback((status: ParticipationStatus) => {
    const text = JOINED_TEXT[status] ?? 'Вы записаны';
    setJoinFor(null);
    joinResolve.current?.({ stamp: text, announce: text });
    joinResolve.current = null;
  }, []);

  const toolbar = (
    <>
      <Button variant="secondary" size="sm" icon={<ListBulletsIcon size={18} aria-hidden />} onClick={onExit}>
        Списком
      </Button>
      <Button
        variant="secondary"
        size="sm"
        icon={<FunnelSimpleIcon size={18} aria-hidden />}
        onClick={() => setFiltersOpen(true)}
        aria-haspopup="dialog"
      >
        {activeFilters ? `Фильтры: ${activeFilters}` : 'Фильтры'}
      </Button>
    </>
  );

  let body: ReactNode;
  if (data.isError && !state) {
    body = (
      <ErrorState onRetry={data.refetch}>
        Не удалось загрузить события. Проверьте интернет и нажмите «Повторить».
      </ErrorState>
    );
  } else if (!state) {
    body = (
      <div className={styles.loading} role="status">
        <span className="sr-only">Загружаем события…</span>
        <SkeletonBlock height="100%" radius="card" />
      </div>
    );
  } else if ((state.order.length === 0 || isDone(state)) && data.hasMore) {
    body = (
      <EmptyState
        title="Продолжим смотреть встречи?"
        actions={
          <Button variant="primary" loading={data.loadingMore} onClick={data.loadMore}>
            Показать ещё
          </Button>
        }
      >
        Следующая порция встреч появится после нажатия. Ваши выборы сохранятся.
      </EmptyState>
    );
  } else if (state.order.length === 0) {
    body =
      data.events.length === 0 ? (
        results ? (
          <NothingFound
            filters={filters}
            onChange={onChange}
            districts={districts}
            sportName={sportName}
            me={me}
          />
        ) : (
          <EmptyState
            title="Событий пока нет"
            actions={
              <Button variant="primary" icon={<PlusIcon size={20} weight="bold" aria-hidden />} to={createTo}>
                Создать встречу
              </Button>
            }
          >
            В вашем городе пока никто не собирает встречи. Создайте свою: другие увидят её в ленте.
          </EmptyState>
        )
      ) : (
        <EmptyState
          title="Всё подходящее уже у вас в записях"
          actions={
            <Button variant="secondary" icon={<ListBulletsIcon size={20} aria-hidden />} onClick={onExit}>
              Показать списком
            </Button>
          }
        >
          Свои встречи и те, куда вы записались или подали заявку, в стопку не попадают. Попробуйте другие
          фильтры.
        </EmptyState>
      );
  } else if (isDone(state)) {
    const saved = keysWith(state, 'right')
      .map((id) => fresh.get(id) ?? known.current.get(id))
      .filter((e): e is EventView => e !== undefined);
    body = (
      <CardsSummary
        total={state.order.length}
        saved={saved}
        joined={keysWith(state, 'up').length}
        guest={!me}
        createTo={createTo}
        onJoin={setJoinFor}
        onRestart={restart}
        onFilters={() => setFiltersOpen(true)}
        onList={onExit}
      />
    );
  }

  return (
    <>
      {state && body === undefined ? (
        <SwipeDeck<EventView>
          items={items}
          getKey={getKey}
          itemLabel={itemLabel}
          state={state}
          onStateChange={update}
          label="События по одной"
          toolbar={toolbar}
          onExit={onExit}
          exitLabel="Списком"
          notice={notice}
          renderCard={(e, ctx) => <EventSwipeCard event={e} expanded={ctx.expanded} onToggle={ctx.toggle} />}
          actions={{
            left: {
              label: 'Мимо',
              stamp: 'Мимо',
              icon: <XIcon size={26} weight="bold" />,
              announce: 'Пропущено',
            },
            right: {
              label: 'Хочу пойти',
              stamp: 'Беру',
              icon: <HeartIcon size={30} weight="fill" />,
              announce: me ? 'Сохранено в избранном' : 'Отложено',
              disabled: () => (admin ? 'Администратор не добавляет события в избранное' : null),
            },
            up: {
              label: 'Записаться',
              stamp: 'Вы записаны',
              icon: me ? undefined : <SignInIcon size={20} aria-hidden />,
              announce: 'Вы записаны',
              optimistic: false,
              disabled: (e) =>
                admin
                  ? 'Администратор не записывается на события'
                  : !e.can.join && !compositionGate(e)
                    ? e.can.joinReason || null
                    : null,
            },
          }}
          onAction={onAction}
          onUndo={onUndo}
          undoHint={(dir) =>
            dir === 'up' ? '«Вернуть» не отменяет запись. Отменить её можно на странице события.' : undefined
          }
        />
      ) : (
        <div className={styles.mode} data-motion="off">
          <div className={styles.bar}>{toolbar}</div>
          {body}
        </div>
      )}
      <JoinPanel event={joinFor} onClose={closeJoin} onJoined={onJoined} />
      <FiltersDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)}>
        {filtersPanel}
      </FiltersDrawer>
    </>
  );
}

function FiltersDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="bottom"
      height="auto"
      title="Фильтры"
      className={styles.drawer}
      footer={
        <div className={styles.drawerFoot}>
          <Button variant="primary" block onClick={onClose}>
            Готово
          </Button>
        </div>
      }
    >
      <div className={styles.filters}>{children}</div>
    </Drawer>
  );
}
