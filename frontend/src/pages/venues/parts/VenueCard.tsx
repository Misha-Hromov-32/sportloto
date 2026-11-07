import { CalendarCheckIcon, MapPinIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { SportIcon } from '@/components';
import { formatDistance } from '@/lib/geo';
import { imageAttrs } from '@/lib/images';
import { updatedLabel, venuePriceLine, windowShort } from '@/lib/venues';
import type { VenueView } from '@/types/api';

import { FeatureTags } from './features';
import styles from './venues.module.css';

/** Карточка площадки в режиме «Площадки»: что, где, сколько стоит, условия и ближайшие свободные окна. */
const VENUE_CARD_IMAGE = {
  width: 360,
  height: 203,
  sizes: '(max-width: 639px) calc(100vw - 52px), (max-width: 1100px) calc(50vw - 64px), 360px',
  widths: [320, 360, 480, 640, 720],
};

export function VenueCard({ venue: v, dateLabel }: { venue: VenueView; dateLabel?: string }) {
  const windows = v.nextWindows;
  return (
    <Link to={`/venues/${v.id}`} className={styles.card} aria-label={`${v.name}, ${v.address}`}>
      <div className={styles.cardMedia}>
        {v.photoUrl ? (
          <img {...imageAttrs(v.photoUrl, VENUE_CARD_IMAGE)} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles.cardFallback} aria-hidden>
            {v.sports[0] && <SportIcon sport={v.sports[0]} size={48} weight="regular" />}
          </span>
        )}
        <span className={styles.cardKind}>
          {v.kindLabel}
          {v.indoor ? ', крытая' : ', открытая'}
        </span>
      </div>
      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>{v.name}</h3>
        <p className={styles.cardPlace}>
          <MapPinIcon size={16} aria-hidden />
          <span>
            {v.address}
            {v.districtName && `, район ${v.districtName}`}
            {v.distanceKm !== null && `, ${formatDistance(v.distanceKm)} от вас`}
          </span>
        </p>
        <p className={styles.cardSports}>{v.sports.map((s) => s.name).join(', ')}</p>
        <p className={styles.cardPrice}>{venuePriceLine(v)}</p>
        <FeatureTags features={v.features} onlyAccess max={4} />
        <div className={styles.cardWindows}>
          <CalendarCheckIcon size={18} aria-hidden />
          {windows.length ? (
            <span>
              <b>Свободно{dateLabel ? ` ${dateLabel}` : ''}:</b>{' '}
              {windows.map((w) => windowShort(w, v.timeZone)).join('; ')}
            </span>
          ) : (
            <span>Свободных окон{dateLabel ? ` ${dateLabel}` : ' на две недели'} нет</span>
          )}
        </div>
        <p className={styles.cardUpdated}>{updatedLabel(v.ownerUpdatedDays)}</p>
      </div>
    </Link>
  );
}
