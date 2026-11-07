import {
  ArrowCounterClockwiseIcon,
  FunnelSimpleIcon,
  ListBulletsIcon,
  PlusIcon,
  SignInIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';

import { Button, SportIcon } from '@/components';
import { imageAttrs } from '@/lib/images';
import { PARTICIPATION_STATUS } from '@/lib/labels';
import { count, WORDS } from '@/lib/plural';
import type { EventView } from '@/types/api';

import { Tag } from '../FeedCard';
import { whenShort } from '../filters';
import styles from './CardsMode.module.css';
import { waitlistOnly } from './cardsText';

const THUMB = { width: 96, height: 72 };
const ACTIVE = ['confirmed', 'pending', 'waitlist'];

interface CardsSummaryProps {
  total: number;
  saved: EventView[];
  joined: number;
  guest: boolean;
  createTo: string;
  onJoin: (event: EventView) => void;
  onRestart: () => void;
  onFilters: () => void;
  onList: () => void;
}

/** Итог стопки: отложенные с кнопкой записи и что делать дальше. */
export function CardsSummary({
  total,
  saved,
  joined,
  guest,
  createTo,
  onJoin,
  onRestart,
  onFilters,
  onList,
}: CardsSummaryProps) {
  const location = useLocation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus({ preventScroll: true });
  }, []);
  const back = `${location.pathname}${location.search}`;
  const title =
    total === 1 ? 'Вы посмотрели единственное событие' : `Вы посмотрели все ${count(total, WORDS.event)}`;

  return (
    <section className={styles.summary} aria-labelledby="deck-summary-title" data-motion="off">
      <h2 ref={headingRef} id="deck-summary-title" className={styles.summaryTitle} tabIndex={-1}>
        {title}
      </h2>
      {joined > 0 && (
        <p className={styles.summaryText}>
          Из стопки вы записались на {count(joined, WORDS.event)}. Они в разделе{' '}
          <Link to="/me">«Мои занятия»</Link>.
        </p>
      )}

      {saved.length > 0 ? (
        <>
          <h3 className={styles.savedTitle}>Отложенные: {saved.length}</h3>
          {guest && (
            <div className={styles.guestNote}>
              <p>Отложенные помнятся только в этой вкладке. Войдите, и они сохранятся в избранном.</p>
              <Button
                variant="primary"
                icon={<SignInIcon size={20} aria-hidden />}
                to={`/login?to=${encodeURIComponent(back)}`}
              >
                Войти или присоединиться
              </Button>
            </div>
          )}
          <ul className={styles.savedList}>
            {saved.map((e) => {
              const status = e.my && ACTIVE.includes(e.my.status) ? e.my.status : null;
              return (
                <li key={e.id} className={styles.savedItem}>
                  <span className={styles.thumb} aria-hidden>
                    {e.coverUrl ? (
                      <img {...imageAttrs(e.coverUrl, THUMB)} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <SportIcon sport={e.sport} size={28} />
                    )}
                  </span>
                  <span className={styles.savedBody}>
                    <Link to={`/events/${e.id}`} className={styles.savedName}>
                      {e.title}
                    </Link>
                    <span className={styles.savedWhen}>{whenShort(e.startsAt)}</span>
                    {!status && waitlistOnly(e) && <Tag tone="wait">Только лист ожидания</Tag>}
                  </span>
                  {status ? (
                    <Tag tone={status === 'confirmed' ? 'ok' : 'wait'}>
                      {PARTICIPATION_STATUS[status].label}
                    </Tag>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => onJoin(e)}>
                      Записаться
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className={styles.nothing}>
          <p className={styles.summaryText}>
            Ничего не приглянулось? Попробуйте другие фильтры или создайте свою встречу.
          </p>
          <Button variant="primary" icon={<PlusIcon size={20} weight="bold" aria-hidden />} to={createTo}>
            Создать встречу
          </Button>
        </div>
      )}

      <div className={styles.summaryActions}>
        <Button
          variant="secondary"
          icon={<ArrowCounterClockwiseIcon size={20} aria-hidden />}
          onClick={onRestart}
        >
          Начать заново
        </Button>
        <Button variant="secondary" icon={<FunnelSimpleIcon size={20} aria-hidden />} onClick={onFilters}>
          Изменить фильтры
        </Button>
        <Button variant="secondary" icon={<ListBulletsIcon size={20} aria-hidden />} onClick={onList}>
          Показать списком
        </Button>
      </div>
    </section>
  );
}
