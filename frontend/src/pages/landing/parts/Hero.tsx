import { ArrowUpRightIcon, CalendarCheckIcon, MapPinIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { ErrorState, SkeletonBlock, SportIcon } from '@/components';
import { useAiFeature } from '@/lib/aiFeatures';
import { dayLabel, formatDayMonth, formatTime } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { boxedImageAttrs, imageAttrs } from '@/lib/images';

import { photo, STRIP, STRIP_BOXES } from './content';
import { cx } from './cx';
import { MarqueePauseButton } from './marqueePause';
import { useMarqueePaused } from './marqueeStore';
import styles from './Landing.module.css';
import type { LandingData } from './useLandingData';

/** Высота блока фиксирована, а картинка растягивается по ширине: фото не обрезаем. */
const NEXT_EVENT_IMAGE = {
  width: 400,
  height: 267,
  crop: false,
  sizes: '(max-width: 900px) min(calc(100vw - 56px), 460px), 400px',
  widths: [320, 400, 480, 640, 800, 960],
};

export function Hero({ data, createTo }: { data: LandingData; createTo: string }) {
  const next = data.upcoming[0];
  const mcpOn = useAiFeature('mcp');

  return (
    <section className={styles.hero} id="top" aria-labelledby="hero-title">
      <div className={cx('container', 'hero__grid')}>
        <div className={styles.hero__copy}>
          <h1 data-reveal="" id="hero-title" className={cx('display', 'hero__title')}>
            Найдите компанию
            <br />
            для спорта
          </h1>
          <div className={styles.hero__text} data-reveal="">
            <p className={styles.hero__lead}>
              Выберите занятие и запишитесь. В карточке сразу видно, где и когда собираются и кто ещё придёт.
            </p>
            <div className={styles.hero__actions}>
              <Link to="/events" className={cx('btn', 'btn--red', 'btn--lg')}>
                Найти встречу
              </Link>
              {mcpOn && (
                <Link
                  to="/settings/assistant"
                  className={cx('btn', 'btn--outline', 'btn--lg')}
                  title="Подключить своего ИИ-ассистента к сайту по протоколу MCP"
                >
                  MCP-сервер
                </Link>
              )}
            </div>
          </div>
        </div>
        {data.eventsLoading ? (
          <div className={styles.hero__event} data-reveal="" aria-hidden>
            <SkeletonBlock height={370} />
          </div>
        ) : data.eventsError ? (
          <article data-reveal="" className={styles.hero__event}>
            <div className={styles.hero__eventCard}>
              <div className={styles.hero__eventHeader}>
                <span className={styles.hero__eventLabel}>Ближайшее событие</span>
                <span className={styles.hero__eventSport}>{data.city.name}</span>
              </div>
              <div className={styles.hero__eventEmpty}>
                <ErrorState onRetry={data.refetchEvents}>
                  Не удалось загрузить ближайшие события. Попробуйте ещё раз.
                </ErrorState>
              </div>
            </div>
          </article>
        ) : next ? (
          <article data-reveal="" className={styles.hero__event} aria-labelledby="hero-event-title">
            <Link to={`/events/${next.id}`} className={styles.hero__eventCard}>
              <div className={styles.hero__eventHeader}>
                <span className={styles.hero__eventLabel}>Ближайшее событие</span>
                <span className={styles.hero__eventSport}>
                  <SportIcon sport={next.sport} size={16} aria-hidden />
                  {next.sport.name}
                </span>
              </div>
              <div className={styles.hero__eventMedia}>
                {next.coverUrl ? (
                  <img
                    {...imageAttrs(next.coverUrl, NEXT_EVENT_IMAGE)}
                    alt=""
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                  />
                ) : (
                  <SportIcon sport={next.sport} size={40} aria-hidden />
                )}
                <time dateTime={next.startsAt} className={styles.hero__eventDate}>
                  <CalendarCheckIcon size={17} aria-hidden />
                  <span>
                    {dayLabel(next.startsAt)}, {formatDayMonth(next.startsAt)}
                    <span className={styles.hero__eventTime}>{formatTime(next.startsAt)}</span>
                  </span>
                </time>
              </div>
              <div className={styles.hero__eventBody}>
                <h2 id="hero-event-title">{next.title}</h2>
                <p className={styles.hero__eventPlace}>
                  <MapPinIcon size={16} aria-hidden />
                  <span>{next.place.address}</span>
                </p>
                <div className={styles.hero__eventFoot}>
                  <span className={styles.hero__eventAvailability}>
                    {next.counts.spotsLeft === null
                      ? count(next.counts.confirmed, WORDS.participant)
                      : next.counts.spotsLeft > 0
                        ? `Осталось ${count(next.counts.spotsLeft, WORDS.place)}`
                        : 'Мест нет'}
                  </span>
                  <span className={styles.hero__eventAction}>
                    Открыть
                    <span>
                      <ArrowUpRightIcon size={18} weight="bold" aria-hidden />
                    </span>
                  </span>
                </div>
              </div>
            </Link>
          </article>
        ) : (
          <article data-reveal="" className={styles.hero__event} aria-labelledby="hero-event-title">
            <div className={styles.hero__eventCard}>
              <div className={styles.hero__eventHeader}>
                <span className={styles.hero__eventLabel}>Ближайшее событие</span>
                <span className={styles.hero__eventSport}>{data.city.name}</span>
              </div>
              <div className={styles.hero__eventEmpty}>
                <h2 id="hero-event-title">В {data.city.in} пока нет событий</h2>
                <p>Создайте первую встречу, другие увидят её в поиске.</p>
                <Link to={createTo} className={cx('btn', 'btn--red')}>
                  Создать встречу
                </Link>
              </div>
            </div>
          </article>
        )}
      </div>

      <PhotoStrip />
    </section>
  );
}

function PhotoStrip() {
  const paused = useMarqueePaused();
  return (
    <>
      <div className={cx('strip', paused && 'strip--paused')} aria-label="Фотографии с совместных тренировок">
        <div className={styles.strip__track}>
          {[0, 1].map((copy) =>
            STRIP.map((p) => (
              <figure
                key={`${copy}-${p.id}`}
                className={cx('strip__item', `strip__item--${p.size}`)}
                aria-hidden={copy === 1 || undefined}
              >
                <img
                  {...boxedImageAttrs(photo(p.id), p.ratio, STRIP_BOXES[p.size])}
                  alt={copy === 0 ? p.alt : ''}
                  loading="lazy"
                  decoding="async"
                />
              </figure>
            )),
          )}
        </div>
      </div>
      <div className={cx('container', 'hero__controls')}>
        <MarqueePauseButton />
      </div>
    </>
  );
}

export function SportsTicker({ data }: { data: LandingData }) {
  const names = data.sports.map((s) => s.name).concat('Ваш вариант');
  if (data.sportsLoading) return <div className={styles.ticker} style={{ minHeight: 40 }} />;
  const row = (copy: number) => names.map((n) => <span key={`${copy}-${n}`}>{n}</span>);
  return (
    <div className={styles.ticker}>
      <span className={styles.ticker__label}>Виды спорта</span>
      <div className={styles.ticker__viewport}>
        <p className="sr-only">{names.join(', ')}</p>
        <div className={styles.ticker__track} aria-hidden>
          {row(0)}
          {row(1)}
        </div>
      </div>
    </div>
  );
}
