import { ArrowLeftIcon, CheckIcon, ClockIcon, XIcon } from '@phosphor-icons/react';
import { useDataProvider } from '@refinedev/core';
import { App } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button, EmptyState, ErrorState, SkeletonBlock, SwipeDeck, type SwipeResult } from '@/components';
import {
  createDeck,
  currentKey,
  drop,
  keysWith,
  restore,
  undo,
  type DeckState,
  type SwipeDir,
} from '@/components/SwipeDeck/deck';
import { API, errorMessage } from '@/lib/api';
import { formatEventDate } from '@/lib/dates';
import type { OrganizerPendingView, ParticipantView } from '@/types/api';
import type { ParticipationStatus } from '@/types/domain';

import { ApplicantCard } from './ApplicantCard';
import { createDecisionQueue, type Decision, type SendOutcome } from './decisionQueue';
import { ProfileSheet } from './ProfileSheet';
import { RejectSheet, type RejectChoice } from './RejectSheet';
import styles from './review.module.css';
import {
  acceptBlock,
  appendKeys,
  applyDeckUpdate,
  decidedText,
  freeSeats,
  goneText,
  newApplicationText,
  passDone,
  reopenLater,
  seatsLine,
  undecidedKeys,
  type ReviewState,
} from './reviewModel';
import { ReviewSummary } from './ReviewSummary';
import { usePendingApplications } from './usePendingApplications';

type HeldDecision = Decision & { name: string };

interface ReviewDeckProps {
  /** Стопка одного события; без него — все новые заявки организатора. */
  eventId?: string;
  /** Подпись выхода из стопки: «К списку заявок». */
  exitLabel: string;
  /** Подпись выхода на итоговом экране: «Назад к событию», «К событиям». */
  summaryExitLabel: string;
  participantsTo?: string;
  onExit: () => void;
}

/** Заявки по одной: принять, отклонить с причиной, решить позже. Решение уходит через 5 секунд. */
export function ReviewDeck({
  eventId,
  exitLabel,
  summaryExitLabel,
  participantsTo,
  onExit,
}: ReviewDeckProps) {
  const { message } = App.useApp();
  const getDataProvider = useDataProvider();
  const data = usePendingApplications({ eventId });
  const allEvents = !eventId;

  const [review, setReview] = useState<ReviewState | null>(null);
  const [held, setHeld] = useState<HeldDecision | null>(null);
  const [rejectFor, setRejectFor] = useState<{ name: string; resolve: (r: SwipeResult) => void } | null>(
    null,
  );
  const [dontAsk, setDontAsk] = useState(false);
  const [profile, setProfile] = useState<{ id: string; name: string; close: () => void } | null>(null);
  const [notice, setNotice] = useState('');

  const known = useRef(new Map<string, OrganizerPendingView>());
  const dropped = useRef(new Set<string>());
  const checking = useRef(new Set<string>());
  const mounted = useRef(true);

  const live = useMemo(() => new Map(data.items.map((p) => [p.id, p])), [data.items]);
  live.forEach((p, id) => known.current.set(id, p));
  const liveKey = data.items.map((p) => p.id).join();

  const say = useCallback(
    (text: string, kind: 'info' | 'warning' = 'info') => {
      message[kind](text);
      if (mounted.current) setNotice(text);
    },
    [message],
  );

  const settle = useRef<(d: HeldDecision, outcome: SendOutcome) => void>(() => undefined);
  settle.current = (d, outcome) => {
    if (outcome.ok) {
      if (mounted.current)
        setReview((s) => (s && s.deck.last?.key === d.id ? { ...s, deck: { ...s.deck, last: null } } : s));
      return;
    }
    if (outcome.code === 'already_decided') {
      dropped.current.add(d.id);
      if (mounted.current) setReview((s) => (s ? { ...s, deck: drop(s.deck, [d.id]) } : s));
      say(`${d.name}: эту заявку уже рассмотрели`);
      return;
    }
    if (mounted.current) setReview((s) => (s ? { ...s, deck: restore(s.deck, d.id) } : s));
    if (outcome.code === 'full') data.refetch();
    say(
      outcome.code === 'full'
        ? `${d.name}: не хватает мест, заявка снова в стопке`
        : `Не удалось отправить решение: ${d.name}. ${errorMessage(outcome, 'Проверьте интернет')}. Заявка снова в стопке`,
      'warning',
    );
  };

  const queue = useMemo(
    () =>
      createDecisionQueue<HeldDecision>({
        send: (d) =>
          getDataProvider().custom!({
            url: API.decideParticipation(d.id),
            method: 'post',
            payload:
              d.kind === 'reject' ? { decision: 'reject', reason: d.reason ?? '' } : { decision: 'accept' },
          }),
        onSettled: (d, outcome) => settle.current(d, outcome),
        onHeldChange: (d) => mounted.current && setHeld(d),
      }),
    [getDataProvider],
  );

  // Ждущее решение уходит при закрытии стопки и при уходе со страницы
  useEffect(() => {
    mounted.current = true;
    window.scrollTo({ top: 0 });
    const onHide = () => void queue.flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      mounted.current = false;
      void queue.flush();
    };
  }, [queue]);

  useEffect(() => {
    if (review || data.isLoading || data.isError) return;
    setReview({ deck: createDeck(data.items.map((p) => p.id)), later: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, data.isLoading, data.isError, liveKey]);

  // Живые обновления: новые заявки в конец стопки, решённые другими и отозванные — прочь с сообщением
  useEffect(() => {
    if (!review || data.isLoading || data.isError) return;
    const fresh = data.items.filter((p) => !review.deck.order.includes(p.id) && !dropped.current.has(p.id));
    if (fresh.length) {
      setReview((s) =>
        s
          ? appendKeys(
              s,
              fresh.map((p) => p.id),
            )
          : s,
      );
      say(fresh.map((p) => newApplicationText(p.user.name)).join('. '));
    }
    const gone = undecidedKeys(review).filter((id) => !live.has(id) && !checking.current.has(id));
    if (!gone.length) return;
    gone.forEach((id) => checking.current.add(id));
    void statusesOf(gone).then((statuses) => {
      gone.forEach((id) => {
        checking.current.delete(id);
        dropped.current.add(id);
      });
      if (!mounted.current) return;
      setReview((s) =>
        s ? { deck: drop(s.deck, gone), later: s.later.filter((k) => !gone.includes(k)) } : s,
      );
      say(
        gone
          .map((id) => goneText(known.current.get(id)?.user.name ?? 'Заявитель', statuses.get(id) ?? null))
          .join('. '),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, data.isLoading, data.isError, review === null]);

  const statusesOf = async (ids: string[]) => {
    const result = new Map<string, ParticipationStatus>();
    const events = [...new Set(ids.map((id) => known.current.get(id)?.event.id).filter(Boolean))] as string[];
    await Promise.all(
      events.map(async (id) => {
        try {
          const res = await getDataProvider().getList<ParticipantView>({
            resource: 'participations',
            filters: [{ field: 'eventId', operator: 'eq', value: id }],
            pagination: { mode: 'off' },
          });
          res.data.forEach((p) => ids.includes(p.id) && result.set(p.id, p.status));
        } catch {
          /* причина неизвестна: сообщение будет общим */
        }
      }),
    );
    return result;
  };

  const deck = review?.deck ?? null;
  const items = useMemo(
    () =>
      (deck?.order ?? [])
        .map((id) => live.get(id) ?? known.current.get(id))
        .filter((p): p is OrganizerPendingView => p !== undefined),
    [deck?.order, live],
  );

  const takenHere = (eventKey: string) =>
    (deck ? keysWith(deck, 'right') : []).reduce((sum, id) => {
      const p = live.get(id);
      return p && p.event.id === eventKey ? sum + p.seats : sum;
    }, 0);
  const eventOf = (p: OrganizerPendingView) =>
    data.items.find((x) => x.event.id === p.event.id)?.event ?? p.event;
  const freeFor = (p: OrganizerPendingView) => freeSeats(eventOf(p).seatsLeft, takenHere(p.event.id));
  const blockOf = (p: OrganizerPendingView) => acceptBlock(p.seats, freeFor(p));

  const update = useCallback(
    (fn: (d: DeckState) => DeckState) => setReview((s) => (s ? applyDeckUpdate(s, fn) : s)),
    [],
  );

  const push = (p: OrganizerPendingView, kind: 'accept' | 'reject', reason = '') =>
    queue.push({ id: p.id, kind, reason, name: p.user.name });

  const onAction = (p: OrganizerPendingView, dir: SwipeDir): SwipeResult | Promise<SwipeResult> => {
    if (dir === 'right') {
      push(p, 'accept');
      return;
    }
    if (dir === 'up') return;
    if (dontAsk) {
      push(p, 'reject');
      return;
    }
    return new Promise<SwipeResult>((resolve) => setRejectFor({ name: p.user.name, resolve }));
  };

  const onReject = (choice: RejectChoice) => {
    const top = deck ? currentKey(deck) : null;
    const p = top ? (live.get(top) ?? known.current.get(top)) : undefined;
    if (p) push(p, 'reject', choice.reason);
    setDontAsk(choice.dontAsk);
    rejectFor?.resolve(true);
    setRejectFor(null);
  };

  const onRejectCancel = () => {
    rejectFor?.resolve(false);
    setRejectFor(null);
  };

  const onUndo = (p: OrganizerPendingView, dir: SwipeDir) => {
    if (dir !== 'up') queue.undo(p.id);
  };

  const undoHeld = () => {
    const d = queue.undo();
    if (!d) return;
    setReview((s) => {
      if (!s) return s;
      const r = undo(s.deck);
      return r && r.key === d.id ? { ...s, deck: r.state } : s;
    });
    setNotice(`Вернули: ${d.name}`);
  };

  const top = deck ? currentKey(deck) : null;
  const current = top ? (live.get(top) ?? known.current.get(top)) : undefined;
  const event = current ? eventOf(current) : null;

  const toolbar = (
    <>
      <Button variant="secondary" size="sm" icon={<ArrowLeftIcon size={18} aria-hidden />} onClick={onExit}>
        {exitLabel}
      </Button>
      {event && current && (
        <div className={styles.head}>
          <p className={styles.headTitle}>{event.title}</p>
          <p className={styles.headMeta}>
            <span>{formatEventDate(event.startsAt)}</span>
            <strong className={styles.headSeats}>{seatsLine(event.capacity, freeFor(current))}</strong>
          </p>
        </div>
      )}
    </>
  );

  let body: ReactNode;
  if (!review) {
    body = data.isError ? (
      <ErrorState onRetry={data.refetch}>
        Не удалось загрузить заявки. Проверьте интернет и нажмите «Повторить».
      </ErrorState>
    ) : (
      <div className={styles.loading} role="status">
        <span className="sr-only">Загружаем заявки…</span>
        <SkeletonBlock height="100%" radius="card" />
      </div>
    );
  } else if (review.deck.order.length === 0) {
    body = (
      <EmptyState
        title="Новых заявок нет"
        actions={
          <Button variant="secondary" icon={<ArrowLeftIcon size={20} aria-hidden />} onClick={onExit}>
            {summaryExitLabel}
          </Button>
        }
      >
        Когда кто-то отправит заявку, она появится здесь сразу, без обновления страницы.
      </EmptyState>
    );
  } else if (passDone(review)) {
    body = (
      <ReviewSummary
        accepted={keysWith(review.deck, 'right').length}
        rejected={keysWith(review.deck, 'left').length}
        later={review.later.length}
        participantsTo={participantsTo}
        exitLabel={summaryExitLabel}
        onExit={onExit}
        onReopenLater={() => setReview((s) => (s ? reopenLater(s) : s))}
      />
    );
  }

  return (
    <>
      <h1 className="sr-only">Заявки по одной</h1>
      {review && body === undefined ? (
        <SwipeDeck<OrganizerPendingView>
          items={items}
          getKey={(p) => p.id}
          itemLabel={(p) => (allEvents ? `${p.user.name}, заявка на «${p.event.title}»` : p.user.name)}
          state={review.deck}
          onStateChange={update}
          label="Заявки по одной"
          toolbar={toolbar}
          onExit={onExit}
          exitLabel={exitLabel}
          notice={notice}
          renderCard={(p, ctx) => (
            <ApplicantCard
              application={p}
              showEvent={allEvents}
              blocked={blockOf(p) !== null}
              editLink={`/events/${p.event.id}/edit`}
              expanded={ctx.expanded}
              onToggle={ctx.toggle}
              onProfile={() => setProfile({ id: p.user.id, name: p.user.name, close: ctx.toggle })}
            />
          )}
          actions={{
            left: {
              label: 'Отклонить',
              stamp: 'Отклонить',
              icon: <XIcon size={26} weight="bold" />,
              announce: 'Заявка отклонена. Вернуть можно в течение 5 секунд',
              optimistic: dontAsk,
            },
            right: {
              label: 'Принять',
              stamp: 'Принять',
              icon: <CheckIcon size={30} weight="bold" />,
              announce: 'Заявка принята. Вернуть можно в течение 5 секунд',
              disabled: blockOf,
            },
            up: {
              label: 'Решу позже',
              stamp: 'Позже',
              icon: <ClockIcon size={20} aria-hidden />,
              announce: 'Отложено в конец стопки',
              variant: 'secondary',
            },
          }}
          onAction={onAction}
          onUndo={onUndo}
        />
      ) : (
        <div className={styles.mode}>
          {!review && <div className={styles.bar}>{toolbar}</div>}
          {body}
        </div>
      )}

      {held && (
        <div className={styles.undoBar}>
          <span className={styles.undoText}>{decidedText(held.name, held.kind)}</span>
          <Button variant="inverse" size="sm" onClick={undoHeld}>
            Вернуть
          </Button>
        </div>
      )}

      <RejectSheet name={rejectFor?.name ?? null} onReject={onReject} onCancel={onRejectCancel} />
      <ProfileSheet
        person={profile}
        onClose={() => {
          profile?.close();
          setProfile(null);
        }}
      />
    </>
  );
}
