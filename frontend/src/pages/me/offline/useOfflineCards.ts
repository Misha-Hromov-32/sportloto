import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { ENGAGEMENT_API, useLiveGet } from '@/lib/api';
import type { OfflineCard } from '@/types/engagement';

/**
 * Н5: ближайшие записи хранятся на устройстве. Каждый раз, когда открываются «Мои занятия»
 * или карточка события, сохранённое обновляется; без сети экран показывает его с пометкой времени.
 */

export interface SavedCards {
  savedAt: string;
  cards: OfflineCard[];
}

const key = (userId: string) => `vmeste:offline-cards:${userId}`;

export function readSaved(userId: string | undefined): SavedCards | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(key(userId));
    const parsed = raw ? (JSON.parse(raw) as SavedCards) : null;
    return parsed && Array.isArray(parsed.cards) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSaved(userId: string, cards: OfflineCard[]) {
  try {
    localStorage.setItem(key(userId), JSON.stringify({ savedAt: new Date().toISOString(), cards }));
  } catch {
    /* хранилище недоступно (приватный режим) — без офлайна */
  }
}

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/** Сохраняет свежие карточки, пока есть связь, и отдаёт сохранённые. */
export function useOfflineCards(userId: string | undefined) {
  const online = useOnline();
  const { data, isError } = useLiveGet<OfflineCard[]>(
    ENGAGEMENT_API.offlineCards,
    ['events', 'participations'],
    Boolean(userId) && online,
  );
  const fresh = online && Array.isArray(data) ? data : null;
  useEffect(() => {
    if (userId && fresh) writeSaved(userId, fresh);
  }, [userId, fresh]);
  // Перечитываем сохранённое, когда меняется связь или пришли новые данные
  const saved = useMemo(() => readSaved(userId), [userId, online, fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return { online, failed: isError, saved };
}
