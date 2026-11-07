import {
  CalendarBlankIcon,
  CaretDownIcon,
  CaretUpIcon,
  ChatCircleIcon,
  MapPinIcon,
  QueueIcon,
  SparkleIcon,
} from '@phosphor-icons/react';
import { useOne } from '@refinedev/core';
import { useEffect, useRef } from 'react';

import { Avatar, AvatarStack, Button, SkeletonText, SportIcon } from '@/components';
import { formatDistance } from '@/lib/geo';
import { imageAttrs } from '@/lib/images';
import { EVENT_LEVEL } from '@/lib/labels';
import { priceSummary } from '@/lib/money';
import { count, WORDS } from '@/lib/plural';
import type { EventDetails, EventView } from '@/types/api';

import { EventCountdown } from '../../event/EventCountdown';
import { ModeTag, Spots, Tag } from '../FeedCard';
import { whenShort } from '../filters';
import { LazyEventMap } from '../LazyMap';
import { UrgentTag } from '../urgent/Urgent';
import styles from './CardsMode.module.css';
import { waitlistOnly } from './cardsText';

const CARD_IMAGE = {
  width: 440,
  height: 350,
  sizes: '(max-width: 767px) calc(100vw - 32px), 440px',
  widths: [360, 440, 640, 880],
};

function organizerFacts(e: EventView): string {
  const { held } = e.organizerView.facts;
  return held > 0 ? `Встреч проведено: ${held}` : 'Первая встреча на платформе';
}

function matchLine(reasons: string[]): string {
  return reasons.map((r) => r.charAt(0).toLowerCase() + r.slice(1)).join(', ');
}

/** Лицевая сторона карточки в режиме «По одной», по касанию раскрывается подробностями. */
export function EventSwipeCard({
  event: e,
  expanded,
  onToggle,
}: {
  event: EventView;
  expanded: boolean;
  onToggle: () => void;
}) {
  const price = priceSummary(e.price, e.counts.confirmed, e.minParticipants);
  const faceRef = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const face = faceRef.current;
    if (!face) return;
    face.scrollTop = expanded ? (mediaRef.current?.offsetHeight ?? 0) : 0;
  }, [expanded]);
  return (
    <article ref={faceRef} className={styles.face} data-expanded={expanded ? '' : undefined}>
      <div ref={mediaRef} className={styles.media}>
        {e.coverUrl ? (
          <img {...imageAttrs(e.coverUrl, CARD_IMAGE)} alt="" decoding="async" draggable={false} />
        ) : (
          <span className={styles.fallback} aria-hidden>
            <SportIcon sport={e.sport} size={56} weight="regular" />
          </span>
        )}
        <span className={styles.mediaTags}>
          <Tag tone="plain" icon={<SportIcon sport={e.sport} size={16} />}>
            {e.sport.name}
          </Tag>
          <ModeTag mode={e.joinMode} />
          <UrgentTag event={e} />
          {waitlistOnly(e) && (
            <Tag tone="wait" icon={<QueueIcon size={14} weight="fill" aria-hidden />}>
              Только лист ожидания
            </Tag>
          )}
        </span>
      </div>

      <div className={styles.body}>
        <p className={styles.when}>
          <CalendarBlankIcon size={20} aria-hidden />
          <span>{whenShort(e.startsAt)}</span>
          <EventCountdown event={e} className={styles.countdown} />
        </p>
        <h3 className={styles.title}>{e.title}</h3>
        <p className={styles.place}>
          <MapPinIcon size={18} aria-hidden />
          <span>
            {e.place.address}
            {e.distanceKm !== null && ` · ${formatDistance(e.distanceKm)} от вас`}
          </span>
        </p>
        <Spots
          counts={e.counts}
          capacity={e.capacity}
          minParticipants={e.minParticipants}
          className={styles.spots}
        />
        <p className={styles.meta}>
          <strong>{price.free ? 'Бесплатно' : price.main}</strong>
          <span>{EVENT_LEVEL[e.level]}</span>
        </p>
        <div className={styles.org}>
          <Avatar
            name={e.organizerView.name}
            src={e.organizerView.avatarUrl}
            size={32}
            shape={e.organizerView.kind === 'org' ? 'org' : 'person'}
          />
          <span className={styles.orgText}>
            <span className={styles.orgName}>{e.organizerView.name}</span>
            <span className={styles.orgFacts}>{organizerFacts(e)}</span>
          </span>
        </div>
        {e.matchReasons.length > 0 && (
          <p className={styles.match}>
            <SparkleIcon size={18} weight="fill" aria-hidden />
            <span>Почему вам подходит: {matchLine(e.matchReasons)}</span>
          </p>
        )}
        {expanded && <Details id={e.id} />}
      </div>
      <div className={styles.foot}>
        <button type="button" className={styles.more} onClick={onToggle} aria-expanded={expanded}>
          {expanded ? 'Свернуть' : 'Подробнее'}
          {expanded ? <CaretUpIcon size={16} aria-hidden /> : <CaretDownIcon size={16} aria-hidden />}
        </button>
      </div>
    </article>
  );
}

function Details({ id }: { id: string }) {
  const { result: d, query } = useOne<EventDetails>({ resource: 'events', id });
  if (query.isLoading) {
    return (
      <div className={styles.details} role="status">
        <span className="sr-only">Загружаем подробности…</span>
        <SkeletonText lines={4} />
      </div>
    );
  }
  if (query.isError || !d) {
    return (
      <div className={styles.details}>
        <p className={styles.detailsText}>Не удалось загрузить подробности.</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          Повторить
        </Button>
      </div>
    );
  }
  const find = [d.place.landmark, d.firstStep.howToFind].filter(Boolean).join('. ');
  const steps = [
    { label: 'Что взять', value: d.firstStep.bring },
    { label: 'Как найти', value: find },
    { label: 'Удобства', value: d.firstStep.amenities.join(', ') },
  ].filter((r) => r.value);
  const going = d.counts.confirmed;

  return (
    <div className={styles.details}>
      {d.description && <p className={styles.detailsText}>{d.description}</p>}
      {steps.length > 0 && (
        <section className={styles.detailsBlock} aria-label="Первый шаг">
          <h4 className={styles.detailsTitle}>Первый шаг</h4>
          <dl className={styles.steps}>
            {steps.map((r) => (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <div className={styles.map}>
        <LazyEventMap events={[d]} height={180} zoom={14} />
      </div>
      <section className={styles.detailsBlock} aria-label="Кто уже идёт">
        <h4 className={styles.detailsTitle}>Кто уже идёт</h4>
        {going > 0 ? (
          <p className={styles.going}>
            <AvatarStack people={d.participants} max={6} />
            <span>{count(going, WORDS.person)}</span>
          </p>
        ) : (
          <p className={styles.detailsText}>Пока никто не записался. Можно стать первым.</p>
        )}
      </section>
      <p className={styles.going}>
        <ChatCircleIcon size={20} aria-hidden />
        <span>
          {d.messagesCount > 0
            ? `В обсуждении ${count(d.messagesCount, WORDS.message)}`
            : 'В обсуждении пока нет сообщений'}
        </span>
      </p>
      <Button variant="secondary" block to={`/events/${d.id}`}>
        Открыть страницу события
      </Button>
    </div>
  );
}
