import { useInvalidate } from '@refinedev/core';
import { useEffect, useRef, useState } from 'react';

import { dayjs, formatTime } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';

/** С4: «до 18:40», «до завтра, 09:10». */
export function offerDeadline(until: string, now = dayjs()): string {
  const d = dayjs(until);
  if (d.isSame(now, 'day')) return `до ${formatTime(until)}`;
  if (d.isSame(now.add(1, 'day'), 'day')) return `до завтра, ${formatTime(until)}`;
  return `до ${d.format('D MMMM, HH:mm')}`;
}

export function offerTitle(until: string): string {
  return `Место для вас ${offerDeadline(until)}`;
}

function left(ms: number): string {
  if (ms < 60_000) return 'Осталось меньше минуты';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `Осталось ${count(minutes, WORDS.minute)}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `Осталось ${count(h, WORDS.hour)}${m ? ` ${count(m, WORDS.minute)}` : ''}`;
}

/**
 * Сколько осталось до конца резерва. Когда срок вышел, просим данные заново:
 * «сервер» при обращении передаст место следующему, и карточка покажет новое состояние.
 */
export function useOfferCountdown(until: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  const invalidate = useInvalidate();
  const expiredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    const end = Date.parse(until) - Date.now();
    const finish = end > 0 && end < 2 ** 31 - 1 ? window.setTimeout(() => setNow(Date.now()), end + 500) : 0;
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(finish);
    };
  }, [until]);
  const ms = until ? Date.parse(until) - now : 0;
  useEffect(() => {
    if (!until || ms > 0 || expiredFor.current === until) return;
    expiredFor.current = until;
    void invalidate({ resource: 'events', invalidates: ['all'] });
  }, [until, ms, invalidate]);
  return until ? left(Math.max(0, ms)) : null;
}
