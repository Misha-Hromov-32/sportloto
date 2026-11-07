import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { ErrorState, PhraseSearch, SkeletonBlock, SportIcon } from '@/components';
import { dayLabel, formatTime } from '@/lib/dates';
import { imageAttrs } from '@/lib/images';
import { EVENT_LEVEL, PARTICIPATION_STATUS } from '@/lib/labels';
import { count, WORDS } from '@/lib/plural';
import type { EventView } from '@/types/api';
import type { JoinMode } from '@/types/domain';

import { cx } from './cx';
import styles from './Landing.module.css';
import type { LandingData } from './useLandingData';
import { usePhraseSearch } from './usePhraseSearch';

type ModeFilter = 'all' | JoinMode;

const LIMIT = 8;
const SPORT_CHIPS = 8;

const MODES: { value: ModeFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'open', label: 'Свободная запись' },
  { value: 'approval', label: 'По заявке' },
];

export function Events({ data, createTo }: { data: LandingData; createTo: string }) {
  const search = usePhraseSearch();
  const [district, setDistrict] = useState<string>('all');
  const [sport, setSport] = useState<string>('all');
  const [mode, setMode] = useState<ModeFilter>('all');

  const districts = useMemo(() => {
    const map = new Map<string, string>();
    data.week.forEach((e) => {
      if (e.place.districtId && e.districtName) map.set(e.place.districtId, e.districtName);
    });
    return [...map].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [data.week]);

  const inDistrict = data.week.filter((e) => district === 'all' || e.place.districtId === district);
  const sports = useMemo(() => {
    const byId = new Map<string, { sport: EventView['sport']; n: number }>();
    inDistrict.forEach((e) => {
      const item = byId.get(e.sport.id) ?? { sport: e.sport, n: 0 };
      item.n += 1;
      byId.set(e.sport.id, item);
    });
    return [...byId.values()]
      .sort((a, b) => b.n - a.n || a.sport.name.localeCompare(b.sport.name, 'ru'))
      .slice(0, SPORT_CHIPS)
      .map((x) => x.sport);
  }, [inDistrict]);
  const activeSport = sports.some((s) => s.id === sport) ? sport : 'all';
  const matched = inDistrict.filter(
    (e) => (activeSport === 'all' || e.sport.id === activeSport) && (mode === 'all' || e.joinMode === mode),
  );
  const list = matched.slice(0, LIMIT);

  return (
    <section className={cx('section', 'events')} id="events" aria-labelledby="events-title">
      <div className={styles.container}>
        <h2 id="events-title" className={styles.h2} data-reveal="title">
          Встречи в ближайшие 7 дней
          <br />
          <span className={styles['h2-accent']}>в {data.city.in}</span>
        </h2>
        <p className={styles.lead} data-reveal="">
          Выберите район и вид спорта. В карточке встречи можно прочитать условия, задать вопрос и записаться.
        </p>

        <div className={styles.filters} data-reveal="">
          <div className={styles.events__search}>
            <PhraseSearch
              value={search.value}
              onChange={search.setValue}
              onSubmit={(text) => void search.submit(text)}
              loading={search.loading}
              label={search.smart ? undefined : 'Что ищете'}
              placeholder={search.smart ? 'Например: волейбол в субботу, я новичок' : 'Например: волейбол'}
            />
          </div>
          <div className={styles.tabs} role="tablist" aria-label="Район">
            {[['all', 'Весь город'] as [string, string], ...districts].map(([id, name]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={district === id}
                onClick={() => setDistrict(id)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className={styles.filters__row}>
            <div className={styles.chips} aria-label="Вид спорта" role="group">
              <button type="button" aria-pressed={activeSport === 'all'} onClick={() => setSport('all')}>
                Все виды
              </button>
              {sports.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={activeSport === s.id}
                  onClick={() => setSport(s.id)}
                >
                  <SportIcon sport={s} size={18} />
                  {s.name}
                </button>
              ))}
            </div>
            <div className={styles.segmented} role="radiogroup" aria-label="Режим записи">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => setMode(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          className={styles['event-grid']}
          data-stagger=""
          aria-live="polite"
          aria-busy={data.eventsLoading}
        >
          {data.eventsLoading ? (
            [0, 1, 2].map((i) => (
              <div key={i} className={cx('event', 'event--skeleton')} aria-hidden>
                <SkeletonBlock height={200} radius="media" />
                <div style={{ display: 'grid', gap: 12, padding: 12 }}>
                  <SkeletonBlock width="40%" height={14} />
                  <SkeletonBlock width="85%" height={22} />
                  <SkeletonBlock width="60%" height={14} />
                </div>
              </div>
            ))
          ) : data.eventsError ? (
            <div className={styles.empty}>
              <ErrorState onRetry={data.refetchEvents}>
                Не удалось загрузить события. Проверьте интернет и нажмите «Повторить».
              </ErrorState>
            </div>
          ) : list.length === 0 ? (
            <div className={styles.empty}>
              <h3>Подходящих событий пока нет</h3>
              <p>Попробуйте другой вид спорта или способ записи. Или создайте свою встречу.</p>
              <div className={cx('btn-row', 'btn-row--center')}>
                <Link to={createTo} className={cx('btn', 'btn--red')}>
                  Создать встречу
                </Link>
              </div>
            </div>
          ) : (
            <>
              {list.map((e) => (
                <EventTile key={e.id} event={e} />
              ))}
              <div className={cx('event', 'event--create')}>
                <h3>Не нашли подходящее?</h3>
                <p>
                  Создайте встречу и укажите вид спорта. Если его нет в каталоге, впишите название. Выберите
                  свободную запись или приём заявок.
                </p>
                <Link to={createTo} className={cx('btn', 'btn--red')}>
                  Создать встречу
                </Link>
              </div>
            </>
          )}
        </div>

        <div className={styles.events__legend}>
          <span>
            <i className={cx('dot', 'dot--green')} aria-hidden />
            Свободная запись: вы сразу в составе
          </span>
          <span>
            <i className={cx('dot', 'dot--amber')} aria-hidden />
            По заявке: организатор подтверждает участие
          </span>
        </div>
        <div className={styles.events__more}>
          <Link to="/events" className={cx('btn', 'btn--outline')}>
            {data.eventsTotal > 0
              ? `Все ${count(data.eventsTotal, WORDS.event)} и фильтры`
              : 'Все события и фильтры'}
          </Link>
        </div>
      </div>
    </section>
  );
}

const TILE_IMAGE = {
  width: 400,
  height: 225,
  sizes:
    '(max-width: 640px) calc(100vw - 32px), (max-width: 1100px) calc(50vw - 40px), min(calc(33vw - 72px), 500px)',
  widths: [360, 480, 640, 720, 800, 1000],
};

function EventTile({ event: e }: { event: EventView }) {
  const when = `${dayLabel(e.startsAt)}, ${formatTime(e.startsAt)}`;
  const mine = e.my ? PARTICIPATION_STATUS[e.my.status] : null;
  return (
    <Link to={`/events/${e.id}`} className={styles.event} aria-label={`${e.title}, ${when}`}>
      <div className={styles.event__media}>
        {e.coverUrl ? (
          <img {...imageAttrs(e.coverUrl, TILE_IMAGE)} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles['event__media-fallback']}>
            <SportIcon sport={e.sport} size={56} weight="regular" />
          </span>
        )}
        <span className={cx('tag', e.joinMode === 'open' ? 'tag--green' : 'tag--amber')}>
          {e.joinMode === 'open' ? 'Свободная запись' : 'По заявке'}
        </span>
      </div>
      <div className={styles.event__body}>
        <span className={styles.event__when}>{when}</span>
        <span className={styles.event__title}>{e.title}</span>
        <span className={styles.event__place}>{e.place.address}</span>
        <Spots event={e} />
        <span className={styles.event__foot}>
          <span className={styles.event__tags}>
            <span className={styles.tag}>
              <SportIcon sport={e.sport} size={14} />
              {e.sport.name}
            </span>
            <span className={styles.tag}>{e.beginnersWelcome ? 'Рады новичкам' : EVENT_LEVEL[e.level]}</span>
            {mine && (
              <span
                className={cx(
                  'tag',
                  mine.tone === 'ok' ? 'tag--dark' : mine.tone === 'wait' ? 'tag--amber' : undefined,
                )}
              >
                {mine.label}
              </span>
            )}
          </span>
        </span>
      </div>
    </Link>
  );
}

function Spots({ event: e }: { event: EventView }) {
  const { confirmed, spotsLeft } = e.counts;
  if (!e.capacity) {
    return (
      <div className={styles.spots}>
        <small>Записалось: {count(confirmed, WORDS.person)}, мест без ограничения</small>
      </div>
    );
  }
  const left = spotsLeft ?? 0;
  const hot = left <= 3;
  const pct = Math.min(100, Math.round((confirmed / e.capacity) * 100));
  return (
    <div className={cx('spots', hot && 'spots--hot')}>
      <div className={styles.spots__bar}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <small>
        {left > 0
          ? `${confirmed} из ${e.capacity}, ${hot ? 'осталось' : 'свободно'} ${count(left, WORDS.place)}`
          : 'Мест нет, можно встать в лист ожидания'}
      </small>
    </div>
  );
}
