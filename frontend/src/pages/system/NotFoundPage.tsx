import { MagnifyingGlassIcon } from '@phosphor-icons/react';

import { Button } from '@/components';
import { SportsPattern } from '../landing/parts/SportsPattern';
import styles from './NotFoundPage.module.css';

export default function NotFoundPage() {
  return (
    <section className={styles.page} aria-labelledby="not-found-title">
      <SportsPattern />
      <div className={styles.copy}>
        <h1 id="not-found-title">
          Такой страницы нет<span>.</span>
        </h1>
        <p className={styles.lead}>
          Возможно, ссылка устарела или в адресе опечатка. Найти встречу можно в каталоге занятий.
        </p>
        <div className={styles.actions}>
          <Button variant="primary" to="/events" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
            Найти встречу
          </Button>
          <Button variant="secondary" to="/">
            На главную
          </Button>
        </div>
      </div>
      <div className={styles.sign} aria-hidden>
        <span className={styles.code}>
          404<span>.</span>
        </span>
      </div>
    </section>
  );
}
