import { CheckIcon, MinusIcon } from '@phosphor-icons/react';

import { ACCESS_EXTRA, VENUE_FEATURE, VENUE_FEATURES } from '@/lib/venues';
import type { EventAccessExtra, VenueFeature } from '@/types/domain';

import { EXTRA_ICON, FEATURE_ICON } from './icons';
import styles from './venues.module.css';

/** Короткие метки условий: значок и слово, без опоры только на цвет. */
export function FeatureTags({
  features,
  extras = [],
  onlyAccess = false,
  max,
}: {
  features: VenueFeature[];
  extras?: EventAccessExtra[];
  onlyAccess?: boolean;
  max?: number;
}) {
  const list = features.filter((f) => !onlyAccess || VENUE_FEATURE[f].access);
  const items = [
    ...extras.map((x) => ({ key: x, Icon: EXTRA_ICON[x], label: ACCESS_EXTRA[x].label })),
    ...list.map((f) => ({ key: f, Icon: FEATURE_ICON[f], label: VENUE_FEATURE[f].short })),
  ];
  if (!items.length) return null;
  const shown = max ? items.slice(0, max) : items;
  const rest = items.length - shown.length;
  return (
    <ul className={styles.featureTags} aria-label="Условия">
      {shown.map(({ key, Icon: I, label }) => (
        <li key={key} className={styles.featureTag}>
          <I size={16} aria-hidden />
          {label}
        </li>
      ))}
      {rest > 0 && <li className={styles.featureMore}>ещё {rest}</li>}
    </ul>
  );
}

/** Полный список условий площадки: что есть и чего нет — словами. */
export function FeatureList({ features }: { features: VenueFeature[] }) {
  return (
    <ul className={styles.featureList}>
      {VENUE_FEATURES.map((f) => {
        const has = features.includes(f);
        const I = FEATURE_ICON[f];
        return (
          <li key={f} className={[styles.featureRow, !has && styles.featureNo].filter(Boolean).join(' ')}>
            <I size={22} aria-hidden />
            <span>{VENUE_FEATURE[f].label}</span>
            <span className={styles.featureMark}>
              {has ? <CheckIcon size={18} weight="bold" aria-hidden /> : <MinusIcon size={18} aria-hidden />}
              {has ? 'есть' : 'нет'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
