import { initials as toInitials } from '@/lib/text';

import styles from './Avatar.module.css';

interface AvatarProps {
  name: string;
  src?: string | null;
  initials?: string;
  size?: 32 | 40 | 48 | 56 | 96;
  /** Организация — квадрат со скруглением, человек — круг. */
  shape?: 'person' | 'org';
}

export function Avatar({ name, src, initials, size = 40, shape = 'person' }: AvatarProps) {
  const cls = [styles.avatar, shape === 'org' ? styles.org : styles.person].join(' ');
  const style = { width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.38)) };
  if (src) return <img className={cls} style={style} src={src} alt="" loading="lazy" />;
  return (
    <span className={cls} style={style} aria-hidden>
      {initials ?? toInitials(name)}
    </span>
  );
}

/** Ряд аватаров «кто идёт» с остатком «+5». */
export function AvatarStack({
  people,
  max = 5,
  size = 32,
}: {
  people: { name: string; initials?: string; avatarUrl?: string | null }[];
  max?: number;
  size?: 32 | 40;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={styles.stack}>
      {shown.map((p, i) => (
        <Avatar key={`${p.name}-${i}`} name={p.name} initials={p.initials} src={p.avatarUrl} size={size} />
      ))}
      {rest > 0 && (
        <span className={styles.rest} style={{ height: size, minWidth: size }}>
          +{rest}
        </span>
      )}
    </span>
  );
}
