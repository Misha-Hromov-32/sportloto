import { BuildingsIcon, CaretRightIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { VENUE_KIND } from '@/lib/venues';
import type { EventView } from '@/types/api';

import { FeatureTags } from '../../venues/parts/features';
import styles from './EventVenueBlock.module.css';

/** В4, Н1: на карточке события — площадка со ссылкой и условия доступной среды. */
export function EventVenueBlock({ event: e }: { event: EventView }) {
  const venue = e.venue ?? null;
  const access = e.access ?? { venue: [], extras: [] };
  const hasAccess = access.venue.length > 0 || access.extras.length > 0;
  if (!venue && !hasAccess) return null;
  return (
    <section className={styles.block} aria-labelledby="venue-title">
      <h2 id="venue-title" className={styles.title}>
        {venue ? 'Площадка' : 'Доступная среда'}
      </h2>
      {venue && (
        <Link to={`/venues/${venue.id}`} className={styles.venue}>
          <BuildingsIcon size={24} aria-hidden />
          <span className={styles.venueText}>
            <b>{venue.name}</b>
            <span className={styles.muted}>
              {VENUE_KIND[venue.kind]}. Свободные окна, условия и контакты площадки
            </span>
          </span>
          <CaretRightIcon size={20} aria-hidden />
        </Link>
      )}
      {hasAccess ? (
        <div className={styles.access}>
          {venue && <p className={styles.muted}>Для маломобильных гостей:</p>}
          <FeatureTags features={access.venue} extras={access.extras} />
        </div>
      ) : (
        <p className={styles.muted}>Условий для маломобильных гостей площадка не указала.</p>
      )}
    </section>
  );
}
