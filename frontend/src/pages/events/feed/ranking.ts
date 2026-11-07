import type { EventView } from '@/types/api';
import { normalize } from '@/lib/text';

export type EventOrder = 'relevance' | 'time';
export function orderEvents(
  events: EventView[],
  order: EventOrder,
  query: string,
  interests: readonly string[] = [],
): EventView[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const score = (event: EventView) => {
    const title = normalize(`${event.title} ${event.sport.name}`);
    const text = normalize(`${event.description} ${event.place.address}`);
    return (
      words.reduce((sum, word) => sum + (title.includes(word) ? 8 : text.includes(word) ? 2 : 0), 0) +
      (interests.includes(event.sportId) ? 4 : 0) +
      (event.matchScore ?? 0)
    );
  };
  return [...events].sort(
    (a, b) =>
      (order === 'relevance' ? score(b) - score(a) : 0) ||
      a.startsAt.localeCompare(b.startsAt) ||
      a.id.localeCompare(b.id),
  );
}
