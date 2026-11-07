import { useCallback, useEffect, useRef, useState } from 'react';

import { apiRequest } from '@/api/client';
import type { GeoPoint } from '@/types/domain';

/**
 * Адрес и точка встречи заполняют друг друга: по введённому адресу ставим точку на карте,
 * по точке на карте подставляем адрес. Что человек написал или поставил сам, не перетираем:
 * для своего адреса предлагаем замену кнопкой. Поиск адресов на сервере (/api/geo/*);
 * если он не отвечает, оба поля работают вручную, как раньше.
 */

export interface GeoPlace {
  label: string;
  detail: string;
  lat: number;
  lng: number;
}

export function searchPlaces(q: string, cityId: string): Promise<GeoPlace[]> {
  return apiRequest<{ places: GeoPlace[] }>('get', '/geo/search', { query: { q, cityId } }).then(
    (r) => r.places ?? [],
  );
}

export function reversePlace(point: GeoPoint): Promise<GeoPlace | null> {
  return apiRequest<{ place: GeoPlace | null }>('get', '/geo/reverse', {
    query: { lat: point.lat, lng: point.lng },
  }).then((r) => r.place ?? null);
}

export type GeoStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'done'; text: string }
  | { kind: 'offer'; label: string }
  | { kind: 'miss'; text: string };

const SEARCH_DELAY = 350;
const MIN_QUERY = 3;

interface Options {
  address: string;
  point: GeoPoint | null;
  cityId: string;
  /** Поле адреса есть на экране (в редактировании части полей его может не быть). */
  withAddress: boolean;
  set: (patch: { address?: string; point?: GeoPoint | null }) => void;
  showMap: () => void;
}

export function useAddressPoint({ address, point, cityId, withAddress, set, showMap }: Options) {
  const [places, setPlaces] = useState<GeoPlace[]>([]);
  const [status, setStatus] = useState<GeoStatus>({ kind: 'idle' });
  // Что заполнили сами: такие значения можно обновлять дальше без спроса.
  const autoAddress = useRef<string | null>(null);
  const autoPoint = useRef(false);
  const typed = useRef(false);
  const searchSeq = useRef(0);
  const reverseSeq = useRef(0);
  const latest = useRef({ address, point, set, showMap });
  useEffect(() => {
    latest.current = { address, point, set, showMap };
  });

  // Подсказки по мере ввода адреса.
  useEffect(() => {
    if (!withAddress || !typed.current) return;
    const q = address.trim();
    if (q.length < MIN_QUERY) {
      setPlaces([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      searchPlaces(q, cityId)
        .then((found) => {
          if (seq === searchSeq.current) setPlaces(found);
        })
        .catch(() => {
          if (seq === searchSeq.current) setPlaces([]);
        });
    }, SEARCH_DELAY);
    return () => window.clearTimeout(timer);
  }, [address, cityId, withAddress]);

  const putPoint = useCallback((place: GeoPlace) => {
    autoPoint.current = true;
    latest.current.set({ point: { lat: place.lat, lng: place.lng } });
    latest.current.showMap();
  }, []);

  /** Выбрана подсказка: адрес и точка сразу. */
  const choose = useCallback(
    (place: GeoPlace) => {
      typed.current = false;
      autoAddress.current = place.label;
      latest.current.set({ address: place.label });
      putPoint(place);
      setPlaces([]);
      setStatus({ kind: 'done', text: 'Точка на карте стоит по адресу. Проверьте и при необходимости передвиньте' });
    },
    [putPoint],
  );

  /** Человек печатает адрес. */
  const type = useCallback((value: string) => {
    typed.current = true;
    autoAddress.current = null;
    latest.current.set({ address: value });
    setStatus({ kind: 'idle' });
  }, []);

  /** Ушли из поля адреса: если точки нет или её ставили мы, ставим по первому найденному месту. */
  const settle = useCallback(async () => {
    const q = latest.current.address.trim();
    if (!withAddress || !typed.current || q.length < MIN_QUERY) return;
    if (latest.current.point && !autoPoint.current) return;
    typed.current = false;
    const seq = ++searchSeq.current;
    setStatus({ kind: 'busy', text: 'Ищем адрес на карте…' });
    try {
      const [first] = await searchPlaces(q, cityId);
      if (seq !== searchSeq.current) return;
      if (first) {
        putPoint(first);
        setStatus({ kind: 'done', text: `Точка поставлена: ${first.label}. Проверьте её на карте` });
      } else {
        setStatus({ kind: 'miss', text: 'Не нашли этот адрес на карте. Отметьте точку сами' });
      }
    } catch {
      if (seq === searchSeq.current) setStatus({ kind: 'idle' });
    }
  }, [cityId, putPoint, withAddress]);

  /** Точку поставили на карте: подставляем адрес или предлагаем его. */
  const movePoint = useCallback(
    async (next: GeoPoint | null) => {
      autoPoint.current = false;
      latest.current.set({ point: next });
      if (!next || !withAddress) {
        setStatus({ kind: 'idle' });
        return;
      }
      const seq = ++reverseSeq.current;
      setStatus({ kind: 'busy', text: 'Определяем адрес точки…' });
      try {
        const place = await reversePlace(next);
        if (seq !== reverseSeq.current) return;
        if (!place) {
          setStatus({ kind: 'idle' });
          return;
        }
        const current = latest.current.address.trim();
        if (!current || current === autoAddress.current) {
          autoAddress.current = place.label;
          typed.current = false;
          latest.current.set({ address: place.label });
          setStatus({ kind: 'done', text: 'Адрес подставлен по точке. Его можно уточнить' });
        } else if (current !== place.label) {
          setStatus({ kind: 'offer', label: place.label });
        } else {
          setStatus({ kind: 'idle' });
        }
      } catch {
        if (seq === reverseSeq.current) setStatus({ kind: 'idle' });
      }
    },
    [withAddress],
  );

  /** Принять адрес, найденный по точке, вместо написанного. */
  const acceptOffer = useCallback(() => {
    if (status.kind !== 'offer') return;
    autoAddress.current = status.label;
    typed.current = false;
    latest.current.set({ address: status.label });
    setStatus({ kind: 'done', text: 'Адрес заменён. Его можно уточнить' });
  }, [status]);

  return { places, status, choose, type, settle, movePoint, acceptOffer };
}
