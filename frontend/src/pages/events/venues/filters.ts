import type { CrudFilter } from '@refinedev/core';

import { dayjs } from '@/lib/dates';
import { ACCESS_FEATURES } from '@/lib/venues';
import type { VenueFeature } from '@/types/domain';

export type VenueDayPart = 'morning' | 'day' | 'evening';

/** Фильтры режима «Площадки». Живут в адресе с приставкой «v», чтобы не путаться с фильтрами событий. */
export interface VenueFilters {
  sportIds: string[];
  districtId: string | null;
  /** YYYY-MM-DD: есть свободное окно в этот день. */
  date: string | null;
  dayPart: VenueDayPart | null;
  /** Аренда за час не дороже; 0 — только бесплатные. */
  priceMax: number | null;
  features: VenueFeature[];
  indoor: boolean | null;
  map: boolean;
}

export const EMPTY_VENUE_FILTERS: VenueFilters = {
  sportIds: [],
  districtId: null,
  date: null,
  dayPart: null,
  priceMax: null,
  features: [],
  indoor: null,
  map: false,
};

export const VENUE_PRICE_STEPS = [1000, 2000, 3000];
const PARTS: VenueDayPart[] = ['morning', 'day', 'evening'];

export function readVenueFilters(params: URLSearchParams): VenueFilters {
  const max = params.get('vmax');
  const date = params.get('vdate');
  const indoor = params.get('vindoor');
  const part = params.get('vpart') as VenueDayPart | null;
  return {
    sportIds: (params.get('vsport') ?? '').split(',').filter(Boolean),
    districtId: params.get('vdistrict'),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    dayPart: part && PARTS.includes(part) ? part : null,
    priceMax: max !== null && max !== '' && Number(max) >= 0 ? Number(max) : null,
    features: (params.get('vneed') ?? '')
      .split(',')
      .filter((f): f is VenueFeature => (ACCESS_FEATURES as string[]).includes(f)),
    indoor: indoor === '1' ? true : indoor === '0' ? false : null,
    map: params.get('vmap') === '1',
  };
}

export function writeVenueFilters(params: URLSearchParams, f: VenueFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | null) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  set('vsport', f.sportIds.join(','));
  set('vdistrict', f.districtId);
  set('vdate', f.date);
  set('vpart', f.dayPart);
  set('vmax', f.priceMax === null ? null : String(f.priceMax));
  set('vneed', f.features.join(','));
  set('vindoor', f.indoor === null ? null : f.indoor ? '1' : '0');
  set('vmap', f.map ? '1' : null);
  return next;
}

export function hasVenueFilters(f: VenueFilters): boolean {
  return Boolean(
    f.sportIds.length ||
      f.districtId ||
      f.date ||
      f.dayPart ||
      f.priceMax !== null ||
      f.features.length ||
      f.indoor !== null,
  );
}

export function toVenueCrudFilters(f: VenueFilters): CrudFilter[] {
  const out: CrudFilter[] = [];
  const add = (field: string, value: unknown) => out.push({ field, operator: 'eq', value });
  if (f.sportIds.length) add('sportIds', f.sportIds);
  if (f.districtId) add('districtId', f.districtId);
  if (f.date) add('date', f.date);
  if (f.dayPart) add('dayPart', f.dayPart);
  if (f.priceMax !== null) add('priceMax', f.priceMax);
  if (f.features.length) add('features', f.features);
  if (f.indoor !== null) add('indoor', f.indoor);
  return out;
}

export const VENUE_DAY_PART: Record<VenueDayPart, { label: string; hint: string }> = {
  morning: { label: 'Утром', hint: 'Окна до 12:00' },
  day: { label: 'Днём', hint: 'С 12:00 до 17:00' },
  evening: { label: 'Вечером', hint: 'После 17:00' },
};

/** «сегодня», «завтра», «в сб, 25 октября» — для подписи «Свободно сегодня». */
export function dateWord(date: string | null): string | undefined {
  if (!date) return undefined;
  const d = dayjs(date);
  if (d.isSame(dayjs(), 'day')) return 'сегодня';
  if (d.isSame(dayjs().add(1, 'day'), 'day')) return 'завтра';
  return d.format('D MMMM');
}
