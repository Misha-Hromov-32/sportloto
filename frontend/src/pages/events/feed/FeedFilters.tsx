import {
  CalendarBlankIcon,
  CheckIcon,
  ClockIcon,
  CurrencyRubIcon,
  GaugeIcon,
  ListMagnifyingGlassIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  SparkleIcon,
  SunIcon,
  SlidersHorizontalIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { DatePicker, Input, Segmented, Select } from 'antd';
import { useMemo, useState, type ReactNode } from 'react';

import { Button, Chip, SportIcon } from '@/components';
import { dayjs } from '@/lib/dates';
import { formatRub } from '@/lib/money';
import { normalize } from '@/lib/text';
import type { CategoryView, Identity, SportView } from '@/types/api';
import type { District } from '@/types/domain';

import { FilterSheet } from './FilterSheet';
import { AccessNeedSheet } from '../venues/AccessNeedSheet'; // Н1
import { MedalMilitaryIcon } from '@phosphor-icons/react'; // Н2
import { PROGRAM_FILTER_LABEL } from './filters'; // Н2
import styles from './FeedFilters.module.css';
import {
  activeKeys,
  chipLabel,
  clearKey,
  compositionLabel,
  DAY_PART_LABEL,
  EMPTY_FILTERS,
  LEVEL_LABEL,
  PRICE_STEPS,
  priceLabel,
  RADII,
  radiusLabel,
  WHEN_LABEL,
  type DayPart,
  type FeedFilters as Filters,
  type FilterKey,
  type Radius,
  type When,
} from './filters';

interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

function OptionList<T extends string | number | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.options} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            className={[styles.option, active && styles.optionActive].filter(Boolean).join(' ')}
            onClick={() => onChange(o.value)}
          >
            <span className={styles.optionMark} aria-hidden>
              {active && <CheckIcon size={16} weight="bold" />}
            </span>
            <span className={styles.optionText}>
              <span>{o.label}</span>
              {o.hint && <span className={styles.optionHint}>{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface FeedFiltersProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  /** Фильтры, которые подставил помощник, — их чипы помечены. */
  aiKeys: FilterKey[];
  sports: SportView[];
  categories: CategoryView[];
  districts: District[];
  me: Identity | null;
}

export function FeedFilters({
  filters: f,
  onChange,
  aiKeys,
  sports,
  categories,
  districts,
  me,
}: FeedFiltersProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const sportName = (id: string) => sports.find((s) => s.id === id)?.name ?? 'Направление';
  const districtName = (id: string) => districts.find((d) => d.id === id)?.name ?? null;
  const homeDistrict = me?.districtId ? districtName(me.districtId) : null;
  const hasHome = Boolean(me?.home || me?.districtId);

  const popular = sports.filter((s) => s.popular).slice(0, 6);
  const otherPicked = f.sportIds.filter((id) => !popular.some((s) => s.id === id));
  const toggleSport = (id: string) =>
    set({ sportIds: f.sportIds.includes(id) ? f.sportIds.filter((x) => x !== id) : [...f.sportIds, id] });

  const whenTabs: { value: When | null; label: string }[] = [
    { value: null, label: 'Все дни' },
    ...(Object.keys(WHEN_LABEL) as Exclude<When, 'date'>[]).map((w) => ({ value: w, label: WHEN_LABEL[w] })),
  ];

  return (
    <div className={styles.root}>
      <div className={styles.chipRow} role="group" aria-label="Когда">
        {whenTabs.map((t) => (
          <Chip
            key={String(t.value)}
            selected={f.when === t.value && !f.month}
            onClick={() => set({ when: t.value, date: null, month: null })}
          >
            {t.label}
          </Chip>
        ))}
        <span
          className={[styles.dateField, f.when === 'date' && styles.dateFieldOn].filter(Boolean).join(' ')}
        >
          <DatePicker
            format="D MMMM, dd"
            value={f.when === 'date' && f.date ? dayjs(f.date) : null}
            disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
            onChange={(d) =>
              set(
                d ? { when: 'date', date: d.format('YYYY-MM-DD'), month: null } : { when: null, date: null },
              )
            }
            placeholder="Выбрать дату"
            inputReadOnly
            allowClear
            aria-label="Выбрать дату"
            prefix={<CalendarBlankIcon size={18} aria-hidden />}
            suffixIcon={null}
          />
        </span>
        <span className={[styles.dateField, f.month && styles.dateFieldOn].filter(Boolean).join(' ')}>
          <DatePicker
            picker="month"
            format="MMMM YYYY"
            value={f.month ? dayjs(`${f.month}-01`) : null}
            disabledDate={(d) => d.endOf('month').isBefore(dayjs().startOf('day'))}
            onChange={(d) => set({ month: d ? d.format('YYYY-MM') : null, when: null, date: null })}
            placeholder="Выбрать месяц"
            inputReadOnly
            allowClear
            aria-label="Выбрать месяц"
            prefix={<CalendarBlankIcon size={18} aria-hidden />}
            suffixIcon={null}
          />
        </span>
      </div>

      <div className={styles.row}>
        <div className={styles.chipRow} role="group" aria-label="Направление">
          <Chip selected={f.sportIds.length === 0} onClick={() => set({ sportIds: [] })}>
            Все направления
          </Chip>
          {popular.map((s) => (
            <Chip
              key={s.id}
              selected={f.sportIds.includes(s.id)}
              icon={<SportIcon sport={s} size={18} weight={f.sportIds.includes(s.id) ? 'fill' : 'regular'} />}
              onClick={() => toggleSport(s.id)}
            >
              {s.name}
            </Chip>
          ))}
          <FilterSheet
            label={otherPicked.length ? `Ещё: ${otherPicked.map(sportName).join(', ')}` : 'Ещё направления'}
            title="Все направления"
            selected={otherPicked.length > 0}
            wide
            icon={<ListMagnifyingGlassIcon size={18} aria-hidden />}
          >
            {() => (
              <SportPicker
                sports={sports}
                categories={categories}
                value={f.sportIds}
                onChange={(sportIds) => set({ sportIds })}
              />
            )}
          </FilterSheet>
        </div>

        <Segmented<'all' | 'open' | 'approval'>
          className={styles.segmented}
          aria-label="Режим записи"
          value={f.joinMode ?? 'all'}
          onChange={(v) => set({ joinMode: v === 'all' ? null : v })}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'open', label: 'Свободная запись' },
            { value: 'approval', label: 'По заявке' },
          ]}
        />
      </div>

      <details className={styles.moreFilters}>
        <summary className={styles.moreSummary}>
          <SlidersHorizontalIcon size={18} aria-hidden /> Уточнить поиск{' '}
          <span>Время, уровень, цена и другие условия</span>
        </summary>
        <div className={styles.extraRow} role="group" aria-label="Ещё фильтры">
          <FilterSheet
            label={f.dayPart ? DAY_PART_LABEL[f.dayPart] : 'Время дня'}
            title="Время дня"
            selected={Boolean(f.dayPart)}
            icon={<ClockIcon size={18} aria-hidden />}
          >
            {(close) => (
              <OptionList<DayPart | null>
                label="Время дня"
                value={f.dayPart}
                options={[
                  { value: null, label: 'В любое время' },
                  { value: 'morning', label: DAY_PART_LABEL.morning, hint: 'До 12:00' },
                  { value: 'day', label: DAY_PART_LABEL.day, hint: 'С 12:00 до 17:00' },
                  { value: 'evening', label: DAY_PART_LABEL.evening, hint: 'После 17:00' },
                ]}
                onChange={(dayPart) => {
                  set({ dayPart });
                  close();
                }}
              />
            )}
          </FilterSheet>

          <FilterSheet
            label={f.level ? LEVEL_LABEL[f.level] : 'Уровень'}
            title="Уровень"
            selected={Boolean(f.level)}
            icon={<GaugeIcon size={18} aria-hidden />}
          >
            {(close) => (
              <OptionList
                label="Уровень"
                value={f.level}
                options={[
                  { value: null, label: 'Любой уровень' },
                  { value: 'beginner', label: LEVEL_LABEL.beginner, hint: 'Учат с нуля, опыт не нужен' },
                  { value: 'amateur', label: LEVEL_LABEL.amateur, hint: 'Знаете правила и немного играли' },
                  {
                    value: 'experienced',
                    label: LEVEL_LABEL.experienced,
                    hint: 'Играете давно и в хорошем темпе',
                  },
                ]}
                onChange={(level) => {
                  set({ level });
                  close();
                }}
              />
            )}
          </FilterSheet>

          <FilterSheet
            label={priceLabel(f)}
            title="Цена"
            selected={f.free || Boolean(f.priceMax)}
            icon={<CurrencyRubIcon size={18} aria-hidden />}
          >
            {(close) => (
              <OptionList<string>
                label="Цена"
                value={f.free ? 'free' : f.priceMax ? String(f.priceMax) : 'any'}
                options={[
                  { value: 'any', label: 'Любая цена' },
                  { value: 'free', label: 'Бесплатно' },
                  ...PRICE_STEPS.map((n) => ({
                    value: String(n),
                    label: `До ${formatRub(n)}`,
                    hint: 'С человека. Если скидываемся, считаем текущую долю',
                  })),
                ]}
                onChange={(v) => {
                  set(
                    v === 'any'
                      ? { free: false, priceMax: null }
                      : v === 'free'
                        ? { free: true, priceMax: null }
                        : { free: false, priceMax: Number(v) },
                  );
                  close();
                }}
              />
            )}
          </FilterSheet>

          <Chip
            selected={f.beginners}
            icon={<SunIcon size={18} weight={f.beginners ? 'fill' : 'regular'} aria-hidden />}
            onClick={() => set({ beginners: !f.beginners })}
          >
            Рады новичкам
          </Chip>

          {/* Н1: доступная среда */}
          <Chip
            selected={f.family === 'family'}
            onClick={() => set({ family: f.family === 'family' ? null : 'family' })}
          >
            Можно с детьми
          </Chip>
          <Chip
            selected={f.family === 'kids'}
            onClick={() => set({ family: f.family === 'kids' ? null : 'kids' })}
          >
            Для детей
          </Chip>
          <AccessNeedSheet value={f.access} onChange={(access) => set({ access })} />

          {/* Н2: программа поддержки ветеранов */}
          <Chip
            selected={Boolean(f.program)}
            icon={<MedalMilitaryIcon size={18} aria-hidden />}
            onClick={() => set({ program: f.program ? null : 'veterans' })}
          >
            {PROGRAM_FILTER_LABEL}
          </Chip>

          {/* В7: состав */}
          <FilterSheet
            label={compositionLabel(f.composition)}
            title="Состав"
            selected={Boolean(f.composition)}
            icon={<UsersThreeIcon size={18} aria-hidden />}
          >
            {(close) => (
              <OptionList<Filters['composition']>
                label="Состав"
                value={f.composition}
                options={[
                  { value: null, label: 'Любой состав' },
                  { value: 'women', label: 'Только женщины' },
                  { value: 'men', label: 'Только мужчины' },
                  { value: 'mixed', label: 'Смешанный состав', hint: 'Записаться может любой' },
                ]}
                onChange={(composition) => {
                  set({ composition });
                  close();
                }}
              />
            )}
          </FilterSheet>

          <FilterSheet
            label={f.near ? `Рядом: ${radiusLabel(f.radiusKm).toLowerCase()}` : 'Рядом со мной'}
            title="Рядом со мной"
            selected={f.near}
            icon={<MapPinIcon size={18} aria-hidden />}
          >
            {() => (
              <>
                <OptionList<Radius | 0>
                  label="Расстояние"
                  value={f.near ? f.radiusKm : 0}
                  options={[
                    { value: 0, label: 'Не важно, где' },
                    ...RADII.map((r) => ({ value: r, label: radiusLabel(r) })),
                  ]}
                  onChange={(r) =>
                    set(
                      r === 0
                        ? { near: false, from: null }
                        : { near: true, radiusKm: r, from: f.from ?? (hasHome ? null : 'd-center') },
                    )
                  }
                />
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Считать расстояние от</span>
                  <Select
                    value={f.from ?? (hasHome ? '' : 'd-center')}
                    onChange={(v) => set({ near: true, from: v || null })}
                    options={[
                      ...(hasHome
                        ? [
                            {
                              value: '',
                              label: homeDistrict
                                ? `Моего района (${homeDistrict})`
                                : 'Моей точки из профиля',
                            },
                          ]
                        : []),
                      ...districts.map((d) => ({ value: d.id, label: `Района ${d.name}` })),
                    ]}
                    style={{ width: '100%' }}
                  />
                </label>
                {!me && (
                  <p className={styles.sheetNote}>
                    Войдите и укажите район в профиле, чтобы считать от дома.
                  </p>
                )}
              </>
            )}
          </FilterSheet>
        </div>
      </details>

      <ActiveFilters filters={f} onChange={onChange} aiKeys={aiKeys} sports={sports} districts={districts} />
    </div>
  );
}

/** Выбранные фильтры снимаемыми чипами; подставленные помощником помечены. */
export function ActiveFilters({
  filters: f,
  onChange,
  aiKeys,
  sports,
  districts,
}: Pick<FeedFiltersProps, 'filters' | 'onChange' | 'aiKeys' | 'sports' | 'districts'>) {
  const keys = activeKeys(f);
  if (!keys.length) return null;
  const sportName = (id: string) => sports.find((s) => s.id === id)?.name ?? 'Направление';
  const districtName = (id: string) => districts.find((d) => d.id === id)?.name ?? null;
  return (
    <div className={styles.active} role="group" aria-label="Выбранные фильтры">
      {keys.map((k) => (
        <Chip
          key={k}
          fromAssistant={aiKeys.includes(k)}
          icon={aiKeys.includes(k) ? <SparkleIcon size={16} weight="fill" aria-hidden /> : undefined}
          onRemove={() => onChange(clearKey(f, k))}
        >
          {chipLabel(k, f, { sportName, districtName })}
        </Chip>
      ))}
      <Button variant="quiet" size="sm" onClick={() => onChange({ ...EMPTY_FILTERS })}>
        Сбросить всё
      </Button>
    </div>
  );
}

/** Популярные направления, дерево категорий и поиск по всему справочнику. Можно выбрать несколько. */
function SportPicker({
  sports,
  categories,
  value,
  onChange,
}: {
  sports: SportView[];
  categories: CategoryView[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const popular = sports.filter((s) => s.popular);
  const found = useMemo(() => {
    const q = normalize(query);
    if (!q) return null;
    return sports.filter((s) => [s.name, ...s.synonyms].some((n) => normalize(n).includes(q)));
  }, [query, sports]);

  const roots = categories.filter((c) => !c.parentId);
  const children = (id: string) => categories.filter((c) => c.parentId === id);
  const custom = sports.filter((s) => s.kind === 'custom' && s.categoryIds.length === 0);

  const sportChip = (s: SportView): ReactNode => (
    <Chip
      key={s.id}
      selected={value.includes(s.id)}
      icon={<SportIcon sport={s} size={18} weight={value.includes(s.id) ? 'fill' : 'regular'} />}
      onClick={() => toggle(s.id)}
    >
      {s.name}
    </Chip>
  );

  return (
    <div className={styles.picker}>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Найти направление: бадминтон, городки…"
        prefix={<MagnifyingGlassIcon size={18} aria-hidden />}
        allowClear
        aria-label="Найти направление"
      />
      {value.length > 0 && (
        <p className={styles.pickerSelected}>
          Выбрано: {value.length}.{' '}
          <Button variant="quiet" size="sm" onClick={() => onChange([])}>
            Снять выбор
          </Button>
        </p>
      )}
      {found ? (
        found.length ? (
          <div className={styles.chips}>{found.map(sportChip)}</div>
        ) : (
          <p className={styles.sheetNote}>
            Такого направления пока нет. Его можно добавить, когда будете создавать событие.
          </p>
        )
      ) : (
        <>
          <div className={styles.group}>
            <p className={styles.groupTitle}>Популярные</p>
            <div className={styles.chips}>{popular.map(sportChip)}</div>
          </div>
          <div className={styles.tree}>
            <p className={styles.groupTitle}>Все направления</p>
            {roots.map((c) => {
              const subs = children(c.id);
              const nested = new Set(subs.flatMap((s) => s.sports.map((x) => x.id)));
              const own = c.sports.filter((s) => !nested.has(s.id));
              const picked = [...own, ...subs.flatMap((s) => s.sports)].filter((s) =>
                value.includes(s.id),
              ).length;
              return (
                <details key={c.id} className={styles.cat}>
                  <summary className={styles.catTitle}>
                    {c.name}
                    {picked > 0 && <span className={styles.catCount}>выбрано {picked}</span>}
                  </summary>
                  <div className={styles.catBody}>
                    {own.length > 0 && <div className={styles.chips}>{own.map(sportChip)}</div>}
                    {subs.map((s) => (
                      <div key={s.id} className={styles.sub}>
                        <p className={styles.subTitle}>{s.name}</p>
                        <div className={styles.chips}>{s.sports.map(sportChip)}</div>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
            {custom.length > 0 && (
              <details className={styles.cat}>
                <summary className={styles.catTitle}>Новые, без категории</summary>
                <div className={styles.catBody}>
                  <div className={styles.chips}>{custom.map(sportChip)}</div>
                </div>
              </details>
            )}
          </div>
        </>
      )}
    </div>
  );
}
