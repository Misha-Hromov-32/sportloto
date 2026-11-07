import { CalendarXIcon, CheckCircleIcon, UsersThreeIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { hourPrice, scheduleDayDate, scheduleDayName, venueTime } from '@/lib/venues';
import type { VenueDay, VenueSlotView } from '@/types/api';

import styles from './venues.module.css';

/** Дни расписания: две недели кнопками, у каждого — сколько окон свободно. */
export function DayPicker({
  days,
  value,
  onChange,
  timeZone,
}: {
  days: VenueDay[];
  value: string;
  onChange: (date: string) => void;
  timeZone: string;
}) {
  return (
    <div className={styles.days} role="radiogroup" aria-label="День">
      {days.map((d) => {
        const active = d.date === value;
        return (
          <button
            key={d.date}
            type="button"
            role="radio"
            aria-checked={active}
            className={[styles.day, active && styles.dayActive].filter(Boolean).join(' ')}
            onClick={() => onChange(d.date)}
          >
            <span className={styles.dayName}>{scheduleDayName(d.date, timeZone)}</span>
            <span className={styles.dayDate}>{scheduleDayDate(d.date)}</span>
            <span className={styles.dayFree}>
              {d.slots.length === 0 ? 'закрыто' : d.freeCount ? `свободно ${d.freeCount}` : 'всё занято'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const SLOT_STATUS = {
  free: { label: 'Свободно', Icon: CheckCircleIcon },
  busy: { label: 'Занято', Icon: CalendarXIcon },
  event: { label: 'Встреча', Icon: UsersThreeIcon },
} as const;

export function SlotStatus({ slot }: { slot: VenueSlotView }) {
  const { label, Icon } = SLOT_STATUS[slot.status];
  return (
    <span className={[styles.slotStatus, styles[`slot-${slot.status}`]].join(' ')}>
      <Icon size={18} weight={slot.status === 'free' ? 'fill' : 'regular'} aria-hidden />
      {label}
    </span>
  );
}

/** Окна выбранного дня. Действие справа зависит от экрана: предложить встречу, выбрать, изменить. */
export function SlotList({
  day,
  timeZone,
  action,
  empty,
}: {
  day: VenueDay | undefined;
  timeZone: string;
  action?: (slot: VenueSlotView) => ReactNode;
  empty?: ReactNode;
}) {
  if (!day || day.slots.length === 0)
    return <p className={styles.slotsEmpty}>{empty ?? 'В этот день площадка не работает или окна уже прошли.'}</p>;
  return (
    <ul className={styles.slots}>
      {day.slots.map((s) => (
        <li key={s.startsAt} className={[styles.slot, styles[`slotRow-${s.status}`]].join(' ')}>
          <span className={styles.slotTime}>
            {venueTime(s.startsAt, timeZone)}–{venueTime(s.endsAt, timeZone)}
          </span>
          <span className={styles.slotInfo}>
            <SlotStatus slot={s} />
            {s.event ? (
              <Link to={`/events/${s.event.id}`} className={styles.slotEvent}>
                «{s.event.title}»
              </Link>
            ) : (
              <span className={styles.slotPrice}>{hourPrice(s.price)}</span>
            )}
          </span>
          {action && <span className={styles.slotAction}>{action(s)}</span>}
        </li>
      ))}
    </ul>
  );
}
