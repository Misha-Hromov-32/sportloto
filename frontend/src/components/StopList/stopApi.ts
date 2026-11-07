import type { ApiError } from '@/lib/api';
import type { StopOwnerKey } from '@/types/api';
import type { OrganizerRef, StopReasonCode, StopTerm } from '@/types/domain';

/** D-16: стоп-лист организатора. Контракт — `.../stop-list` и `/participations/:id/remove`. */
export const STOP_API = {
  /** GET → `StopListView`. */
  list: (owner: StopOwnerKey) => `/stop-list?owner=${encodeURIComponent(owner)}`,
  /** GET → `StopPreview`: кого добавляем и что будет. */
  preview: (owner: StopOwnerKey, userId: string) =>
    `/stop-list/preview?owner=${encodeURIComponent(owner)}&userId=${encodeURIComponent(userId)}`,
  /** POST `StopAddInput` → `StopAddResult`. */
  add: '/stop-list',
  /** DELETE → обновлённый `StopListView`. */
  entry: (id: string) => `/stop-list/${id}`,
  /** POST `RemoveParticipantInput` → `ParticipantView`. */
  removeParticipant: (participationId: string) => `/participations/${participationId}/remove`,
} as const;

export const STOP_LIVE = ['stopList', 'participations', 'events', 'demo'];

export const STOP_REASONS: { value: StopReasonCode; label: string }[] = [
  { value: 'no_show', label: 'Не приходит без предупреждения' },
  { value: 'rude', label: 'Грубое поведение' },
  { value: 'rules', label: 'Нарушает правила встречи' },
  { value: 'other', label: 'Другое' },
];

export const STOP_TERMS: { value: StopTerm; label: string }[] = [
  { value: 'forever', label: 'Пока не уберу' },
  { value: 'month', label: 'На месяц' },
  { value: 'three_months', label: 'На 3 месяца' },
];

/** Чей стоп-лист действует на встрече: личный организатор или клуб. */
export function stopOwnerOf(organizer: OrganizerRef): StopOwnerKey {
  return organizer.kind === 'org' ? `org:${organizer.id}` : `user:${organizer.id}`;
}

/** «мои встречи» или «встречи клуба» — в зависимости от владельца списка. */
export function ownerMeetings(owner: StopOwnerKey): string {
  return owner.startsWith('org:') ? 'встречи клуба' : 'мои встречи';
}

/** Текст ошибки поля из ответа сервера: `errors.reasonText` или `errors['stop.reasonText']`. */
export function fieldError(error: unknown, ...keys: string[]): string {
  const errors = (error as ApiError | null)?.errors as Record<string, unknown> | undefined;
  if (!errors) return '';
  for (const key of keys) {
    const value = errors[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    if (value && typeof value === 'object' && 'message' in value) return String(value.message);
  }
  return '';
}

export function firstName(name: string): string {
  return name.split(' ')[0] || name;
}
