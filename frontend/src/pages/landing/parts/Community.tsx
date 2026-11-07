import { CaretLeftIcon, CaretRightIcon, SealCheckIcon } from '@phosphor-icons/react';
import { useDataProvider } from '@refinedev/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { Link } from 'react-router';

import { SportIcon } from '@/components';
import { useLiveRefetch } from '@/lib/api';
import { imageAttrs } from '@/lib/images';
import { count, WORDS } from '@/lib/plural';
import type { EventView, MessageView, OrganizerView, SportView } from '@/types/api';

import { cx } from './cx';
import { MarqueePauseButton } from './marqueePause';
import styles from './Landing.module.css';
import type { LandingData } from './useLandingData';

interface Organizer {
  view: OrganizerView;
  cover: string | null;
  sports: SportView[];
  events: number;
}

const COMMUNITY_IMAGE = {
  width: 240,
  height: 320,
  sizes: '(max-width: 640px) 240px, 300px',
  widths: [240, 300, 480, 600],
};

export function Communities({ data }: { data: LandingData }) {
  const track = useRef<HTMLDivElement>(null);
  const organizers = useMemo(() => {
    const map = new Map<string, Organizer>();
    data.upcoming.forEach((e) => {
      const key = `${e.organizerView.kind}:${e.organizerView.id}`;
      const o = map.get(key) ?? { view: e.organizerView, cover: null, sports: [], events: 0 };
      o.events += 1;
      if (!o.cover && e.coverUrl) o.cover = e.coverUrl;
      if (!o.sports.some((s) => s.id === e.sport.id)) o.sports.push(e.sport);
      map.set(key, o);
    });
    return [...map.values()]
      .sort((a, b) => Number(b.view.verified) - Number(a.view.verified) || b.events - a.events)
      .slice(0, 8);
  }, [data.upcoming]);

  if (!data.eventsLoading && organizers.length === 0) return null;

  const scroll = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const step = (el.firstElementChild?.getBoundingClientRect().width ?? 300) + 16;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  return (
    <section className={cx('section', 'section--tight')} aria-labelledby="community-title">
      <div className={styles.container}>
        <div className={styles['section-head']} data-reveal="title">
          <div>
            <h2 id="community-title" className={styles.h2}>
              Кто проводит
              <br />
              занятия
            </h2>
            <p className={styles.lead}>
              Клубы, секции и соседи, которые собирают людей на ближайшие события.
            </p>
          </div>
          <div className={styles['carousel-nav']}>
            <button
              type="button"
              className={styles['round-btn']}
              aria-label="Назад"
              onClick={() => scroll(-1)}
            >
              <CaretLeftIcon size={22} aria-hidden />
            </button>
            <button
              type="button"
              className={styles['round-btn']}
              aria-label="Вперёд"
              onClick={() => scroll(1)}
            >
              <CaretRightIcon size={22} aria-hidden />
            </button>
          </div>
        </div>
        <div
          ref={track}
          className={styles.communities}
          data-stagger=""
          aria-label="Организаторы ближайших событий"
        >
          {organizers.map((o) => (
            <Link
              key={`${o.view.kind}:${o.view.id}`}
              to={o.view.link}
              className={styles.community}
              data-theme="dark"
            >
              {o.cover ? (
                <img {...imageAttrs(o.cover, COMMUNITY_IMAGE)} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className={styles.community__fallback}>
                  <SportIcon sport={o.sports[0]!} size={64} weight="regular" />
                </span>
              )}
              <span className={styles.community__text}>
                <b>
                  {o.view.name}
                  {o.view.verified && (
                    <SealCheckIcon size={20} weight="fill" aria-label="Организация проверена" />
                  )}
                </b>
                <small>
                  {o.sports
                    .slice(0, 2)
                    .map((s) => s.name)
                    .join(', ')}
                  , {count(o.events, WORDS.event)} в ленте
                </small>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

interface QaPair {
  id: string;
  event: EventView;
  question: string;
  asker: string;
  answer: string;
  answerer: string;
}

/** Вместо выдуманных отзывов — настоящие вопросы и ответы организаторов из обсуждений ближайших событий. */
export function Questions({ data }: { data: LandingData }) {
  const getDataProvider = useDataProvider();
  const events = data.upcoming.slice(0, 12);
  const ids = events.map((e) => e.id).join(',');

  const query = useQuery({
    queryKey: ['messages', 'landing-qa', ids],
    enabled: events.length > 0,
    queryFn: async () => {
      const dp = getDataProvider();
      const lists = await Promise.all(
        events.map((e) =>
          dp
            .getList<MessageView>({
              resource: 'messages',
              filters: [{ field: 'eventId', operator: 'eq', value: e.id }],
              pagination: { mode: 'off' },
            })
            .then((r) => ({ event: e, messages: r.data }))
            .catch(() => ({ event: e, messages: [] as MessageView[] })),
        ),
      );
      const pairs: QaPair[] = [];
      lists.forEach(({ event, messages }) => {
        messages
          .filter((m) => m.author?.isOrganizer && m.replyTo && m.text)
          .slice(0, 2)
          .forEach((answer) => {
            const q = messages.find((m) => m.id === answer.replyTo);
            if (!q?.text || q.author?.isOrganizer) return;
            pairs.push({
              id: answer.id,
              event,
              question: q.text,
              asker: q.author?.name.split(' ')[0] ?? 'Участник',
              answer: answer.text!,
              answerer: answer.author?.orgName ?? answer.author?.name ?? 'Организатор',
            });
          });
      });
      return pairs;
    },
  });
  useLiveRefetch(['messages'], () => void query.refetch());

  const pairs = query.data ?? [];
  if (pairs.length < 2) return null;

  const half = Math.ceil(pairs.length / 2);
  const rows = [pairs.slice(0, half), pairs.slice(half)].filter((r) => r.length);
  // Строка должна быть шире экрана, иначе бегущая лента покажет пустоту.
  const fill = (row: QaPair[]) =>
    Array.from({ length: Math.max(1, Math.ceil(6 / row.length)) }, () => row).flat();

  return (
    <section className={cx('section', 'reviews')} aria-labelledby="qa-title">
      <div className={styles.container}>
        <h2 id="qa-title" className={cx('h2', 'h2--quote')} data-reveal="title">
          Спросите заранее,
          <br />
          организатор ответит
        </h2>
        <div className={styles['section-head']}>
          <p className={styles.lead}>
            Вопросы участников и ответы организаторов из обсуждений ближайших событий.
          </p>
          <MarqueePauseButton />
        </div>
      </div>
      {rows.map((row, r) => (
        <div
          key={r}
          className={cx('marquee', r === 1 && 'marquee--reverse')}
          data-reveal="side"
          data-motion-delay={r * 150}
        >
          {[0, 1].map((copy) => (
            <div key={copy} className={styles.marquee__set} aria-hidden={copy === 1 || undefined}>
              {fill(row).map((p, i) => (
                <Link
                  key={`${p.id}-${i}`}
                  to={`/events/${p.event.id}`}
                  className={styles.review}
                  tabIndex={copy === 1 || i >= row.length ? -1 : undefined}
                >
                  <p className={styles.review__q}>
                    {p.asker}: «{p.question}»
                  </p>
                  <div className={styles.review__a}>
                    <b>
                      {p.answerer} <em>Организатор</em>
                    </b>
                    <p>{p.answer}</p>
                  </div>
                  <footer>
                    <b>{p.event.title}</b>
                    {p.event.sport.name}
                  </footer>
                </Link>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
