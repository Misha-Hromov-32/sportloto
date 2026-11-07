import type { StopEntryView } from '@/types/api';
import type { StopReasonCode, StopTerm } from '@/types/domain';

export interface StopDraft {
  reasonCode: StopReasonCode | null;
  reasonText: string;
  note: string;
  term: StopTerm;
  cancelUpcoming: boolean;
}

export type StopErrors = Partial<Record<'reasonCode' | 'reasonText' | 'note', string>>;

export function draftFrom(existing: StopEntryView | null): StopDraft {
  return {
    reasonCode: existing?.reasonCode ?? null,
    reasonText: existing?.reasonText ?? '',
    note: existing?.note ?? '',
    term: existing && existing.until ? 'month' : 'forever',
    cancelUpcoming: true,
  };
}

export function validateDraft(d: StopDraft): StopErrors {
  if (!d.reasonCode) return { reasonCode: 'Выберите причину' };
  if (d.reasonCode === 'other' && d.reasonText.trim().length < 5)
    return { reasonText: 'Напишите причину, хотя бы несколько слов' };
  return {};
}

export function draftPayload(d: StopDraft) {
  return {
    reasonCode: d.reasonCode!,
    ...(d.reasonCode === 'other' ? { reasonText: d.reasonText.trim() } : {}),
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
    term: d.term,
    cancelUpcoming: d.cancelUpcoming,
  };
}
