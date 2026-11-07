import { Link } from 'react-router';

import { ORG_IMAGE, ROLES } from './content';
import { cx } from './cx';
import styles from './Landing.module.css';
import type { LandingData } from './useLandingData';

export function Roles({ orgTo, createTo }: { data: LandingData; orgTo: string; createTo: string }) {
  return (
    <section className={styles.section} id="orgs" aria-labelledby="roles-title">
      <div className={styles.container}>
        <h2 id="roles-title" className={styles.h2} data-reveal="title">
          Кто что делает
          <br />
          на сайте
        </h2>
        <p className={styles.lead} data-reveal="">
          Администратор проверяет заявки клубов и рассматривает жалобы на встречи и сообщения.
        </p>

        <div className={styles.roles} data-stagger="">
          {ROLES.map((r) => (
            <div key={r.title} className={styles.role}>
              <h3>{r.title}</h3>
              <p>{r.text}</p>
            </div>
          ))}
        </div>

        <div className={styles['org-panel']}>
          <img
            className={styles['org-panel__img']}
            data-reveal="media"
            {...ORG_IMAGE}
            alt="Тренер объясняет задание детской футбольной команде"
            loading="lazy"
            decoding="async"
          />
          <div className={styles['org-panel__text']} data-reveal="" data-motion-delay="120">
            <h3 className={styles.h3}>Ведёте клуб, секцию или&nbsp;сообщество?</h3>
            <p>Заведите страницу клуба. После проверки ваши встречи сразу появляются в ленте.</p>
            <div className={styles['btn-row']}>
              <Link to={orgTo} className={cx('btn', 'btn--red')}>
                Зарегистрировать клуб
              </Link>
              <Link to={createTo} className={cx('btn', 'btn--outline')}>
                Создать встречу от себя
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
