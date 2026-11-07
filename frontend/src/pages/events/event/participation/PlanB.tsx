import { ArrowsLeftRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { Button, ErrorState, SkeletonBlock, StatusBadge } from '@/components';
import { API, useAction, useLiveGet } from '@/lib/api';
import { formatDistance } from '@/lib/geo';
import { JOIN_MODE } from '@/lib/labels';
import { count, WORDS } from '@/lib/plural';
import type { EventView, PlanBView } from '@/types/api';
import type { ParticipationStatus } from '@/types/domain';

import { whenShort } from '../../feed/filters';
import styles from './participation.module.css';
import { useConflictAwareJoin } from './useConflictAwareJoin';

const ACTIVE: ParticipationStatus[] = ['confirmed', 'pending', 'waitlist'];

/** Показывать ли план Б: встречу отменили, а человек был записан, или он сам не смог в новое время. */
function needsPlanB(e: EventView): boolean {
  const my = e.my;
  if (!my || e.isOrganizer) return false;
  if (my.leftBecause === 'reschedule') return e.state === 'upcoming' || e.state === 'cancelled';
  return e.state === 'cancelled' && ACTIVE.includes(my.status);
}

/** С6: похожие встречи взамен отменённой или перенесённой — с записью в одно касание. */
export function PlanB({ event: e }: { event: EventView }) {
  const show = needsPlanB(e);
  const { data, isLoading, isError, refetch } = useLiveGet<PlanBView>(
    API.alternatives(e.id),
    ['events', 'participations'],
    show,
  );
  const ref = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (show && hash === '#plan-b' && !isLoading) ref.current?.scrollIntoView({ block: 'start' });
  }, [show, hash, isLoading]);

  if (!show) return null;
  const reason = e.my?.leftBecause === 'reschedule' ? 'reschedule' : 'cancelled';
  const alternatives = data?.alternatives ?? [];

  return (
    <section ref={ref} id="plan-b" className={styles.planB} aria-labelledby="plan-b-title">
      <div className={styles.planBHead}>
        <h2 id="plan-b-title" className={styles.planBTitle}>
          <ArrowsLeftRightIcon size={24} aria-hidden />
          Похожие встречи
        </h2>
        <p className={styles.planBText}>
          {reason === 'reschedule'
            ? 'Если новое время не подходит, посмотрите похожие встречи рядом. На них есть свободные места.'
            : 'Встреча отменена. Ниже — похожие встречи рядом, на которых есть свободные места.'}
        </p>
      </div>
      {isLoading ? (
        <div className={styles.altList} role="status" aria-live="polite">
          <span className="sr-only">Подбираем похожие встречи…</span>
          {[0, 1].map((i) => (
            <SkeletonBlock key={i} height={180} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()}>
          Не удалось подобрать похожие встречи. Проверьте интернет и нажмите «Повторить».
        </ErrorState>
      ) : alternatives.length ? (
        <ul className={styles.altList}>
          {alternatives.map((x) => (
            <Alternative key={x.id} event={x} />
          ))}
        </ul>
      ) : (
        <p className={styles.planBText}>
          В ближайшие два дня похожих встреч со свободными местами нет.{' '}
          <Link to={`/events?sport=${e.sportId}`}>Все встречи по этому направлению</Link>
        </p>
      )}
      {alternatives.length > 0 && (
        <Button
          variant="quiet"
          size="sm"
          to={`/events?sport=${e.sportId}`}
          icon={<MagnifyingGlassIcon size={20} aria-hidden />}
        >
          Другие дни и места
        </Button>
      )}
    </section>
  );
}

function Alternative({ event: x }: { event: EventView }) {
  const { run, isPending } = useAction();
  const join = useConflictAwareJoin(run);
  const [joined, setJoined] = useState<ParticipationStatus | null>(null);
  const spots = x.counts.spotsLeft;
  const status = joined ?? (x.my && ACTIVE.includes(x.my.status) ? x.my.status : null);

  const onJoin = async () => {
    try {
      const res = await join(x.id);
      if (res?.my) setJoined(res.my.status);
    } catch {
      /* текст ошибки уже показан */
    }
  };

  return (
    <li className={styles.alt}>
      <span className={styles.altWhen}>{whenShort(x.startsAt)}</span>
      <span className={styles.altTitle}>
        <Link to={`/events/${x.id}`}>{x.title}</Link>
      </span>
      <span className={styles.altMeta}>
        <span>
          {x.place.address}
          {x.distanceKm !== null && `, ${formatDistance(x.distanceKm)} от вас`}
        </span>
        <span>
          {JOIN_MODE[x.joinMode].label}
          {spots ? `, осталось ${count(spots, WORDS.place)}` : ''}
        </span>
      </span>
      <div className={styles.altAction}>
        {status ? (
          <StatusBadge kind="participation" status={status} />
        ) : (
          <Button
            variant="secondary"
            block
            loading={isPending}
            loadingText={x.joinMode === 'approval' ? 'Отправляем…' : 'Записываем…'}
            onClick={() => void onJoin()}
          >
            {JOIN_MODE[x.joinMode].action}
          </Button>
        )}
      </div>
    </li>
  );
}
