import {
  CalendarBlankIcon,
  CheckIcon,
  ClockIcon,
  CurrencyRubIcon,
  MapPinIcon,
  WheelchairIcon,
} from '@phosphor-icons/react';
import { DatePicker, Segmented, Select } from 'antd';

import { Button, Chip, SportIcon } from '@/components';
import { dayjs } from '@/lib/dates';
import { ACCESS_FEATURES, VENUE_FEATURE } from '@/lib/venues';
import type { SportView } from '@/types/api';
import type { District } from '@/types/domain';

import { FilterSheet } from '../feed/FilterSheet';
import feedStyles from '../feed/FeedFilters.module.css';
import { FEATURE_ICON } from '../../venues/parts/icons';
import {
  EMPTY_VENUE_FILTERS,
  hasVenueFilters,
  VENUE_DAY_PART,
  VENUE_PRICE_STEPS,
  type VenueDayPart,
  type VenueFilters as Filters,
} from './filters';
import styles from './VenuesMode.module.css';

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
    <div className={feedStyles.options} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            className={[feedStyles.option, active && feedStyles.optionActive].filter(Boolean).join(' ')}
            onClick={() => onChange(o.value)}
          >
            <span className={feedStyles.optionMark} aria-hidden>
              {active && <CheckIcon size={16} weight="bold" />}
            </span>
            <span className={feedStyles.optionText}>
              <span>{o.label}</span>
              {o.hint && <span className={feedStyles.optionHint}>{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const priceText = (max: number | null) =>
  max === null ? 'Цена' : max === 0 ? 'Бесплатно' : `До ${max.toLocaleString('ru-RU')}\u00A0₽ в час`;

export function VenueFilters({
  filters: f,
  onChange,
  sports,
  districts,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  sports: SportView[];
  districts: District[];
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const popular = sports.filter((s) => s.popular).slice(0, 6);
  const toggleSport = (id: string) =>
    set({ sportIds: f.sportIds.includes(id) ? f.sportIds.filter((x) => x !== id) : [...f.sportIds, id] });
  const toggleFeature = (feature: (typeof ACCESS_FEATURES)[number]) =>
    set({
      features: f.features.includes(feature) ? f.features.filter((x) => x !== feature) : [...f.features, feature],
    });
  const today = dayjs().format('YYYY-MM-DD');
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
  const district = districts.find((d) => d.id === f.districtId);

  return (
    <div className={feedStyles.root}>
      <div className={feedStyles.chipRow} role="group" aria-label="Направление">
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
          label={
            f.sportIds.some((id) => !popular.some((p) => p.id === id))
              ? `Ещё: ${f.sportIds
                  .filter((id) => !popular.some((p) => p.id === id))
                  .map((id) => sports.find((s) => s.id === id)?.name ?? '')
                  .join(', ')}`
              : 'Ещё направления'
          }
          title="Направления"
          selected={f.sportIds.some((id) => !popular.some((p) => p.id === id))}
        >
          {() => (
            <Select
              mode="multiple"
              value={f.sportIds}
              onChange={(sportIds: string[]) => set({ sportIds })}
              options={sports.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Начните вводить: бассейн, теннис…"
              optionFilterProp="label"
              style={{ width: '100%' }}
              aria-label="Направления"
            />
          )}
        </FilterSheet>
      </div>

      <div className={feedStyles.chipRow} role="group" aria-label="Когда свободно">
        <Chip selected={!f.date} onClick={() => set({ date: null })}>
          Любой день
        </Chip>
        <Chip selected={f.date === today} onClick={() => set({ date: today })}>
          Сегодня
        </Chip>
        <Chip selected={f.date === tomorrow} onClick={() => set({ date: tomorrow })}>
          Завтра
        </Chip>
        <span
          className={[feedStyles.dateField, f.date && f.date !== today && f.date !== tomorrow && feedStyles.dateFieldOn]
            .filter(Boolean)
            .join(' ')}
        >
          <DatePicker
            format="D MMMM, dd"
            value={f.date && f.date !== today && f.date !== tomorrow ? dayjs(f.date) : null}
            disabledDate={(d) => d.isBefore(dayjs().startOf('day')) || d.isAfter(dayjs().add(13, 'day'))}
            onChange={(d) => set({ date: d ? d.format('YYYY-MM-DD') : null })}
            placeholder="Выбрать дату"
            inputReadOnly
            allowClear
            aria-label="Выбрать дату"
            prefix={<CalendarBlankIcon size={18} aria-hidden />}
            suffixIcon={null}
          />
        </span>
        <FilterSheet
          label={f.dayPart ? VENUE_DAY_PART[f.dayPart].label : 'Время дня'}
          title="Когда нужно свободное окно"
          selected={Boolean(f.dayPart)}
          icon={<ClockIcon size={18} aria-hidden />}
        >
          {(close) => (
            <OptionList<VenueDayPart | null>
              label="Время дня"
              value={f.dayPart}
              options={[
                { value: null, label: 'В любое время' },
                ...(Object.keys(VENUE_DAY_PART) as VenueDayPart[]).map((k) => ({
                  value: k,
                  label: VENUE_DAY_PART[k].label,
                  hint: VENUE_DAY_PART[k].hint,
                })),
              ]}
              onChange={(dayPart) => {
                set({ dayPart });
                close();
              }}
            />
          )}
        </FilterSheet>
      </div>

      <div className={feedStyles.chipRow} role="group" aria-label="Ещё фильтры">
        <FilterSheet
          label={district ? district.name : 'Район'}
          title="Район"
          selected={Boolean(district)}
          icon={<MapPinIcon size={18} aria-hidden />}
        >
          {(close) => (
            <OptionList<string | null>
              label="Район"
              value={f.districtId}
              options={[
                { value: null, label: 'Все районы' },
                ...districts.map((d) => ({ value: d.id, label: d.name })),
              ]}
              onChange={(districtId) => {
                set({ districtId });
                close();
              }}
            />
          )}
        </FilterSheet>

        <FilterSheet
          label={priceText(f.priceMax)}
          title="Аренда за час"
          selected={f.priceMax !== null}
          icon={<CurrencyRubIcon size={18} aria-hidden />}
        >
          {(close) => (
            <OptionList<string>
              label="Цена"
              value={f.priceMax === null ? 'any' : String(f.priceMax)}
              options={[
                { value: 'any', label: 'Любая цена' },
                { value: '0', label: 'Бесплатно', hint: 'Дворовые площадки и парки' },
                ...VENUE_PRICE_STEPS.map((n) => ({ value: String(n), label: priceText(n) })),
              ]}
              onChange={(v) => {
                set({ priceMax: v === 'any' ? null : Number(v) });
                close();
              }}
            />
          )}
        </FilterSheet>

        <FilterSheet
          label={
            f.features.length
              ? `Доступная среда: ${f.features.map((x) => VENUE_FEATURE[x].short.toLowerCase()).join(', ')}`
              : 'Доступная среда'
          }
          title="Нужна доступная среда"
          selected={f.features.length > 0}
          icon={<WheelchairIcon size={18} aria-hidden />}
        >
          {() => (
            <div className={styles.needs}>
              <p className={feedStyles.sheetNote}>Покажем только площадки, где есть всё отмеченное.</p>
              <div className={styles.needChips} role="group" aria-label="Условия доступности">
                {ACCESS_FEATURES.map((x) => {
                  const I = FEATURE_ICON[x];
                  return (
                    <Chip
                      key={x}
                      selected={f.features.includes(x)}
                      icon={<I size={18} aria-hidden />}
                      onClick={() => toggleFeature(x)}
                    >
                      {VENUE_FEATURE[x].label}
                    </Chip>
                  );
                })}
              </div>
            </div>
          )}
        </FilterSheet>

        <Segmented<'all' | 'in' | 'out'>
          className={feedStyles.segmented}
          aria-label="Крытая или открытая"
          value={f.indoor === null ? 'all' : f.indoor ? 'in' : 'out'}
          onChange={(v) => set({ indoor: v === 'all' ? null : v === 'in' })}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'in', label: 'Крытые' },
            { value: 'out', label: 'Открытые' },
          ]}
        />

        {hasVenueFilters(f) && (
          <Button variant="quiet" size="sm" onClick={() => onChange({ ...EMPTY_VENUE_FILTERS, map: f.map })}>
            Сбросить всё
          </Button>
        )}
      </div>
    </div>
  );
}
