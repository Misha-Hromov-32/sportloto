import { PlusIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { Logo } from '@/components';
import { plural, WORDS } from '@/lib/plural';

import { FAQ, FAQ_IMAGE, FINAL_IMAGE } from './content';
import { cx } from './cx';
import styles from './Landing.module.css';
import type { LandingData } from './useLandingData';

export function Faq() {
  return (
    <section className={cx('section', 'faq')} id="faq" aria-labelledby="faq-title">
      <div className={styles.container}>
        <h2 id="faq-title" className={cx('h2', 'faq__heading')} data-reveal="title">
          Ответы на вопросы
        </h2>
      </div>
      <div className={cx('container', 'faq__grid')}>
        <div className={styles.faq__media} data-reveal="media">
          <img {...FAQ_IMAGE} alt="Групповое занятие йогой" loading="lazy" decoding="async" />
        </div>
        <div className={styles.faq__list} data-stagger="">
          {FAQ.map((f, i) => (
            <details key={f.q} className={styles['faq-item']} open={i === 0}>
              <summary>
                {f.q}
                <span className={styles['faq-item__icon']} aria-hidden>
                  <PlusIcon size={16} weight="bold" />
                </span>
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Final({ data, createTo }: { data: LandingData; createTo: string }) {
  const loading = data.eventsLoading || data.sportsLoading || data.orgsLoading;
  return (
    <section className={styles.final} data-theme="dark" aria-labelledby="final-title">
      <img className={styles.final__bg} {...FINAL_IMAGE} alt="" loading="lazy" decoding="async" />
      <div className={cx('container', 'final__inner')}>
        <h2 id="final-title" className={cx('display', 'final__title')} data-reveal="title">
          До встречи
          <br />
          на площадке
        </h2>
        <ul className={styles.stats} aria-busy={loading} data-reveal="" data-motion-delay="120">
          <li>
            <b>{loading || data.eventsError ? '–' : data.eventsTotal}</b>{' '}
            {plural(data.eventsTotal, WORDS.event)}, где идёт запись
          </li>
          <li>
            <b>{loading ? '–' : data.sports.length}</b>{' '}
            {plural(data.sports.length, ['вид спорта', 'вида спорта', 'видов спорта'])} в каталоге
          </li>
          <li>
            <b>{loading ? '–' : data.orgs.length}</b>{' '}
            {plural(data.orgs.length, [
              'проверенная организация',
              'проверенные организации',
              'проверенных организаций',
            ])}
          </li>
        </ul>
        <div className={styles['btn-row']}>
          <Link to="/events" className={cx('btn', 'btn--red', 'btn--lg')}>
            Найти встречу
          </Link>
          <Link to={createTo} className={cx('btn', 'btn--ghost-light', 'btn--lg')}>
            Создать встречу
          </Link>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter({
  createTo,
  orgTo,
  isGuest,
}: {
  createTo: string;
  orgTo: string;
  isGuest: boolean;
}) {
  return (
    <footer className={styles.footer}>
      <div className={styles.footer__card}>
        <div className={styles.footer__brand}>
          <Logo />
          <p>Здесь находят компанию для тренировок и игр в своём городе, а клубы собирают участников.</p>
          <Link className={styles.footer__contact} to="/rules">
            Правила и помощь
          </Link>
        </div>
        <nav className={styles.footer__cols} aria-label="Ссылки в подвале">
          <div>
            <h3>Участникам</h3>
            <Link to="/events">Найти встречу</Link>
            <Link to={createTo}>Создать встречу</Link>
            <a href="#how">Как это работает</a>
          </div>
          <div>
            <h3>Организациям</h3>
            <Link to={orgTo}>Подать заявку</Link>
            <a href="#orgs">Роли и модерация</a>
            <Link to="/rules">Правила платформы</Link>
          </div>
          <div>
            <h3>Платформа</h3>
            <a href="#about">О проекте</a>
            {isGuest ? <Link to="/login">Войти</Link> : <Link to="/settings">Настройки</Link>}
          </div>
        </nav>
        <div className={styles.footer__bottom}>
          <span>© 2026 «Спорт и точка»</span>
        </div>
      </div>
    </footer>
  );
}
