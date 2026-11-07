import type { SportView } from '@/types/api';

import { SPORT_ICONS } from '../icons';
import styles from './SportIcon.module.css';

interface SportIconProps {
  sport: Pick<SportView, 'name' | 'icon'>;
  size?: number;
  /** framed — в квадрате с подложкой; plain — только пиктограмма. */
  variant?: 'framed' | 'plain';
  weight?: 'regular' | 'fill' | 'bold';
}

/** Иконка направления из каталога; у нового направления — монограмма по первой букве. */
export function SportIcon({ sport, size = 24, variant = 'plain', weight = 'fill' }: SportIconProps) {
  const Icon = sport.icon ? SPORT_ICONS[sport.icon] : undefined;
  const box = variant === 'framed' ? Math.round(size * 1.75) : size;

  if (!Icon) {
    return (
      <span
        className={styles.monogram}
        style={{ width: box, height: box, fontSize: Math.round(box * 0.56) }}
        aria-hidden
      >
        {sport.name.trim()[0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  if (variant === 'framed') {
    return (
      <span className={styles.frame} style={{ width: box, height: box }} aria-hidden>
        <Icon size={size} weight={weight} />
      </span>
    );
  }
  return <Icon size={size} weight={weight} aria-hidden className={styles.plain} />;
}
