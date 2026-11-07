import { ArrowRightIcon, MapPinIcon } from '@phosphor-icons/react';
import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';

import { SportIcon, StatusBadge } from '@/components';
import { dayjs } from '@/lib/dates';
import { imageAttrs } from '@/lib/images';
import type { EventView } from '@/types/api';

import type { RowStatus } from './groups';
import styles from './MyEventRow.module.css';

interface MyEventRowProps {
  event: EventView;
  status: RowStatus;
  action?: ReactNode;
  /** history — в «Прошедших» вместо времени показываем дату. */
  variant?: 'schedule' | 'history';
  /** Подпись над названием: «Вы проводите», «От клуба «Ладья»». */
  caption?: string;
}

/** Строка «Моих занятий»: время, что и где, статус словами и одно следующее действие. */
export function MyEventRow({ event, status, action, variant = 'schedule', caption }: MyEventRowProps) {
  const start = dayjs(event.startsAt);
  const firstLabel = useRef(status.meta.label);
  const changed = firstLabel.current !== status.meta.label;
  const muted = ['past', 'cancelled', 'removed', 'deleted'].includes(event.state);

  return (
    <li className={[styles.row, muted && styles.muted].filter(Boolean).join(' ')}>
      <div className={styles.when}>
        {variant === 'history' ? (
          <>
            <span className={styles.big}>{start.format('D')}</span>
            <span className={styles.small}>{start.format('MMM').replace('.', '')}</span>
          </>
        ) : (
          <>
            <span className={styles.big}>{start.format('HH:mm')}</span>
            <span className={styles.small}>до {start.add(event.durationMin, 'minute').format('HH:mm')}</span>
          </>
        )}
      </div>

      <div className={styles.body}>
        <p className={styles.sport}>
          <SportIcon sport={event.sport} size={18} />
          <span>{event.sport.name}</span>
          {caption && <span className={styles.caption}>{caption}</span>}
        </p>
        <h3 className={styles.title}>
          <Link to={`/events/${event.id}`}>{event.title}</Link>
        </h3>
        <p className={styles.place}>
          <MapPinIcon size={18} aria-hidden />
          <span>
            {variant === 'history' ? `${start.format('dddd, HH:mm')}. ` : ''}
            {event.place.address}
          </span>
        </p>
        <div className={styles.status} aria-live="polite">
          <StatusBadge kind="custom" meta={status.meta} flash={changed} />
        </div>
        {status.detail && <p className={styles.detail}>{status.detail}</p>}
        {status.changes.length > 0 && (
          <ul className={styles.changes}>
            {status.changes.map((c, i) => (
              <li key={`${c.label}-${i}`}>
                <span className={styles.changeLabel}>{c.label}</span>
                <span className={styles.from}>
                  <span className="sr-only">было </span>
                  {c.from}
                </span>
                <ArrowRightIcon size={16} aria-hidden className={styles.arrow} />
                <span className={styles.to}>
                  <span className="sr-only">стало </span>
                  {c.to}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {event.coverUrl && (
        <div className={styles.cover} aria-hidden>
          <img
            {...imageAttrs(event.coverUrl, { width: 160, height: 128 })}
            alt=""
            loading="lazy"
            decoding="async"
          />
        </div>
      )}
      {action && <div className={styles.action}>{action}</div>}
    </li>
  );
}
