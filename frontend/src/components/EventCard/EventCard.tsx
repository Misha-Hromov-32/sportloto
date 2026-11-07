import { Clock, MapPin, SealCheck, Sparkle, Sun } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { dayjs, dayLabel, displayZone, formatTimeRange } from '@/lib/dates';
import { formatDistance } from '@/lib/geo';
import { imageAttrs } from '@/lib/images';
import { EVENT_LEVEL } from '@/lib/labels';
import { capitalize } from '@/lib/text';
import type { EventView } from '@/types/api';

import { CollectProgress } from '../CollectProgress/CollectProgress';
import { PriceInfo } from '../PriceInfo/PriceInfo';
import { SportIcon } from '../SportIcon/SportIcon';
import { StatusBadge } from '../StatusBadge/StatusBadge';
import styles from './EventCard.module.css';

interface EventCardProps {
  event: EventView;
  timeZone?: string;
  /** row — строка списка (лента, «Мои занятия»); poster — крупная афиша для подборки. */
  variant?: 'row' | 'poster';
  /** Показать «почему вам подходит». */
  showMatch?: boolean;
  /** Куда ведёт карточка; по умолчанию — на страницу события. */
  to?: string;
}

/** Табличка даты: день недели, число, месяц. */
function DateTable({ iso }: { iso: string }) {
  const d = dayjs(iso);
  const label = dayLabel(iso);
  const isNear = label === 'Сегодня' || label === 'Завтра';
  return (
    <div className={styles.date} aria-hidden>
      <span className={[styles.dow, isNear && styles.near].filter(Boolean).join(' ')}>
        {isNear ? label : d.format('dd')}
      </span>
      <span className={styles.day}>{d.format('D')}</span>
      <span className={styles.month}>{d.format('MMM').replace('.', '')}</span>
    </div>
  );
}

function posterDay(iso: string, zone = displayZone()): string {
  const days = dayjs(iso).tz(zone).startOf('day').diff(dayjs().tz(zone).startOf('day'), 'day');
  return days >= 0 && days < 7
    ? capitalize(dayLabel(iso, undefined, zone))
    : dayjs(iso).tz(zone).format('D MMM').replace('.', '');
}

function stateBadge(event: EventView) {
  if (event.my)
    return (
      <StatusBadge
        kind="participation"
        status={event.my.status}
        waitlistPosition={event.my.waitlistPosition}
        flash
      />
    );
  if (event.state !== 'upcoming') return <StatusBadge kind="event" status={event.state} />;
  return null;
}

const POSTER_IMAGE = {
  width: 560,
  height: 420,
  sizes: '(max-width: 767px) calc(100vw - 32px), 560px',
  widths: [360, 480, 560, 720, 960, 1120],
};

export function EventCard({
  event,
  variant = 'row',
  showMatch,
  to,
  timeZone = displayZone(),
}: EventCardProps) {
  const href = to ?? `/events/${event.id}`;
  const when = `${dayLabel(event.startsAt, undefined, timeZone)}, ${dayjs(event.startsAt).tz(timeZone).format('D MMMM')}, ${formatTimeRange(event.startsAt, event.durationMin, timeZone)}`;
  const inactive = ['past', 'cancelled', 'removed', 'deleted'].includes(event.state);
  const organizer = event.organizerView;

  if (variant === 'poster') {
    return (
      <article className={[styles.poster, inactive && styles.inactive].filter(Boolean).join(' ')}>
        <Link to={href} className={styles.cover} aria-label={event.title}>
          {event.coverUrl ? (
            <img {...imageAttrs(event.coverUrl, POSTER_IMAGE)} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className={styles.coverFallback}>
              <SportIcon sport={event.sport} size={56} weight="regular" />
              <span className={styles.coverSport}>{event.sport.name}</span>
            </span>
          )}
          <span className={styles.coverDate}>
            <span className={styles.coverDay}>{posterDay(event.startsAt, timeZone)}</span>
            <span className={styles.coverTime}>{dayjs(event.startsAt).tz(timeZone).format('HH:mm')}</span>
          </span>
        </Link>
        <div className={styles.posterBody}>
          <div className={styles.metaTop}>
            <span className={styles.sport}>
              <SportIcon sport={event.sport} size={18} />
              {event.sport.name}
            </span>
            {stateBadge(event)}
          </div>
          <h3 className={styles.posterTitle}>
            <Link to={href}>{event.title}</Link>
          </h3>
          <p className={styles.line}>
            <MapPin size={18} aria-hidden />
            <span>
              {event.place.address}
              {event.distanceKm !== null && (
                <span className={styles.distance}>{formatDistance(event.distanceKm)} от вас</span>
              )}
            </span>
          </p>
          {showMatch && event.matchReasons.length > 0 && <MatchLine reasons={event.matchReasons} />}
          <div className={styles.posterFoot}>
            <CollectProgress
              counts={event.counts}
              capacity={event.capacity}
              minParticipants={event.minParticipants}
            />
            <PriceInfo
              compact
              price={event.price}
              confirmed={event.counts.confirmed}
              minParticipants={event.minParticipants}
            />
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={[styles.row, inactive && styles.inactive].filter(Boolean).join(' ')}>
      <DateTable iso={event.startsAt} />
      <div className={styles.body}>
        <div className={styles.metaTop}>
          <span className={styles.sport}>
            <SportIcon sport={event.sport} size={18} />
            {event.sport.name}
          </span>
          {event.beginnersWelcome && (
            <span className={styles.beginners}>
              <Sun size={16} weight="fill" aria-hidden />
              Рады новичкам
            </span>
          )}
          {stateBadge(event)}
        </div>
        <h3 className={styles.title}>
          <Link to={href} className={styles.stretched}>
            {event.title}
          </Link>
        </h3>
        <p className={styles.line}>
          <Clock size={18} aria-hidden />
          <span className="tabular">{when}</span>
        </p>
        <p className={styles.line}>
          <MapPin size={18} aria-hidden />
          <span>
            {event.place.address}
            {event.distanceKm !== null && (
              <span className={styles.distance}>{formatDistance(event.distanceKm)} от вас</span>
            )}
          </span>
        </p>
        <p className={styles.organizer}>
          {organizer.verified && (
            <SealCheck
              size={18}
              weight="fill"
              className={styles.verified}
              aria-label="Организация проверена"
            />
          )}
          <span>{organizer.name}</span>
          <span className={styles.level}>{EVENT_LEVEL[event.level]}</span>
        </p>
        {showMatch && event.matchReasons.length > 0 && <MatchLine reasons={event.matchReasons} />}
        <div className={styles.foot}>
          <CollectProgress
            counts={event.counts}
            capacity={event.capacity}
            minParticipants={event.minParticipants}
          />
          <div className={styles.footRight}>
            <PriceInfo
              compact
              price={event.price}
              confirmed={event.counts.confirmed}
              minParticipants={event.minParticipants}
            />
            <span className={styles.mode}>
              {event.joinMode === 'open' ? 'Свободная запись' : 'По заявке'}
            </span>
          </div>
        </div>
      </div>
      {event.coverUrl && (
        <div className={styles.thumb} aria-hidden>
          <img
            {...imageAttrs(event.coverUrl, { width: 176, height: 132 })}
            alt=""
            loading="lazy"
            decoding="async"
          />
        </div>
      )}
    </article>
  );
}

function MatchLine({ reasons }: { reasons: string[] }) {
  return (
    <p className={styles.match}>
      <Sparkle size={18} weight="fill" aria-hidden />
      <span>
        <span className="sr-only">Почему вам подходит: </span>
        {reasons.join(', ')}
      </span>
    </p>
  );
}
