import { zonedParts } from '@/lib/timezone';
import { venueTime } from '@/lib/venues';
import type { VenueSlotView } from '@/types/api';

/** Ссылка «Предложить встречу здесь»: форма создания с площадкой и окном. */
export function proposeLink(venueId: string, slot?: VenueSlotView | null, timeZone?: string, sportId?: string) {
  const p = new URLSearchParams({ venueId });
  if (slot && timeZone) {
    p.set('date', zonedParts(slot.startsAt, timeZone).date);
    p.set('time', venueTime(slot.startsAt, timeZone));
    p.set('durationMin', '120');
  }
  if (sportId) p.set('sportId', sportId);
  return `/events/new?${p.toString()}`;
}
