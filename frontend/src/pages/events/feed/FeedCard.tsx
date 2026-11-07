import { CalendarBlankIcon, MapPinIcon, SparkleIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Button, SportIcon } from '@/components';
import { formatDistance } from '@/lib/geo';
import { imageAttrs } from '@/lib/images';
import { COMPOSITION, EVENT_LEVEL, PARTICIPATION_STATUS } from '@/lib/labels';
import { priceSummary } from '@/lib/money';
import { count, plural, WORDS } from '@/lib/plural';
import { capitalize } from '@/lib/text';
import type { EventCounts, EventView } from '@/types/api';
import type { JoinMode } from '@/types/domain';

import { EventCountdown } from '../event/EventCountdown';
import { offerTitle } from '../event/participation/offer';
import styles from './FeedCard.module.css';
import { whenShort } from './filters';
import { ProgramTag, UrgentTag } from './urgent/Urgent'; // С3, Н2
import { FavoriteFrame } from '../../me/favorites/FavoriteButton'; // С8

export function Tag({
  tone,
  icon,
  children,
  className,
}: {
  tone?: 'ok' | 'wait' | 'dark' | 'off' | 'danger' | 'plain';
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={[styles.tag, tone && styles[`tag-${tone}`], className].filter(Boolean).join(' ')}>
      {icon}
      {children}
    </span>
  );
}

export function ModeTag({ mode }: { mode: JoinMode }) {
  return mode === 'open' ? <Tag tone="ok">Свободная запись</Tag> : <Tag tone="wait">По заявке</Tag>;
}

/** Полоса заполнения: «6 из 12 · свободно 6 мест». Мало мест — полоса красная. */
export function Spots({
  counts,
  capacity,
  minParticipants,
  className,
}: {
  counts: EventCounts;
  capacity: number | null;
  minParticipants: number | null;
  className?: string;
}) {
  const { confirmed, spotsLeft, toThreshold, waitlist } = counts;
  const hot = spotsLeft !== null && spotsLeft <= 3;
  const pct = capacity ? Math.min(100, Math.round((confirmed / capacity) * 100)) : 0;
  let text: string;
  if (capacity === null) text = `${count(confirmed, WORDS.participant)} · мест без ограничений`;
  else if (spotsLeft === 0)
    text = `${confirmed} из ${capacity} · мест нет${waitlist ? `, в листе ожидания ${waitlist}` : ''}`;
  else
    text = `${confirmed} из ${capacity} · ${hot ? 'осталось' : 'свободно'} ${spotsLeft} ${plural(spotsLeft!, WORDS.place)}`;
  if (toThreshold !== null && minParticipants !== null) text += ` · до сбора нужно ещё ${toThreshold}`;
  return (
    <div className={[styles.spots, hot && styles.spotsHot, className].filter(Boolean).join(' ')}>
      {capacity !== null && (
        <div className={styles.spotsBar} aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      <small>{text}</small>
    </div>
  );
}

function StateTag({ event }: { event: EventView }) {
  if (event.my) {
    const meta = PARTICIPATION_STATUS[event.my.status];
    const tone =
      meta.tone === 'ok' ? 'dark' : meta.tone === 'wait' ? 'wait' : meta.tone === 'danger' ? 'danger' : 'off';
    // С4: придержанное место из листа ожидания
    if (event.my.offerUntil)
      return (
        <Tag tone="wait" className="status-flash">
          {offerTitle(event.my.offerUntil)}
        </Tag>
      );
    const label =
      event.my.status === 'waitlist' && event.my.waitlistPosition
        ? `${meta.label}, ${event.my.waitlistPosition}-й`
        : meta.label;
    return (
      <Tag tone={tone} className="status-flash">
        {label}
      </Tag>
    );
  }
  if (event.isOrganizer) return <Tag tone="dark">Вы организатор</Tag>;
  if (event.state === 'live') return <Tag tone="danger">Уже идёт</Tag>;
  return null;
}

/** На компьютере 16:10, на телефоне 16:9: обрезка 16:10 оставляет тот же кадр. */
const FEED_IMAGE = {
  width: 400,
  height: 250,
  sizes: '(max-width: 639px) calc(100vw - 64px), (max-width: 1100px) calc(50vw - 72px), 340px',
  widths: [320, 360, 400, 480, 640, 720, 800],
};

interface FeedCardProps {
  event: EventView;
  /** Подпись «чем вам подходит» для подборки. */
  showMatch?: boolean;
  /** Крупнее: простой режим. */
  large?: boolean;
}

/** Карточка события в ленте по вёрстке владельца: фото, режим записи, дата красным, места, теги. */
export function FeedCard({ event, showMatch, large }: FeedCardProps) {
  const when = whenShort(event.startsAt);
  const price = priceSummary(event.price, event.counts.confirmed, event.minParticipants);
  return (
    // С8: сердечко «В избранное» лежит рядом со ссылкой, а не внутри неё
    <FavoriteFrame event={event}>
      <Link
        to={`/events/${event.id}`}
        className={[styles.card, large && styles.large].filter(Boolean).join(' ')}
        aria-label={`${event.title}, ${when.replace(' · ', ' в ')}`}
      >
        <div className={styles.media}>
          {event.coverUrl ? (
            <img {...imageAttrs(event.coverUrl, FEED_IMAGE)} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className={styles.fallback} aria-hidden>
              <SportIcon sport={event.sport} size={48} weight="regular" />
              <span className={styles.fallbackName}>{event.sport.name}</span>
            </span>
          )}
          <span className={styles.mediaTags}>
            <ModeTag mode={event.joinMode} />
            <StateTag event={event} />
            <UrgentTag event={event} />
          </span>
        </div>
        <div className={styles.body}>
          <span className={styles.when}>
            <CalendarBlankIcon size={16} aria-hidden />
            {when}
          </span>
          <EventCountdown event={event} className={styles.when} />
          <span className={styles.title}>{event.title}</span>
          <span className={styles.place}>
            <MapPinIcon size={16} aria-hidden />
            <span>
              {event.place.address}
              {event.distanceKm !== null && ` · ${formatDistance(event.distanceKm)} от вас`}
            </span>
          </span>
          {showMatch && event.matchReasons.length > 0 && (
            <span className={styles.match}>
              <SparkleIcon size={16} weight="fill" aria-hidden />
              <span>
                <span className="sr-only">Почему вам подходит: </span>
                {capitalize(event.matchReasons.map((r) => r.charAt(0).toLowerCase() + r.slice(1)).join(', '))}
              </span>
            </span>
          )}
          <span className={styles.tags}>
            <Tag tone="plain" icon={<SportIcon sport={event.sport} size={16} />}>
              {event.sport.name}
            </Tag>
            <Tag tone="plain">{EVENT_LEVEL[event.level]}</Tag>
            {event.composition && COMPOSITION[event.composition].tag && (
              <Tag tone="plain">{COMPOSITION[event.composition].tag}</Tag>
            )}
            <ProgramTag event={event} />
          </span>
          <Spots counts={event.counts} capacity={event.capacity} minParticipants={event.minParticipants} />
          <span className={styles.foot}>
            <strong className={styles.price}>{price.free ? 'Бесплатно' : price.main}</strong>
          </span>
        </div>
      </Link>
    </FavoriteFrame>
  );
}

/** Последняя плитка сетки: предложение создать своё событие. */
export function CreateCard({ to, text }: { to: string; text?: string }) {
  return (
    <div className={[styles.card, styles.create].join(' ')} data-reveal="">
      <h3 className={styles.createTitle}>Не нашли своё?</h3>
      <p className={styles.createText}>
        {text ?? 'Создайте свою встречу. Если нужного вида спорта нет в каталоге, впишите его название.'}
      </p>
      <Button variant="primary" to={to}>
        Создать событие
      </Button>
    </div>
  );
}

export function FeedCardSkeleton() {
  return (
    <div className={[styles.card, styles.skeleton].join(' ')} aria-hidden>
      <div className={styles.media} />
      <div className={styles.body}>
        <span className={styles.skLine} style={{ width: '40%' }} />
        <span className={styles.skLine} style={{ width: '85%', height: 22 }} />
        <span className={styles.skLine} style={{ width: '60%' }} />
        <span className={styles.skLine} style={{ width: '100%', height: 6, marginTop: 16 }} />
      </div>
    </div>
  );
}
