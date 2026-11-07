import type { CSSProperties } from 'react';

import styles from './Skeleton.module.css';

/** Плоская плашка на месте будущего значения. Без мерцаний: раскладка не прыгает, когда данные пришли. */
export function SkeletonBlock({
  width = '100%',
  height = 16,
  radius = 'card',
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: 'card' | 'pill' | 'media';
  style?: CSSProperties;
}) {
  return (
    <span
      className={[styles.block, styles[`r-${radius}`]].join(' ')}
      style={{ width, height, ...style }}
      aria-hidden
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className={styles.text} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBlock key={i} height={14} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </span>
  );
}

/** Скелетон карточки события той же формы, что и EventCard row. */
export function EventCardSkeleton() {
  return (
    <div className={styles.card} aria-hidden>
      <SkeletonBlock width={64} height={84} />
      <div className={styles.cardBody}>
        <SkeletonBlock width={120} height={14} />
        <SkeletonBlock width="80%" height={22} />
        <SkeletonBlock width="55%" height={14} />
        <SkeletonBlock width="65%" height={14} />
        <div className={styles.cardFoot}>
          <SkeletonBlock width={140} height={20} />
          <SkeletonBlock width={72} height={20} />
        </div>
      </div>
    </div>
  );
}

export function ListSkeleton({ count = 3, label = 'Загружаем…' }: { count?: number; label?: string }) {
  return (
    <div className={styles.list} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <EventCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Скелетон страницы: заголовок и блоки текста. */
export function PageSkeleton({ label = 'Загружаем…' }: { label?: string }) {
  return (
    <div className={styles.page} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <SkeletonBlock width="40%" height={36} />
      <SkeletonBlock height={240} radius="media" />
      <SkeletonText lines={4} />
    </div>
  );
}
