import { imageAttrs } from '@/lib/images';
import type { GearKind } from '@/types/inventory';

import styles from './inventory.module.css';
import { GEAR_KIND, gearIcon } from './labels';

const CARD_IMAGE = { width: 360, height: 176 };

/** Фото вещи, а без фото — крупный значок по её типу на спокойном фоне и подпись типа. */
export function GearPicture({
  kind,
  name,
  photoUrl,
  size = 'card',
}: {
  kind: GearKind;
  name?: string;
  photoUrl?: string | null;
  size?: 'card' | 'row';
}) {
  const Icon = gearIcon(kind, name);
  if (size === 'row')
    return (
      <span className={styles.pictureRow} aria-hidden>
        <Icon size={24} />
      </span>
    );
  return (
    <div
      className={[styles.picture, photoUrl && styles.pictureWithPhoto].filter(Boolean).join(' ')}
      aria-hidden
    >
      {photoUrl ? (
        <img
          className={styles.picturePhoto}
          {...imageAttrs(photoUrl, CARD_IMAGE)}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : (
        <Icon size={56} weight="light" />
      )}
      <span className={styles.pictureKind}>{GEAR_KIND[kind].label}</span>
    </div>
  );
}
