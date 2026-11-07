import { SportIcon } from '@/components';
import { dayjs } from '@/lib/dates';
import { count } from '@/lib/plural';

import type { TriedItem } from './groups';

import styles from './TriedCollection.module.css';

const MEETING_WORDS = ['занятие', 'занятия', 'занятий'] as const;

/** Спокойная коллекция «Попробовано»: без очков, уровней и сравнения с другими. */
export function TriedCollection({ items }: { items: TriedItem[] }) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.sport.id} className={styles.item}>
          <SportIcon sport={item.sport} size={22} variant="framed" />
          <span className={styles.text}>
            <span className={styles.name}>{item.sport.name}</span>
            <span className={styles.meta}>
              {count(item.times, MEETING_WORDS)}, впервые {dayjs(item.firstAt).format('D MMMM')}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
