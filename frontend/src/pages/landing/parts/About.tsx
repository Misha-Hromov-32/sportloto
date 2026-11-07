import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';

import { SportIcon } from '@/components';
import { useAiFeature } from '@/lib/aiFeatures';
import { API, useAction } from '@/lib/api';
import { selectedCityId } from '@/lib/cities';
import { dayLabel, formatTime } from '@/lib/dates';
import { imageAttrs } from '@/lib/images';
import { EVENT_LEVEL } from '@/lib/labels';
import type { EventView, MatchItem, MatchResult } from '@/types/api';

import { FEATURES, SHOWCASE_IMAGE } from './content';
import { cx } from './cx';
import styles from './Landing.module.css';
import type { LandingData } from './useLandingData';
import { usePhraseSearch } from './usePhraseSearch';

const MATCH_DELAY_MS = 600;

/** Запасной подбор без помощника: совпадение слов запроса с названием, направлением и районом. */
function localMatch(events: EventView[], text: string): EventView | null {
  const words = text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, Math.max(3, w.length - 2)));
  if (!words.length) return null;
  const score = (e: EventView) => {
    const hay = `${e.title} ${e.sport.name} ${e.districtName ?? ''}`.toLowerCase().replace(/ё/g, 'е');
    return words.filter((w) => hay.includes(w)).length;
  };
  const best = events.map((e) => ({ e, s: score(e) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s > 0 ? best.e : null;
}

/**
 * Живой подбор на главной: человек пишет, что ищет, и карточка справа снизу
 * сразу показывает подходящую реальную встречу с объяснением. Пустое поле — ближайшая встреча для новичков.
 */
function useShowcaseMatch(events: EventView[]) {
  const searchOn = useAiFeature('search');
  const { run } = useAction<MatchResult>();
  const [text, setText] = useState('');
  const [state, setState] = useState<{
    phrase: string;
    item: MatchItem | null;
    understood: string[];
    fallback: boolean;
    /** Точного совпадения нет — показываем ближайшую похожую встречу. */
    near: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const phrase = text.trim();
    const n = ++request.current;
    if (phrase.length < 3) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        if (!searchOn) throw new Error('Подбор выключен: ищем по словам');
        const res = await run(
          API.assistantMatch,
          { text: phrase, steps: [], cityId: selectedCityId() },
          { silent: true },
        );
        if (n !== request.current) return;
        const exact = res.items[0] ?? null;
        const near = exact ? null : localMatch(events, phrase);
        setState({
          phrase,
          item: exact ?? (near ? { event: near, why: [] } : null),
          understood: res.understood,
          fallback: false,
          near: !exact && Boolean(near),
        });
      } catch {
        if (n !== request.current) return;
        const event = localMatch(events, phrase);
        setState({
          phrase,
          item: event ? { event, why: [] } : null,
          understood: [],
          fallback: searchOn,
          near: false,
        });
      } finally {
        if (n === request.current) setLoading(false);
      }
    }, MATCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, run, events, searchOn]);

  return { text, setText, state, loading };
}

export function About({ data }: { data: LandingData }) {
  const fallbackSample = data.upcoming.find((e) => e.beginnersWelcome) ?? data.upcoming[0];
  const { text, setText, state, loading } = useShowcaseMatch(data.upcoming);
  const search = usePhraseSearch();
  const inputId = useId();
  const matched = state?.item ?? null;
  // Дата и время уже есть в карточке — в «почему подходит» показываем первую другую причину.
  const why = matched?.why.find((w) => !/\d{1,2}:\d{2}/.test(w)) ?? null;
  const sample = state ? matched?.event : fallbackSample;
  const chips = state?.understood.length
    ? state.understood.slice(0, 3)
    : sample
      ? [sample.sport.name, dayLabel(sample.startsAt), EVENT_LEVEL[sample.level]]
      : [];

  return (
    <section className={styles.section} id="about" aria-labelledby="about-title">
      <div className={styles.container}>
        <div className={styles.showcase}>
          <img
            className={styles.showcase__img}
            data-reveal="media"
            {...SHOWCASE_IMAGE}
            alt="Три подруги смеются на пробежке в парке"
            loading="lazy"
            decoding="async"
          />
          <div className={styles.showcase__head} data-reveal="title">
            <h2 id="about-title" className={styles.h2}>
              Своя компания
              <br />
              для любого спорта
            </h2>
            <p className={styles.lead}>
              Здесь публикуют тренировки, игры и другие спортивные встречи в вашем городе. Выберите занятие и
              посмотрите, где собираются участники.
            </p>
          </div>
          <div className={styles.showcase__panel} data-reveal="" data-motion-delay="120">
            <form
              className={styles.showcase__search}
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                void search.submit(text);
              }}
            >
              <label htmlFor={inputId} className="sr-only">
                Что вы ищете в городе {data.city.name}
              </label>
              <div className={styles['mini-input']}>
                <MagnifyingGlassIcon size={18} aria-hidden />
                <input
                  id={inputId}
                  type="search"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Например, волейбол в субботу"
                  autoComplete="off"
                  enterKeyHint="search"
                />
              </div>
              {chips.length > 0 && (
                <div className={styles['mini-chips']} aria-hidden>
                  {chips.map((c, i) => (
                    <span key={c} className={i === 0 ? styles['is-on'] : undefined}>
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </form>

            <div
              className={cx('showcase__event', loading && 'showcase__event--loading')}
              aria-live="polite"
              aria-busy={loading}
            >
              {sample ? (
                <Link to={`/events/${sample.id}`} className={styles['showcase__event-link']}>
                  <div className={styles['showcase__event-head']}>
                    {loading
                      ? 'Подбираем…'
                      : state?.near
                        ? 'Точно такого нет. Ближе всего:'
                        : state
                          ? 'Подходит вам'
                          : dayLabel(sample.startsAt)}
                  </div>
                  <div className={styles['showcase__event-row']}>
                    {sample.coverUrl ? (
                      <img
                        {...imageAttrs(sample.coverUrl, { width: 52, height: 52 })}
                        alt=""
                        decoding="async"
                      />
                    ) : (
                      <span className={styles['showcase__event-icon']}>
                        <SportIcon sport={sample.sport} size={24} />
                      </span>
                    )}
                    <div>
                      <b>{sample.title}</b>
                      <small>
                        {dayLabel(sample.startsAt)}, {formatTime(sample.startsAt)} ·{' '}
                        {sample.districtName ?? sample.place.address}
                      </small>
                    </div>
                  </div>
                  {why && <p className={styles['showcase__event-why']}>{why}</p>}
                  <div className={styles['showcase__event-tags']}>
                    <span className={styles.tag}>
                      {sample.beginnersWelcome ? 'Рады новичкам' : EVENT_LEVEL[sample.level]}
                    </span>
                    <span className={cx('tag', sample.joinMode === 'open' ? 'tag--green' : 'tag--amber')}>
                      {sample.joinMode === 'open' ? 'Свободная запись' : 'По заявке'}
                    </span>
                  </div>
                </Link>
              ) : state ? (
                <div className={styles['showcase__event-empty']}>
                  <div className={styles['showcase__event-head']}>
                    {loading ? 'Подбираем…' : `Пока нет встреч по запросу «${state.phrase}»`}
                  </div>
                  <p>Создайте свою, другие увидят её в поиске.</p>
                  <Link to="/events/new">Создать встречу</Link>
                </div>
              ) : null}
              {state && !loading && (
                <button
                  type="button"
                  className={styles['showcase__event-more']}
                  onClick={() => void search.submit(text)}
                >
                  {matched && !state.near && !state.fallback ? 'Все подходящие варианты' : 'Открыть поиск'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className={styles.features} data-stagger="">
          {FEATURES.map((f) => (
            <article key={f.key} className={styles.feature}>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
