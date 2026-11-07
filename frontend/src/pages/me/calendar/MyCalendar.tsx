import { CaretLeftIcon, CaretRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { Segmented } from 'antd';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Button, EmptyState, SportIcon, StatusBadge } from '@/components';
import { dayjs, formatTimeRange } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { capitalize } from '@/lib/text';
import type { EventView } from '@/types/api';

import { organizerStatus, participantStatus, participationTab } from '../parts/groups';
import styles from './MyCalendar.module.css';

type Mode = 'week' | 'month';
type Kind = 'going' | 'waiting' | 'organizing' | 'off';

const KIND_LABEL: Record<Kind, string> = {
  going: 'Вы идёте',
  waiting: 'Ждёт ответа',
  organizing: 'Вы проводите',
  off: 'Прошло или отменено',
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

interface Item {
  event: EventView;
  kind: Kind;
}

function kindOf(e: EventView): Kind {
  if (e.isOrganizer) return e.state === 'upcoming' || e.state === 'live' ? 'organizing' : 'off';
  if (e.state !== 'upcoming' && e.state !== 'live') return 'off';
  return e.my?.status === 'confirmed' ? 'going' : 'waiting';
}

/** Всё, что человек проводит, и куда записан или подал заявку (без отменённых им самим и отказов). */
function collect(participating: EventView[], organizing: EventView[]): Item[] {
  const items = new Map<string, Item>();
  for (const e of participating) {
    if (!participationTab(e) || e.my?.status === 'rejected' || e.my?.status === 'removed') continue;
    items.set(e.id, { event: e, kind: kindOf(e) });
  }
  for (const e of organizing) items.set(e.id, { event: e, kind: kindOf(e) });
  return [...items.values()].sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt));
}

/** С9: «Мои занятия» календарём — неделя или месяц, точки по дням и список выбранного дня. */
export function MyCalendar({
  participating,
  organizing,
}: {
  participating: EventView[];
  organizing: EventView[];
}) {
  const [mode, setMode] = useState<Mode>('month');
  const [cursor, setCursor] = useState(() => dayjs().startOf('day'));
  const [selected, setSelected] = useState(() => dayjs().format('YYYY-MM-DD'));
  const items = useMemo(() => collect(participating, organizing), [participating, organizing]);
  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      const key = dayjs(item.event.startsAt).format('YYYY-MM-DD');
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items]);

  const today = dayjs().format('YYYY-MM-DD');
  const first = mode === 'month' ? cursor.startOf('month').startOf('isoWeek') : cursor.startOf('isoWeek');
  const last = mode === 'month' ? cursor.endOf('month').endOf('isoWeek') : cursor.endOf('isoWeek');
  const days: dayjs.Dayjs[] = [];
  for (let d = first; !d.isAfter(last, 'day'); d = d.add(1, 'day')) days.push(d);

  const step = (dir: 1 | -1) => setCursor((c) => c.add(dir, mode === 'month' ? 'month' : 'week'));
  const title =
    mode === 'month'
      ? capitalize(cursor.format('MMMM YYYY'))
      : first.isSame(last, 'month')
        ? `${first.format('D')}–${last.format('D MMMM')}`
        : `${first.format('D MMMM')} – ${last.format('D MMMM')}`;
  const picked = byDay.get(selected) ?? [];
  const pickedDay = dayjs(selected);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Segmented<Mode>
          aria-label="Показать"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'week', label: 'Неделя' },
            { value: 'month', label: 'Месяц' },
          ]}
        />
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => step(-1)}
            aria-label={mode === 'month' ? 'Предыдущий месяц' : 'Предыдущая неделя'}
          >
            <CaretLeftIcon size={20} weight="bold" aria-hidden />
          </button>
          <p className={styles.title} aria-live="polite">
            {title}
          </p>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => step(1)}
            aria-label={mode === 'month' ? 'Следующий месяц' : 'Следующая неделя'}
          >
            <CaretRightIcon size={20} weight="bold" aria-hidden />
          </button>
        </div>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            setCursor(dayjs().startOf('day'));
            setSelected(today);
          }}
        >
          Сегодня
        </Button>
      </div>

      <div className={styles.grid} role="grid" aria-label="Календарь занятий">
        <div className={styles.row} role="row">
          {WEEKDAYS.map((w) => (
            <span key={w} className={styles.weekday} role="columnheader">
              {w}
            </span>
          ))}
        </div>
        {Array.from({ length: days.length / 7 }, (_, week) => (
          <div key={week} className={styles.row} role="row">
            {days.slice(week * 7, week * 7 + 7).map((d) => {
              const key = d.format('YYYY-MM-DD');
              const list = byDay.get(key) ?? [];
              const outside = mode === 'month' && !d.isSame(cursor, 'month');
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  aria-selected={key === selected}
                  aria-label={`${d.format('D MMMM, dddd')}${list.length ? `, ${count(list.length, WORDS.event)}` : ', занятий нет'}`}
                  className={[
                    styles.cell,
                    mode === 'week' && styles.cellWeek,
                    outside && styles.outside,
                    key === today && styles.today,
                    key === selected && styles.selected,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setSelected(key)}
                >
                  <span className={styles.num}>{d.format('D')}</span>
                  {list.length > 0 && (
                    <span className={styles.dots} aria-hidden>
                      {list.slice(0, 3).map((item) => (
                        <i key={item.event.id} className={styles[item.kind]} />
                      ))}
                      {list.length > 3 && <span className={styles.more}>+{list.length - 3}</span>}
                    </span>
                  )}
                  {mode === 'week' && list.length > 0 && (
                    <span className={styles.times} aria-hidden>
                      {list.slice(0, 3).map((item) => (
                        <span key={item.event.id}>{dayjs(item.event.startsAt).format('HH:mm')}</span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <ul className={styles.legend} aria-label="Обозначения">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <li key={k}>
            <i className={styles[k]} aria-hidden />
            {KIND_LABEL[k]}
          </li>
        ))}
      </ul>

      <section className={styles.day} aria-labelledby="calendar-day">
        <h3 id="calendar-day" className={styles.dayTitle}>
          {capitalize(pickedDay.format('dddd, D MMMM'))}
        </h3>
        {picked.length ? (
          <ul className={styles.list}>
            {picked.map(({ event: e, kind }) => {
              const status = e.isOrganizer ? organizerStatus(e) : participantStatus(e);
              return (
                <li key={e.id} className={styles.item}>
                  <span className={[styles.mark, styles[kind]].join(' ')} aria-hidden />
                  <span className={styles.time}>{formatTimeRange(e.startsAt, e.durationMin)}</span>
                  <span className={styles.body}>
                    <Link to={`/events/${e.id}`} className={styles.link}>
                      <SportIcon sport={e.sport} size={18} />
                      {e.title}
                    </Link>
                    <span className={styles.place}>
                      {e.isOrganizer ? `Вы проводите. ${e.place.address}` : e.place.address}
                    </span>
                    <StatusBadge kind="custom" meta={status.meta} />
                  </span>
                </li>
              );
            })}
          </ul>
        ) : items.length ? (
          <p className={styles.empty}>В этот день занятий нет.</p>
        ) : (
          <EmptyState
            title="Календарь пока пуст"
            actions={
              <Button variant="primary" to="/events" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
                Найти встречу
              </Button>
            }
          >
            Запишитесь на событие или создайте своё, и оно появится в календаре.
          </EmptyState>
        )}
      </section>
    </div>
  );
}
