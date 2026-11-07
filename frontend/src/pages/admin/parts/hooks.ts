import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Фильтры списка живут в адресе: ссылка из сводки открывает уже отфильтрованный список,
 * а «Назад» из карточки возвращает к тем же фильтрам.
 */
export function useUrlParams<K extends string>(defaults: Record<K, string>) {
  const [params, setParams] = useSearchParams();
  const keys = Object.keys(defaults) as K[];
  const signature = keys.map((k) => `${k}=${params.get(k) ?? ''}`).join('&');

  const values = useMemo(
    () => Object.fromEntries(keys.map((k) => [k, params.get(k) ?? defaults[k]])) as Record<K, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
            if (!v || v === defaults[k]) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );

  return [values, set] as const;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Поле поиска, которое пишет в адрес не на каждую букву. */
export function useSearchField(value: string, onCommit: (v: string) => void) {
  const [text, setText] = useState(value);
  const debounced = useDebounced(text);
  useEffect(() => {
    if (debounced !== value) onCommit(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return [text, setText] as const;
}
