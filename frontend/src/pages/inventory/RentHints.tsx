import { StorefrontIcon } from '@phosphor-icons/react';

import styles from './inventory.module.css';
import { RENT_HINTS } from './labels';

/** Если на полке ничего нет: куда ещё можно обратиться. Подсказки, а не реклама. */
export function RentHints({ title = 'Если ни у кого нет' }: { title?: string }) {
  return (
    <section className={styles.hints} aria-labelledby="rent-hints-title">
      <h3 id="rent-hints-title" className={styles.hintsTitle}>
        <StorefrontIcon size={20} aria-hidden />
        {title}
      </h3>
      <ul className={styles.hintsList}>
        {RENT_HINTS.map((h) => (
          <li key={h.title}>
            <b>{h.title}</b>
            <span>{h.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
