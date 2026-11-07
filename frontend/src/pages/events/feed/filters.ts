import type { CrudFilter } from '@refinedev/core';

import { capitalize, NBSP } from '@/lib/text';
import { dayjs, dayLabel, weekendRange } from '@/lib/dates';
import { formatRub } from '@/lib/money';
import type { EventView, SearchFilters } from '@/types/api';
import type { Composition, District, JoinMode, SkillLevel } from '@/types/domain';
import { COMPOSITION } from '@/lib/labels';
import { ACCESS_NEED, ACCESS_NEEDS } from '@/lib/venues';
import type { AccessNeed } from '@/types/domain';

export type When = 'today' | 'tomorrow' | 'weekend' | 'week' | 'date';
export type DayPart = 'morning' | 'day' | 'evening';
export type Radius = 1 | 3 | 5 | 10;

/** Фильтры ленты. Живут в адресе страницы: ссылкой на поиск можно поделиться, «Назад» работает. */
export interface FeedFilters {
  q: string;
  sportIds: string[];
  when: When | null;
  /** YYYY-MM-DD для when = 'date'. */
  date: string | null;
  /** YYYY-MM: календарный месяц в часовом поясе выбранного города. */
  month?: string | null;
  dayPart: DayPart | null;
  level: SkillLevel | null;
  beginners: boolean;
  free: boolean;
  priceMax: number | null;
  joinMode: JoinMode | null;
  near: boolean;
  radiusKm: Radius;
  /** Район — точка отсчёта для «Рядом со мной»; пусто — точка из профиля. */
  from: string | null;
  /** Фильтр по району (помощник понял «в Октябрьском»). */
  districtId: string | null;
  /** В7: состав — только женщины, только мужчины или смешанный. */
  composition: Composition | null;
  /** Н1: «Нужна доступная среда» — пандус, лифт, туалет для МГН, сопровождение. */
  access: AccessNeed[];
  /** Н2: только события программы поддержки ветеранов. */
  program: 'veterans' | null;
  family: 'family' | 'kids' | null;
}

export type FilterKey =
  | 'q'
  | 'sportIds'
  | 'when'
  | 'month'
  | 'dayPart'
  | 'level'
  | 'beginners'
  | 'price'
  | 'joinMode'
  | 'near'
  | 'districtId'
  | 'composition'
  | 'access'
  | 'program'
  | 'family';

export const EMPTY_FILTERS: FeedFilters = {
  q: '',
  sportIds: [],
  when: null,
  date: null,
  month: null,
  dayPart: null,
  level: null,
  beginners: false,
  free: false,
  priceMax: null,
  joinMode: null,
  near: false,
  radiusKm: 3,
  from: null,
  districtId: null,
  composition: null,
  access: [],
  program: null,
  family: null,
};

const WHEN_VALUES: When[] = ['today', 'tomorrow', 'weekend', 'week', 'date'];
const PARTS: DayPart[] = ['morning', 'day', 'evening'];
const LEVELS: SkillLevel[] = ['beginner', 'amateur', 'experienced'];
export const RADII: Radius[] = [1, 3, 5, 10];
export const PRICE_STEPS = [300, 500, 1000];

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : null;

export function readFilters(params: URLSearchParams): FeedFilters {
  const radius = Number(params.get('r'));
  const max = Number(params.get('max'));
  const date = params.get('date');
  const when = pick(params.get('when'), WHEN_VALUES);
  return {
    q: params.get('q') ?? '',
    sportIds: (params.get('sport') ?? '').split(',').filter(Boolean),
    when: when === 'date' && !date ? null : when,
    date: when === 'date' ? date : null,
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') ?? '') ? params.get('month') : null,
    dayPart: pick(params.get('part'), PARTS),
    level: pick(params.get('level'), LEVELS),
    beginners: params.get('new') === '1',
    free: params.get('free') === '1',
    priceMax: max > 0 ? max : null,
    joinMode: pick(params.get('mode'), ['open', 'approval'] as const),
    near: params.get('near') === '1',
    radiusKm: (RADII as number[]).includes(radius) ? (radius as Radius) : 3,
    from: params.get('from'),
    districtId: params.get('district'),
    composition: pick(params.get('who'), ['mixed', 'women', 'men'] as const),
    access: (params.get('need') ?? '')
      .split(',')
      .filter((n): n is AccessNeed => (ACCESS_NEEDS as string[]).includes(n)),
    program: params.get('program') === 'veterans' ? 'veterans' : null,
    family: pick(params.get('family'), ['family', 'kids'] as const),
  };
}

/** Записывает фильтры в адрес, сохраняя посторонние параметры (вид, пометки помощника). */
export function writeFilters(params: URLSearchParams, f: FeedFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | null | false | undefined) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  set('q', f.q.trim());
  set('sport', f.sportIds.join(','));
  set('when', f.when);
  set('date', f.when === 'date' ? f.date : null);
  set('month', f.month);
  set('part', f.dayPart);
  set('level', f.level);
  set('new', f.beginners && '1');
  set('free', f.free && '1');
  set('max', !f.free && f.priceMax ? String(f.priceMax) : null);
  set('mode', f.joinMode);
  set('near', f.near && '1');
  set('r', f.near && f.radiusKm !== 3 ? String(f.radiusKm) : null);
  set('from', f.near ? f.from : null);
  set('district', f.districtId);
  set('who', f.composition);
  set('need', f.access.join(','));
  set('program', f.program);
  set('family', f.family);
  return next;
}

export function activeKeys(f: FeedFilters): FilterKey[] {
  const keys: FilterKey[] = [];
  if (f.q.trim()) keys.push('q');
  if (f.sportIds.length) keys.push('sportIds');
  if (f.when) keys.push('when');
  if (f.month) keys.push('month');
  if (f.dayPart) keys.push('dayPart');
  if (f.level) keys.push('level');
  if (f.beginners) keys.push('beginners');
  if (f.free || f.priceMax) keys.push('price');
  if (f.joinMode) keys.push('joinMode');
  if (f.near) keys.push('near');
  if (f.districtId) keys.push('districtId');
  if (f.composition) keys.push('composition');
  if (f.access.length) keys.push('access');
  if (f.program) keys.push('program');
  if (f.family) keys.push('family');
  return keys;
}

export function clearKey(f: FeedFilters, key: FilterKey): FeedFilters {
  switch (key) {
    case 'q':
      return { ...f, q: '' };
    case 'sportIds':
      return { ...f, sportIds: [] };
    case 'when':
      return { ...f, when: null, date: null };
    case 'month':
      return { ...f, month: null };
    case 'dayPart':
      return { ...f, dayPart: null };
    case 'level':
      return { ...f, level: null };
    case 'beginners':
      return { ...f, beginners: false };
    case 'price':
      return { ...f, free: false, priceMax: null };
    case 'joinMode':
      return { ...f, joinMode: null };
    case 'near':
      return { ...f, near: false, from: null };
    case 'districtId':
      return { ...f, districtId: null };
    case 'composition':
      return { ...f, composition: null };
    case 'access':
      return { ...f, access: [] };
    case 'program':
      return { ...f, program: null };
    case 'family':
      return { ...f, family: null };
  }
}

/** Фильтры Refine для ресурса events (scope = feed по умолчанию). */
export function toCrudFilters(f: FeedFilters, districts: District[]): CrudFilter[] {
  const out: CrudFilter[] = [];
  const add = (field: string, value: unknown) => out.push({ field, operator: 'eq', value });
  if (f.q.trim()) add('q', f.q.trim());
  if (f.sportIds.length) add('sportIds', f.sportIds);
  if (f.when) add('when', f.when);
  if (f.when === 'date' && f.date) add('date', dayjs(f.date).toISOString());
  if (f.month) add('month', f.month);
  if (f.dayPart) add('dayPart', f.dayPart);
  if (f.level) add('level', f.level);
  if (f.beginners) add('beginners', true);
  if (f.free) add('free', true);
  else if (f.priceMax) add('priceMax', f.priceMax);
  if (f.joinMode) add('joinMode', f.joinMode);
  if (f.near) {
    add('near', true);
    add('radiusKm', f.radiusKm);
    const d = districts.find((x) => x.id === f.from);
    if (d) add('point', { lat: d.lat, lng: d.lng });
  }
  if (f.districtId) add('districtId', f.districtId);
  if (f.composition) add('composition', f.composition);
  if (f.access.length) add('access', f.access);
  if (f.program) add('program.kind', f.program);
  if (f.family) add('family', f.family);
  return out;
}

export const WHEN_LABEL: Record<Exclude<When, 'date'>, string> = {
  today: 'Сегодня',
  tomorrow: 'Завтра',
  weekend: 'На выходных',
  week: 'На этой неделе',
};

export const DAY_PART_LABEL: Record<DayPart, string> = {
  morning: 'Утром',
  day: 'Днём',
  evening: 'Вечером',
};

export const LEVEL_LABEL: Record<SkillLevel, string> = {
  beginner: 'Для новичков',
  amateur: 'Для любителей',
  experienced: 'Для опытных',
};

export const JOIN_MODE_LABEL: Record<JoinMode, string> = {
  open: 'Свободная запись',
  approval: 'По заявке',
};

export function whenLabel(f: Pick<FeedFilters, 'when' | 'date'>): string {
  if (!f.when) return 'Когда';
  if (f.when === 'date') return f.date ? capitalize(dayjs(f.date).format('dd, D MMMM')) : 'Дата';
  return WHEN_LABEL[f.when];
}

export function priceLabel(f: Pick<FeedFilters, 'free' | 'priceMax'>): string {
  if (f.free) return 'Бесплатно';
  if (f.priceMax) return `До ${formatRub(f.priceMax)}`;
  return 'Цена';
}

/** В7: «Состав» в ленте; смешанный в фильтре называем полностью, чтобы было понятно без контекста. */
export function compositionLabel(c: Composition | null): string {
  if (!c) return 'Состав';
  return c === 'mixed' ? 'Смешанный состав' : COMPOSITION[c].label;
}

export function radiusLabel(km: number): string {
  return `До ${km}${NBSP}км`;
}

/** Подпись снимаемого чипа активного фильтра. */
export function chipLabel(
  key: FilterKey,
  f: FeedFilters,
  ctx: { sportName: (id: string) => string; districtName: (id: string) => string | null },
): string {
  switch (key) {
    case 'q':
      return `«${f.q.trim()}»`;
    case 'sportIds':
      return f.sportIds.map(ctx.sportName).join(', ');
    case 'when':
      return whenLabel(f);
    case 'month':
      return capitalize(dayjs(`${f.month}-01`).format('MMMM YYYY'));
    case 'dayPart':
      return DAY_PART_LABEL[f.dayPart!];
    case 'level':
      return LEVEL_LABEL[f.level!];
    case 'beginners':
      return 'Рады новичкам';
    case 'price':
      return priceLabel(f);
    case 'joinMode':
      return JOIN_MODE_LABEL[f.joinMode!];
    case 'near': {
      const from = f.from ? ctx.districtName(f.from) : null;
      return from ? `${radiusLabel(f.radiusKm)} от района ${from}` : `${radiusLabel(f.radiusKm)} от вас`;
    }
    case 'districtId':
      return ctx.districtName(f.districtId!) ?? 'Район';
    case 'composition':
      return compositionLabel(f.composition);
    case 'access':
      return accessLabel(f.access);
    case 'program':
      return PROGRAM_FILTER_LABEL;
    case 'family':
      return f.family === 'kids' ? 'Для детей' : 'Можно с детьми';
  }
}

/** Н2: подпись фильтра по программе. */
export const PROGRAM_FILTER_LABEL = 'Программа для ветеранов';

/** Н1: «Доступная среда: пандус, сопровождение». */
export function accessLabel(access: AccessNeed[]): string {
  if (!access.length) return 'Доступная среда';
  const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  return `Доступная среда: ${access.map((n) => lowerFirst(ACCESS_NEED[n])).join(', ')}`;
}

/** Фильтры, которые разобрал помощник, в форме ленты и ключи для пометки «помощник». */
export function fromAssistant(parsed: SearchFilters): { filters: FeedFilters; keys: FilterKey[] } {
  const f: FeedFilters = { ...EMPTY_FILTERS };
  if (parsed.q) f.q = parsed.q;
  if (parsed.sportIds?.length) f.sportIds = parsed.sportIds;
  if (parsed.when) {
    f.when = parsed.when;
    f.date = parsed.when === 'date' && parsed.date ? dayjs(parsed.date).format('YYYY-MM-DD') : null;
    if (parsed.when === 'date' && !f.date) f.when = null;
  }
  if (parsed.dayPart) f.dayPart = parsed.dayPart;
  if (parsed.level && parsed.level !== 'any') f.level = parsed.level;
  if (parsed.beginners) f.beginners = true;
  if (parsed.free) f.free = true;
  else if (parsed.priceMax) f.priceMax = parsed.priceMax;
  if (parsed.joinMode) f.joinMode = parsed.joinMode;
  if (parsed.near) {
    f.near = true;
    const r = parsed.radiusKm;
    f.radiusKm = r ? (RADII.find((x) => x >= r) ?? 10) : 3;
  }
  if (parsed.districtId) f.districtId = parsed.districtId;
  return { filters: f, keys: activeKeys(f) };
}

/** Значения фильтров для формы создания: /events/new?sportId=…&date=…, чтобы не вводить заново. */
export function createLink(f: FeedFilters): string {
  const p = new URLSearchParams();
  if (f.sportIds[0]) p.set('sportId', f.sportIds[0]);
  const now = dayjs();
  const day =
    f.when === 'today'
      ? now
      : f.when === 'tomorrow'
        ? now.add(1, 'day')
        : f.when === 'weekend'
          ? weekendRange(now)[0]
          : f.when === 'date' && f.date
            ? dayjs(f.date)
            : f.month
              ? dayjs(`${f.month}-01`)
              : null;
  if (day) p.set('date', day.format('YYYY-MM-DD'));
  if (f.dayPart) p.set('dayPart', f.dayPart);
  if (f.level) p.set('level', f.level);
  if (f.beginners) p.set('beginners', '1');
  if (f.free) p.set('free', '1');
  else if (f.priceMax) p.set('priceMax', String(f.priceMax));
  if (f.joinMode) p.set('joinMode', f.joinMode);
  const district = f.districtId ?? (f.near ? f.from : null);
  if (district) p.set('districtId', district);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.composition && f.composition !== 'mixed') p.set('composition', f.composition);
  const qs = p.toString();
  return `/events/new${qs ? `?${qs}` : ''}`;
}

/** Снятые, отменённые, удалённые и прошедшие в ленту не попадают никогда. */
export const isOpenForFeed = (e: EventView) => e.state === 'upcoming' || e.state === 'live';

/** «Завтра · 18:30», «Ср, 21 октября · 19:00» — как в афише владельца. */
export function whenShort(iso: string): string {
  const label = dayLabel(iso);
  const day = label === 'Сегодня' || label === 'Завтра' ? label : capitalize(dayjs(iso).format('dd, D MMMM'));
  return `${day} · ${dayjs(iso).format('HH:mm')}`;
}

export function createHref(filters: FeedFilters, me: { id: string } | null): string {
  const to = createLink(filters);
  return me ? to : `/login?to=${encodeURIComponent(to)}`;
}
