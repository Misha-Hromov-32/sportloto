import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  FunnelSimpleIcon,
  HandWavingIcon,
  ListBulletsIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  SignInIcon,
  XIcon,
} from '@phosphor-icons/react';
import { App, Drawer } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import {
  Button,
  EmptyState,
  ErrorState,
  SkeletonBlock,
  SportIcon,
  SwipeDeck,
  type SwipeResult,
} from '@/components';
import {
  createDeck,
  drop,
  isDone,
  keysWith,
  type DeckState,
  type SwipeDir,
} from '@/components/SwipeDeck/deck';
import { errorMessage, useMetoo } from '@/lib/api';
import { count, WORDS } from '@/lib/plural';
import type { CompanionView, Identity } from '@/types/api';

import feed from '../../events/feed/cards/CardsMode.module.css';
import { InviteModal } from '../parts/InviteModal';
import styles from './CompanionsCards.module.css';
import { CompanionSwipeCard } from './CompanionSwipeCard';

const DECK_KEY = 'sportitochka.deck.companions';
const ANNOUNCEMENT = ['объявление', 'объявления', 'объявлений'] as const;

function loadDeck(signature: string): DeckState | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DECK_KEY) ?? 'null') as {
      signature: string;
      deck: DeckState;
    } | null;
    return saved?.signature === signature && Array.isArray(saved.deck?.order) ? saved.deck : null;
  } catch {
    return null;
  }
}

function saveDeck(signature: string, deck: DeckState) {
  try {
    sessionStorage.setItem(DECK_KEY, JSON.stringify({ signature, deck }));
  } catch {
    /* хранилище недоступно: позиция живёт до перезагрузки */
  }
}

/** В стопку — открытые чужие объявления, на которые человек ещё не откликнулся. */
const fitsDeck = (c: CompanionView) => c.status === 'open' && !c.isMine && !c.iMetoo;
const getKey = (c: CompanionView) => c.id;
const itemLabel = (c: CompanionView) => `${c.sport.name}: ${c.author.name}`;

interface CompanionsCardsProps {
  items: CompanionView[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** Город и фильтры: при их смене стопка собирается заново. */
  signature: string;
  me: Identity | null;
  isAdmin: boolean;
  activeFilters: number;
  filtersPanel: ReactNode;
  newTo: string;
  onExit: () => void;
}

/**
 * «Ищу компанию» по одной: вправо — «Я тоже» (отклик, автор получит уведомление), влево — мимо,
 * вверх — позвать на свою встречу. «Вернуть» снимает отклик, сделанный из стопки.
 */
export function CompanionsCards({
  items: all,
  isLoading,
  isError,
  refetch,
  signature,
  me,
  isAdmin,
  activeFilters,
  filtersPanel,
  newTo,
  onExit,
}: CompanionsCardsProps) {
  const { message } = App.useApp();
  const metoo = useMetoo();
  const [deck, setDeck] = useState<{ signature: string; state: DeckState } | null>(() => {
    const stored = loadDeck(signature);
    return stored ? { signature, state: stored } : null;
  });
  const state = deck?.signature === signature ? deck.state : null;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [inviteFor, setInviteFor] = useState<CompanionView | null>(null);
  const [notice, setNotice] = useState('');
  const inviteResolve = useRef<((r: SwipeResult) => void) | null>(null);
  const added = useRef(new Set<string>());
  const known = useRef(new Map<string, CompanionView>());

  const fresh = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);
  fresh.forEach((c, id) => known.current.set(id, c));
  const fitting = all.filter(fitsDeck);
  const freshKey = all.map((c) => `${c.id}:${c.status}:${c.iMetoo}:${c.isMine}`).join();

  const update = useCallback(
    (fn: (s: DeckState) => DeckState) =>
      setDeck((d) => (d && d.signature === signature ? { ...d, state: fn(d.state) } : d)),
    [signature],
  );

  const restart = useCallback(() => {
    added.current.clear();
    setDeck({ signature, state: createDeck(fitting.map((c) => c.id)) });
    // fitting пересчитывается каждый раз из свежих данных
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, freshKey]);

  useEffect(() => {
    if (isLoading || isError) return;
    if (!state) setDeck({ signature, state: loadDeck(signature) ?? createDeck(fitting.map((c) => c.id)) });
    else if (state.order.length === 0 && fitting.length > 0) restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, signature, isLoading, isError, freshKey]);

  useEffect(() => {
    if (deck) saveDeck(deck.signature, deck.state);
  }, [deck]);

  // Живые обновления: ещё не просмотренные объявления, которые закрыли или которые больше не подходят, уходят
  useEffect(() => {
    if (!state || isLoading || isError) return;
    // Верхнюю карточку не трогаем: её отклик мог уже прийти, пока она улетает
    const ahead = state.order.slice(state.index + 1);
    const closed = ahead.filter((id) => !fresh.has(id) || fresh.get(id)?.status !== 'open');
    const stale = ahead.filter((id) => {
      const c = fresh.get(id);
      return c !== undefined && c.status === 'open' && !fitsDeck(c);
    });
    if (!closed.length && !stale.length) return;
    update((s) => drop(s, [...closed, ...stale]));
    if (closed.length) {
      const names = closed.map((id) => known.current.get(id)?.author.name).filter(Boolean);
      const text =
        closed.length === 1
          ? `${names[0] ?? 'Автор'} закрыл(а) объявление, оно ушло из стопки`
          : `Закрыли ${count(closed.length, ANNOUNCEMENT)}, они ушли из стопки`;
      message.info(text);
      setNotice(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshKey, isLoading, isError, state?.order.length]);

  const items = useMemo(
    () =>
      (state?.order ?? [])
        .map((id) => fresh.get(id) ?? known.current.get(id))
        .filter((c): c is CompanionView => c !== undefined),
    [state?.order, fresh],
  );

  const onAction = async (c: CompanionView, dir: SwipeDir): Promise<SwipeResult> => {
    if (dir === 'left') return;
    if (dir === 'up') {
      return new Promise<SwipeResult>((resolve) => {
        inviteResolve.current = resolve;
        setInviteFor(c);
      });
    }
    if (!me || c.iMetoo) return;
    try {
      await metoo.add(c.id, { silent: true });
      added.current.add(c.id);
    } catch (error) {
      message.error(errorMessage(error, 'Не получилось откликнуться. Попробуйте ещё раз'));
      return false;
    }
  };

  const onUndo = (c: CompanionView, dir: SwipeDir) => {
    if (dir !== 'right' || !added.current.has(c.id)) return;
    added.current.delete(c.id);
    metoo
      .remove(c.id, { silent: true, success: 'Отклик снят' })
      .catch((error) => message.error(errorMessage(error, 'Не получилось снять отклик')));
  };

  const closeInvite = () => {
    setInviteFor(null);
    inviteResolve.current?.(false);
    inviteResolve.current = null;
  };

  const onInvited = () => {
    setInviteFor(null);
    inviteResolve.current?.({ stamp: 'Позвали', announce: 'Приглашение отправлено' });
    inviteResolve.current = null;
  };

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
  if (isError && !state) {
    body = (
      <ErrorState onRetry={refetch}>
        Не удалось загрузить объявления. Проверьте интернет и нажмите «Повторить».
      </ErrorState>
    );
  } else if (!state) {
    body = (
      <div className={feed.loading} role="status">
        <span className="sr-only">Загружаем объявления…</span>
        <SkeletonBlock height="100%" radius="card" />
      </div>
    );
  } else if (state.order.length === 0) {
    body = (
      <EmptyState
        title={all.length === 0 ? 'Объявлений пока нет' : 'Новых объявлений нет'}
        actions={
          <>
            {!isAdmin && (
              <Button variant="primary" icon={<PlusIcon size={20} weight="bold" aria-hidden />} to={newTo}>
                Написать объявление
              </Button>
            )}
            <Button variant="secondary" icon={<ListBulletsIcon size={20} aria-hidden />} onClick={onExit}>
              Показать списком
            </Button>
          </>
        }
      >
        {all.length === 0
          ? 'По этим условиям никто не ищет компанию. Попробуйте другие фильтры или напишите своё объявление.'
          : 'На все подходящие объявления вы уже откликнулись. Свои объявления в стопку не попадают.'}
      </EmptyState>
    );
  } else if (isDone(state)) {
    body = (
      <Summary
        total={state.order.length}
        liked={keysWith(state, 'right')
          .map((id) => fresh.get(id) ?? known.current.get(id))
          .filter((c): c is CompanionView => c !== undefined)}
        invited={keysWith(state, 'up').length}
        me={me}
        isAdmin={isAdmin}
        newTo={newTo}
        onRestart={restart}
        onFilters={() => setFiltersOpen(true)}
        onList={onExit}
      />
    );
  }

  return (
    <>
      {state && body === undefined ? (
        <SwipeDeck<CompanionView>
          items={items}
          getKey={getKey}
          itemLabel={itemLabel}
          state={state}
          onStateChange={update}
          label="Ищу компанию: режим Тиндера"
          toolbar={toolbar}
          onExit={onExit}
          exitLabel="Списком"
          notice={notice}
          renderCard={(c, ctx) => (
            <CompanionSwipeCard companion={c} expanded={ctx.expanded} onToggle={ctx.toggle} />
          )}
          actions={{
            left: {
              label: 'Мимо',
              stamp: 'Мимо',
              icon: <XIcon size={26} weight="bold" />,
              announce: 'Пропущено',
            },
            right: {
              label: 'Я тоже',
              stamp: 'Я тоже',
              icon: <HandWavingIcon size={30} weight="fill" />,
              announce: me ? 'Отклик отправлен, автор получит уведомление' : 'Отложено',
              disabled: () => (isAdmin ? 'Администратор не откликается на объявления' : null),
            },
            up: {
              label: 'Позвать на встречу',
              stamp: 'Позвали',
              icon: <PaperPlaneTiltIcon size={20} aria-hidden />,
              announce: 'Приглашение отправлено',
              optimistic: false,
              disabled: () =>
                isAdmin
                  ? 'Администратор не зовёт на встречи'
                  : !me
                    ? 'Позвать на встречу можно после входа'
                    : null,
            },
          }}
          onAction={onAction}
          onUndo={onUndo}
          undoHint={(dir) =>
            dir === 'up' ? '«Вернуть» не отменяет приглашение: оно уже отправлено.' : undefined
          }
        />
      ) : (
        <div className={feed.mode} data-motion="off">
          <div className={feed.bar}>{toolbar}</div>
          {body}
        </div>
      )}
      <InviteModal companion={inviteFor} onClose={closeInvite} onSent={onInvited} />
      <Drawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        placement="bottom"
        height="auto"
        title="Фильтры"
        className={feed.drawer}
        footer={
          <div className={feed.drawerFoot}>
            <Button variant="primary" block onClick={() => setFiltersOpen(false)}>
              Готово
            </Button>
          </div>
        }
      >
        <div className={feed.filters}>{filtersPanel}</div>
      </Drawer>
    </>
  );
}

interface SummaryProps {
  total: number;
  liked: CompanionView[];
  invited: number;
  me: Identity | null;
  isAdmin: boolean;
  newTo: string;
  onRestart: () => void;
  onFilters: () => void;
  onList: () => void;
}

/** Итог: на что откликнулись (гость — что отложил и может отправить после входа), что дальше. */
function Summary({ total, liked, invited, me, isAdmin, newTo, onRestart, onFilters, onList }: SummaryProps) {
  const location = useLocation();
  const metoo = useMetoo();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus({ preventScroll: true });
  }, []);
  const back = `${location.pathname}${location.search}`;
  const title =
    total === 1 ? 'Вы посмотрели единственное объявление' : `Вы посмотрели все ${count(total, ANNOUNCEMENT)}`;

  return (
    <section className={feed.summary} aria-labelledby="companions-summary-title" data-motion="off">
      <h2 ref={headingRef} id="companions-summary-title" className={feed.summaryTitle} tabIndex={-1}>
        {title}
      </h2>
      {invited > 0 && (
        <p className={feed.summaryText}>
          Вы позвали на свои встречи: {count(invited, WORDS.person)}. Ответ придёт в{' '}
          <Link to="/notifications">уведомлениях</Link>.
        </p>
      )}

      {liked.length > 0 ? (
        <>
          <h3 className={feed.savedTitle}>
            {me ? `Понравились: ${liked.length}` : `Отложено: ${liked.length}`}
          </h3>
          {!me && (
            <div className={feed.guestNote}>
              <p>
                Отложенные объявления сохраняются только в этой вкладке. Чтобы откликнуться и уведомить
                автора, войдите в аккаунт.
              </p>
              <Button
                variant="primary"
                icon={<SignInIcon size={20} aria-hidden />}
                to={`/login?to=${encodeURIComponent(back)}`}
              >
                Войти или присоединиться
              </Button>
            </div>
          )}
          <ul className={feed.savedList}>
            {liked.map((c) => (
              <li key={c.id} className={feed.savedItem}>
                <span className={styles.savedIcon} aria-hidden>
                  <SportIcon sport={c.sport} size={24} />
                </span>
                <span className={feed.savedBody}>
                  <Link to={`/profile/${c.author.id}`} className={feed.savedName}>
                    {c.author.name}
                  </Link>
                  <span className={feed.savedWhen}>
                    {c.sport.name} · {c.when}
                  </span>
                </span>
                {c.iMetoo ? (
                  <span className={styles.metooTag}>
                    <CheckIcon size={16} weight="bold" aria-hidden />
                    Вы откликнулись
                  </span>
                ) : me && !isAdmin && c.status === 'open' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={metoo.isPending}
                    onClick={() =>
                      void metoo.add(c.id, { success: 'Отклик отправлен' }).catch(() => undefined)
                    }
                  >
                    Я тоже
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className={feed.nothing}>
          <p className={feed.summaryText}>
            Никто не подошёл? Напишите своё объявление: люди рядом увидят его и откликнутся.
          </p>
          {!isAdmin && (
            <Button variant="primary" icon={<PlusIcon size={20} weight="bold" aria-hidden />} to={newTo}>
              Написать объявление
            </Button>
          )}
        </div>
      )}

      <div className={feed.summaryActions}>
        <Button
          variant="secondary"
          icon={<ArrowCounterClockwiseIcon size={20} aria-hidden />}
          onClick={onRestart}
        >
          Начать заново
        </Button>
        <Button variant="secondary" icon={<FunnelSimpleIcon size={20} aria-hidden />} onClick={onFilters}>
          Изменить фильтры
        </Button>
        <Button variant="secondary" icon={<ListBulletsIcon size={20} aria-hidden />} onClick={onList}>
          Показать списком
        </Button>
      </div>
    </section>
  );
}
