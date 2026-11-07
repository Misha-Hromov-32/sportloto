import type { CrudFilter } from '@refinedev/core';

import type { GeoPoint } from '@/types/domain';

import { distanceKm } from './geo';

/**
 * Города платформы. Список приходит с сервера (`GET /api/cities`, его правит администратор
 * в «Справочниках») и хранится в памяти и в браузере. Пока ответа нет или сервер недоступен —
 * встроенный список ниже. Граница города — круг радиуса `radiusKm` вокруг центра.
 */
export interface City {
  id: string;
  name: string;
  /** «в Брянске»: форма после предлога. `in` — то же, для старых экранов. */
  nameIn: string;
  in: string;
  region: string;
  timeZone: string;
  center: GeoPoint;
  radiusKm: number;
  isDefault: boolean;
}

export type CityId = string;

interface CityRecord {
  id: string;
  name: string;
  nameIn?: string;
  region?: string;
  timeZone: string;
  center: GeoPoint;
  radiusKm?: number;
  isDefault?: boolean;
  hidden?: boolean;
}

const DEFAULT_RADIUS_KM = 35;

function toCity(c: CityRecord): City {
  const nameIn = c.nameIn || c.name;
  return {
    id: c.id,
    name: c.name,
    nameIn,
    in: nameIn,
    region: c.region ?? '',
    timeZone: c.timeZone,
    center: { lat: c.center.lat, lng: c.center.lng },
    radiusKm: c.radiusKm && c.radiusKm > 0 ? c.radiusKm : DEFAULT_RADIUS_KM,
    isDefault: Boolean(c.isDefault),
  };
}

const BUILTIN: City[] = [
  {
    id: 'bryansk',
    name: 'Брянск',
    nameIn: 'Брянске',
    region: 'Брянская область',
    timeZone: 'Europe/Moscow',
    center: { lat: 53.2436, lng: 34.3634 },
    radiusKm: 35,
  },
  {
    id: 'krasnoyarsk',
    name: 'Красноярск',
    nameIn: 'Красноярске',
    region: 'Красноярский край',
    timeZone: 'Asia/Krasnoyarsk',
    center: { lat: 56.0106, lng: 92.8526 },
    radiusKm: 35,
    isDefault: true,
  },
  {
    id: 'moscow',
    name: 'Москва',
    nameIn: 'Москве',
    region: 'Город федерального значения',
    timeZone: 'Europe/Moscow',
    center: { lat: 55.7558, lng: 37.6173 },
    radiusKm: 45,
  },
].map(toCity);

const KEY = 'sportitochka.city';
const LIST_KEY = 'sportitochka.cities';
const CHANGE = 'sportitochka:city-change';

function readSaved(): City[] | null {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const parsed = raw ? (JSON.parse(raw) as CityRecord[]) : null;
    return Array.isArray(parsed) && parsed.length ? parsed.map(toCity) : null;
  } catch {
    return null;
  }
}

/** Видимые города в порядке показа. Массив один и тот же: при загрузке меняется его содержимое. */
export const CITIES: City[] = [...(readSaved() ?? BUILTIN)];
let revision = 0;
let fallback: CityId = defaultCity().id;

export function defaultCity(): City {
  return CITIES.find((c) => c.isDefault) ?? CITIES[0] ?? BUILTIN[1]!;
}

function setCities(next: City[]) {
  if (!next.length) return;
  CITIES.splice(0, CITIES.length, ...next);
  fallback = defaultCity().id;
  revision += 1;
  // Выбранный раньше город скрыли или удалили: переходим на город по умолчанию.
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && !CITIES.some((c) => c.id === saved)) localStorage.setItem(KEY, fallback);
  } catch {
    /* выбор останется в текущем сеансе */
  }
  window.dispatchEvent(new Event(CHANGE));
}

let loading: Promise<void> | null = null;

/** Загрузить список городов с сервера. Ошибка не мешает: остаётся сохранённый или встроенный список. */
export function loadCities(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = fetch('/api/cities', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<{ data?: CityRecord[] }>) : null))
    .then((body) => {
      const rows = Array.isArray(body?.data) ? body.data.filter((c) => !c.hidden) : [];
      if (!rows.length) return;
      try {
        localStorage.setItem(LIST_KEY, JSON.stringify(rows));
      } catch {
        /* без сохранения список придёт при следующем открытии */
      }
      setCities(rows.map(toCity));
    })
    .catch(() => undefined);
  return loading;
}

export function selectedCityId(): CityId {
  try {
    const value = localStorage.getItem(KEY);
    return CITIES.find((c) => c.id === value)?.id ?? fallback;
  } catch {
    return CITIES.some((c) => c.id === fallback) ? fallback : defaultCity().id;
  }
}

/** Ключ для подписки: меняется и при выборе другого города, и при обновлении списка. */
export function cityStateKey(): string {
  return `${selectedCityId()}|${revision}`;
}

export function getSelectedCity(): City {
  return CITIES.find((c) => c.id === selectedCityId()) ?? defaultCity();
}

export function selectCity(id: CityId) {
  if (!CITIES.some((c) => c.id === id)) return;
  fallback = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* Выбор остаётся в текущем сеансе. */
  }
  window.dispatchEvent(new Event(CHANGE));
}

export function subscribeCity(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === LIST_KEY || event.key === null) {
      if (event.key === LIST_KEY) {
        const saved = readSaved();
        if (saved) {
          CITIES.splice(0, CITIES.length, ...saved);
          revision += 1;
        }
      }
      listener();
    }
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener('storage', storage);
  };
}

/**
 * Городская выдача: сервер оставляет записи, точка которых внутри границы города.
 * `path` — где в записи точка (`place` у события, пусто — координаты в самой записи).
 */
export function cityLocationFilters(city: City, path = 'place'): CrudFilter[] {
  return [{ field: path ? `${path}@city` : '@city', operator: 'eq', value: city.id }];
}

/** Город по умолчанию на момент загрузки страницы. Для актуального — `defaultCity()`. */
export const DEFAULT_CITY: City = defaultCity();

/** Город события: по точке на карте; без точки — город по умолчанию. */
export function cityOfPlace(place: Partial<GeoPoint> | null | undefined): City {
  return cityOfPoint(place) ?? defaultCity();
}

/** Город, в котором находится точка (ближайший центр); null — если точки нет или она вне городов. */
export function cityOfPoint(point: Partial<GeoPoint> | null | undefined): City | null {
  if (typeof point?.lat !== 'number' || typeof point.lng !== 'number') return null;
  const p = { lat: point.lat, lng: point.lng };
  let best: City | null = null;
  let bestKm = Infinity;
  for (const c of CITIES) {
    const km = distanceKm(p, c.center);
    if (km <= c.radiusKm && km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return best;
}

/** Районы города для выпадающего списка; уже выбранный район остаётся в списке. */
export function districtsOf<T extends GeoPoint & { id: string; cityId?: string | null }>(
  districts: T[],
  city: City,
  keepId?: string | null,
): T[] {
  return districts.filter(
    (d) => d.id === keepId || (d.cityId !== undefined ? d.cityId === city.id : pointInCity(d, city)),
  );
}

/** Город по названию из профиля или карточки; неизвестное название — null. */
export function cityByName(name: string | null | undefined): City | null {
  return CITIES.find((c) => c.name === name) ?? null;
}

export function cityById(id: string | null | undefined): City | null {
  return CITIES.find((c) => c.id === id) ?? null;
}

export function pointInCity(point: GeoPoint, city: City): boolean {
  return distanceKm(point, city.center) <= city.radiusKm;
}
