import { MapPinIcon, PlusIcon, SparkleIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { Select } from 'antd';
import { useList } from '@refinedev/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button, PhraseSearch } from '@/components';
import { API, useAction, useMe, type ApiError } from '@/lib/api';
import { cityLocationFilters } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import { useSettings } from '@/theme/useSettings';
import type { CategoryView, ParsedSearch, SportView } from '@/types/api';
import type { District } from '@/types/domain';

import styles from './feed/Feed.module.css';
import { ActiveFilters, FeedFilters } from './feed/FeedFilters';
import {
  activeKeys,
  EMPTY_FILTERS,
  fromAssistant,
  readFilters,
  writeFilters,
  type FeedFilters as Filters,
  type FilterKey,
} from './feed/filters';
import { Results } from './feed/Results';
import { Sections } from './feed/Sections';
import { ViewSwitch, type FeedView } from './feed/ViewSwitch';
import { SportsPattern } from '../landing/parts/SportsPattern';
import { DESKTOP, useMediaQuery } from './feed/useMediaQuery';
import { VenuesMode } from './venues/VenuesMode'; // В4
import { useAiFeatures } from '@/lib/aiFeatures';

import { MatchPanel } from './feed/assistant/MatchPanel'; // В2
import { matchToFeed } from './feed/assistant/matchToFeed'; // В2
import { CardsMode } from './feed/cards/CardsMode';
import { useMoveGuestSaved } from './feed/cards/useGuestSaved';
import { SaveSearchButton } from './feed/SaveSearchButton';
import { toCrudFilters } from './feed/filters';
import { cityById, selectCity } from '@/lib/cities';

/** Значение фильтра для сравнения: изменённый вручную фильтр теряет пометку «помощник». */
const keyValue = (f: Filters, k: FilterKey) =>
  JSON.stringify(
    k === 'price'
      ? [f.free, f.priceMax]
      : k === 'when'
        ? [f.when, f.date]
        : k === 'near'
          ? [f.near, f.radiusKm, f.from]
          : f[k],
  );

export default function EventsPage() {
  const city = useSelectedCity();
  const [params, setParams] = useSearchParams();
  const savedCity = params.get('city');
  useEffect(() => {
    if (savedCity && cityById(savedCity)) selectCity(savedCity);
  }, [savedCity]);
  const { me } = useMe();
  const { settings } = useSettings();
  const simple = settings.simple;
  const desktop = useMediaQuery(DESKTOP);

  const filters = useMemo(() => readFilters(params), [params]);
  const aiKeys = (params.get('ai') ?? '').split(',').filter(Boolean) as FilterKey[];
  const rawView = params.get('view');
  // В4: третий режим «Площадки»
  const view: FeedView = simple
    ? 'list'
    : rawView === 'map'
      ? 'map'
      : rawView === 'venues'
        ? 'venues'
        : rawView === 'cards'
          ? 'cards'
          : 'list';
  const filtered = activeKeys(filters).length > 0;
  const order = params.get('sort') === 'time' ? 'time' : 'relevance';

  const sports = useList<SportView>({ resource: 'sports', pagination: { mode: 'off' } }).result.data ?? [];
  const categories =
    useList<CategoryView>({ resource: 'categories', pagination: { mode: 'off' } }).result.data ?? [];
  const districts =
    useList<District>({
      resource: 'districts',
      filters: cityLocationFilters(city, ''),
      pagination: { mode: 'off' },
    }).result.data ?? [];
  const sportName = (id: string) => sports.find((s) => s.id === id)?.name ?? 'Направление';

  const apply = (next: Filters, ai?: FilterKey[]) => {
    const p = writeFilters(params, next);
    const keep =
      ai ?? aiKeys.filter((k) => activeKeys(next).includes(k) && keyValue(next, k) === keyValue(filters, k));
    if (keep.length) p.set('ai', keep.join(','));
    else p.delete('ai');
    setParams(p);
  };
  const setView = (v: FeedView) => {
    const p = new URLSearchParams(params);
    if (v === 'map' || v === 'venues' || v === 'cards') p.set('view', v);
    else p.delete('view');
    setParams(p, { replace: true });
  };

  const { features: ai, loaded: aiLoaded } = useAiFeatures();
  const searchOn = ai.search;
  const [phrase, setPhrase] = useState(() => params.get('phrase') ?? '');
  const [fallback, setFallback] = useState(false);
  const { run, isPending } = useAction<ParsedSearch>();

  // В2: каждая фраза открывает под строкой поиска короткий диалог подбора
  const [matchFor, setMatchFor] = useState<{ text: string; n: number } | null>(null);

  const search = async (text: string) => {
    setFallback(false);
    if (!searchOn) {
      apply({ ...EMPTY_FILTERS, q: text }, []);
      return;
    }
    setMatchFor({ text, n: Date.now() });
    try {
      const parsed = await run(API.assistantSearch, { text }, { silent: true });
      const { filters: next, keys } = fromAssistant(parsed.filters);
      apply(keys.length ? next : { ...EMPTY_FILTERS, q: text }, keys);
    } catch (error) {
      // Помощник не ответил — ищем по словам фразы, как обычный текстовый поиск.
      setFallback((error as ApiError)?.code !== 'validation');
      apply({ ...EMPTY_FILTERS, q: text }, []);
    }
  };

  const initialPhrase = useRef(params.get('phrase'));
  useEffect(() => {
    const text = initialPhrase.current?.trim();
    if (!text || !aiLoaded) return;
    initialPhrase.current = null;
    const p = new URLSearchParams(window.location.search);
    p.delete('phrase');
    setParams(p, { replace: true });
    void search(text);
    // Фраза с лендинга разбирается один раз: как только известно, включён ли подбор.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiLoaded]);

  useMoveGuestSaved();
  useEffect(() => {
    if (view === 'cards') window.scrollTo({ top: 0 });
  }, [view]);

  const createTo = me ? '/events/new' : `/login?to=${encodeURIComponent('/events/new')}`;
  const nearHere = () =>
    apply(
      { ...EMPTY_FILTERS, near: true, radiusKm: 3, from: me?.home || me?.districtId ? null : 'd-center' },
      [],
    );

  if (view === 'cards')
    return (
      <div className={['container', styles.page].join(' ')}>
        <h1 className="sr-only">Найти встречу: по одной</h1>
        <CardsMode
          results={filtered || params.has('sort')}
          filters={filters}
          order={order}
          onChange={(f) => apply(f)}
          districts={districts}
          sportName={sportName}
          me={me}
          activeFilters={activeKeys(filters).length}
          filtersPanel={
            <FeedFilters
              filters={filters}
              onChange={(f) => apply(f)}
              aiKeys={aiKeys}
              sports={sports}
              categories={categories}
              districts={districts}
              me={me}
            />
          }
          createTo={createTo}
          onExit={() => setView('list')}
        />
      </div>
    );

  return (
    <div className={['container', styles.page, simple && styles.pageSimple].filter(Boolean).join(' ')}>
      <header className={styles.head}>
        <SportsPattern />
        <div className={styles.headCopy} data-stagger="">
          <h1 className={styles.title}>
            {simple ? 'Чем займёмся?' : 'Найти встречу'}
            <span>.</span>
          </h1>
          <p className={styles.headLead}>
            Найдите встречу по виду спорта, дате и району. Откройте карточку, чтобы посмотреть условия и
            записаться.
          </p>
        </div>
        {!simple && (
          <div className={styles.cityCard} data-reveal="media">
            <span className={styles.cityIcon}>
              <MapPinIcon size={28} aria-hidden />
            </span>
            <div>
              <span className={styles.cityLabel}>Ваш город</span>
              <strong>{city.name}</strong>
            </div>
            <button
              type="button"
              className={styles.nearButton}
              onClick={nearHere}
              aria-label="Найти встречу рядом"
            >
              <span>Найти встречу рядом</span> <MapPinIcon size={16} aria-hidden />
            </button>
          </div>
        )}
      </header>

      {simple && (
        <nav className={styles.bigActions} aria-label="Главные действия">
          <Button
            variant="primary"
            size="lg"
            block
            icon={<MapPinIcon size={26} weight="fill" aria-hidden />}
            onClick={nearHere}
          >
            Найти встречу рядом
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            icon={<UsersThreeIcon size={26} aria-hidden />}
            to="/companions"
          >
            Ищу компанию
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            icon={<PlusIcon size={26} weight="bold" aria-hidden />}
            to={createTo}
          >
            Создать встречу
          </Button>
        </nav>
      )}

      {/* В4: режим «Площадки» заменяет поиск событий своими фильтрами */}
      {view === 'venues' ? (
        <VenuesMode onView={setView} />
      ) : (
        <>
          <div className={styles.discovery}>
            <div className={styles.discoveryHead}>
              <p className={styles.searchLabel}>Поиск встреч</p>
              <SaveSearchButton
                criteria={Object.fromEntries(
                  [...toCrudFilters(filters, districts), ...cityLocationFilters(city)].flatMap((f) =>
                    'field' in f ? [[f.field, f.value]] : [],
                  ),
                )}
                query={new URLSearchParams({ ...Object.fromEntries(params), city: city.id }).toString()}
                summary={`${city.name}: ${filters.q || filters.sportIds.map(sportName).join(', ') || 'встречи по выбранным условиям'}`}
              />
              {!simple && <ViewSwitch value={view} onChange={setView} />}
            </div>
            <label className={styles.orderLabel}>
              Порядок встреч
              <Select
                aria-label="Порядок встреч"
                value={order}
                onChange={(value: string) => {
                  const next = new URLSearchParams(params);
                  next.set('sort', value);
                  setParams(next);
                }}
                options={[
                  { value: 'relevance', label: 'Сначала подходящие' },
                  { value: 'time', label: 'Сначала ближайшие по времени' },
                ]}
              />
              <small>
                Сначала показаны встречи, которые лучше соответствуют запросу и вашим интересам. При
                одинаковом совпадении выше будет та, что начнётся раньше.
              </small>
            </label>
            <div className={styles.search}>
              <PhraseSearch
                value={phrase}
                onChange={setPhrase}
                onSubmit={(text) => void search(text)}
                loading={isPending}
                size={simple ? 'lg' : 'md'}
                label={searchOn ? undefined : 'Что ищете'}
                placeholder={
                  !searchOn
                    ? 'Например: теннис'
                    : simple
                      ? 'Например: скандинавская ходьба утром'
                      : desktop
                        ? undefined
                        : 'Что ищете?'
                }
              />
              {fallback && matchFor ? null : fallback ? (
                <p className={styles.searchNote} role="status">
                  Помощник сейчас не отвечает, поэтому ищем по словам из фразы. Фильтры работают как обычно.
                </p>
              ) : aiKeys.length > 0 ? (
                <p className={styles.searchNote} role="status">
                  <SparkleIcon size={16} weight="fill" aria-hidden className={styles.sparkle} />
                  Помощник подобрал фильтры по фразе, они отмечены звёздочкой. Лишнее уберите крестиком.
                </p>
              ) : null}
            </div>

            {matchFor && (
              <MatchPanel
                key={matchFor.n}
                phrase={matchFor.text}
                onClose={() => setMatchFor(null)}
                onShowAll={(f) => {
                  const next = matchToFeed(f);
                  apply(next.filters, next.keys);
                  setMatchFor(null);
                  requestAnimationFrame(() =>
                    document
                      .getElementById('results-title')
                      ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                  );
                }}
              />
            )}

            {simple ? (
              <ActiveFilters
                filters={filters}
                onChange={(f) => apply(f)}
                aiKeys={aiKeys}
                sports={sports}
                districts={districts}
              />
            ) : (
              <FeedFilters
                filters={filters}
                onChange={(f) => apply(f)}
                aiKeys={aiKeys}
                sports={sports}
                categories={categories}
                districts={districts}
                me={me}
              />
            )}
          </div>
          <div className={styles.feed}>
            {filtered || simple || params.has('sort') ? (
              <Results
                order={order}
                filters={filters}
                onChange={(f) => apply(f)}
                districts={districts}
                sportName={sportName}
                view={view}
                onView={setView}
                me={me}
                simple={simple}
                title={filtered ? undefined : order === 'time' ? 'Ближайшие занятия' : 'Подходящие занятия'}
              />
            ) : (
              <Sections
                key={city.id}
                me={me}
                view={view}
                onView={setView}
                onWhen={(when) => apply({ ...EMPTY_FILTERS, when })}
                createTo={createTo}
              />
            )}
          </div>
        </>
      )}

      {!simple && view !== 'venues' && (
        <div className={styles.legend}>
          <span>
            <i className={styles.dotOk} aria-hidden />
            Свободная запись: вы сразу в составе
          </span>
          <span>
            <i className={styles.dotWait} aria-hidden />
            По заявке: организатор подтверждает участие
          </span>
        </div>
      )}
    </div>
  );
}
