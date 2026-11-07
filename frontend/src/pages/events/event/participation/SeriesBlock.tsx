import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  QueueIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { App } from 'antd';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Button, SkeletonBlock } from '@/components';
import { API, useAction, useLiveGet, useMe } from '@/lib/api';
import { capitalize } from '@/lib/text';
import { dayjs, formatTime } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import type { EventView, SeriesJoinOutcome, SeriesJoinResult, SeriesView } from '@/types/api';

import styles from './participation.module.css';

const ACTIVE = ['confirmed', 'pending', 'waitlist'];

const OUTCOME: Record<SeriesJoinOutcome, { label: string; tone: 'ok' | 'wait' | 'off'; icon: ReactNode }> = {
  confirmed: {
    label: 'Вы записаны',
    tone: 'ok',
    icon: <CheckCircleIcon size={18} weight="fill" aria-hidden />,
  },
  pending: {
    label: 'Заявка отправлена',
    tone: 'wait',
    icon: <ClockIcon size={18} weight="fill" aria-hidden />,
  },
  waitlist: {
    label: 'Мест нет, вы в листе ожидания',
    tone: 'wait',
    icon: <QueueIcon size={18} weight="fill" aria-hidden />,
  },
  already: { label: 'Уже были записаны', tone: 'ok', icon: <CheckCircleIcon size={18} aria-hidden /> },
  skipped: { label: 'Не получилось', tone: 'off', icon: <XCircleIcon size={18} weight="fill" aria-hidden /> },
};

const day = (iso: string) => capitalize(dayjs(iso).format('dd, D MMMM'));

/**
 * С10: занятие повторяется каждую неделю. Можно записаться на все предстоящие встречи разом;
 * отказаться от одной — обычной отменой записи в её карточке, остальные останутся.
 */
export function SeriesBlock({ event: e, className }: { event: EventView; className?: string }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const { modal } = App.useApp();
  const { run, isPending } = useAction<SeriesJoinResult>();
  const [result, setResult] = useState<SeriesJoinResult | null>(null);
  const show = Boolean(e.series) && e.state === 'upcoming' && !e.isOrganizer && !e.can.moderate;
  const { data, isLoading } = useLiveGet<SeriesView>(API.series(e.id), ['events', 'participations'], show);
  if (!show) return null;

  const meetings = data?.events ?? [];
  const mine = meetings.filter((x) => x.my && ACTIVE.includes(x.my.status));
  const open = meetings.filter((x) => !(x.my && ACTIVE.includes(x.my.status)));
  const start = dayjs(e.startsAt);

  const joinAll = () => {
    if (!me) {
      navigate(`/login?to=${encodeURIComponent(`/events/${e.id}`)}`);
      return;
    }
    modal.confirm({
      title: 'Записаться на все встречи серии?',
      icon: null,
      content: (
        <div className={styles.dialogText}>
          <p>
            {e.joinMode === 'approval'
              ? 'На каждую встречу уйдёт заявка, организатор решит по каждой.'
              : 'Запишем на каждую встречу, где есть места. Где мест нет, поставим в лист ожидания.'}
          </p>
          <ul className={styles.dates}>
            {open.map((x) => (
              <li key={x.id} className={styles.date}>
                {day(x.startsAt)}
              </li>
            ))}
          </ul>
        </div>
      ),
      okText: e.joinMode === 'approval' ? 'Отправить заявки' : 'Записаться на все',
      cancelText: 'Отмена',
      onOk: async () => {
        try {
          setResult(await run(API.joinSeries(e.id)));
        } catch {
          /* текст ошибки уже показан */
        }
      },
    });
  };

  return (
    <section className={[styles.series, className].filter(Boolean).join(' ')} aria-labelledby="series-title">
      <h2 id="series-title" className={styles.seriesTitle}>
        <ArrowsClockwiseIcon size={22} aria-hidden />
        Каждую неделю
      </h2>
      <p className={styles.seriesText}>
        {capitalize(start.format('dddd'))} в {formatTime(e.startsAt)}, до{' '}
        {dayjs(e.series!.until).format('D MMMM')}.
      </p>
      {isLoading ? (
        <SkeletonBlock height={40} />
      ) : (
        meetings.length > 1 && (
          <>
            <p className={styles.seriesText}>
              Впереди {count(meetings.length, WORDS.meeting)}
              {me ? `, вы записаны на ${mine.length}` : ''}.
            </p>
            <ul className={styles.dates} aria-label="Встречи серии">
              {meetings.map((x: EventView) => {
                const joined = Boolean(x.my && ACTIVE.includes(x.my.status));
                return (
                  <li
                    key={x.id}
                    className={[styles.date, joined && styles.dateMine].filter(Boolean).join(' ')}
                  >
                    {joined && <CheckCircleIcon size={16} weight="fill" aria-hidden />}
                    {day(x.startsAt)}
                    {joined && <span className="sr-only">, вы записаны</span>}
                  </li>
                );
              })}
            </ul>
          </>
        )
      )}
      {result ? (
        <ul className={styles.results} aria-live="polite">
          {result.results.map((r) => {
            const o = OUTCOME[r.outcome];
            const tone =
              o.tone === 'ok' ? styles.resultOk : o.tone === 'wait' ? styles.resultWait : styles.resultOff;
            return (
              <li key={r.eventId} className={[styles.result, tone].join(' ')}>
                {o.icon}
                <span>
                  {day(r.startsAt)}: {o.label.toLowerCase()}
                </span>
                {r.reason && <span className={styles.resultReason}>{r.reason}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        open.length > 0 &&
        meetings.length > 1 && (
          <Button
            className={styles.wrapBtn}
            variant="secondary"
            block
            loading={isPending}
            loadingText="Записываем…"
            onClick={joinAll}
          >
            Записаться на все встречи серии
          </Button>
        )
      )}
      {mine.length > 0 && (
        <p className={styles.hint}>
          Если не сможете в какой-то день, отмените запись только на эту встречу. Остальные записи останутся.
        </p>
      )}
    </section>
  );
}
