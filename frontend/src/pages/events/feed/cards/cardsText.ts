import type { EventView } from '@/types/api';
import type { ParticipationStatus } from '@/types/domain';

export const waitlistOnly = (e: EventView) => e.capacity !== null && e.counts.spotsLeft === 0;

/** Отметка на карточке, улетающей вверх после записи. */
export const JOINED_TEXT: Partial<Record<ParticipationStatus, string>> = {
  confirmed: 'Вы записаны',
  pending: 'Заявка отправлена',
  waitlist: 'Вы в листе ожидания',
};
