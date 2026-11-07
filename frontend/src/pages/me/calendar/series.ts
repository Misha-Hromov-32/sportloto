import type { EventView } from '@/types/api';

import { participantStatus } from '../parts/groups';

/**
 * С10: встречи одной серии в «Предстоящих» сворачиваются под ближайшую.
 * Встречи, где нужно что-то сделать (подтвердить изменения, ответить на место), остаются на виду.
 */
export function groupSeries(events: EventView[]): { visible: EventView[]; rest: Map<string, EventView[]> } {
  const bySeries = new Map<string, EventView[]>();
  for (const e of events) {
    if (!e.series || e.state !== 'upcoming' || participantStatus(e).action.kind !== 'route') continue;
    bySeries.set(e.series.id, [...(bySeries.get(e.series.id) ?? []), e]);
  }
  const rest = new Map<string, EventView[]>();
  const hidden = new Set<string>();
  for (const list of bySeries.values()) {
    if (list.length < 2) continue;
    const [first, ...others] = [...list].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    rest.set(first!.id, others);
    others.forEach((e) => hidden.add(e.id));
  }
  return { visible: events.filter((e) => !hidden.has(e.id)), rest };
}
