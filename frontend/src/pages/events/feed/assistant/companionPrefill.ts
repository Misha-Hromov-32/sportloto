import type { MatchResult } from '@/types/api';

import type { CompanionForm } from '../../../companions/parts/model';

export type CompanionPrefill = NonNullable<MatchResult['companion']>;

const WHY = 'Из вашей фразы в подборе';

/** Черновик «Ищу компанию», который подбор передаёт при переходе на форму. */
export function readCompanionPrefill(state: unknown): CompanionPrefill | null {
  const prefill = (state as { prefill?: CompanionPrefill } | null)?.prefill;
  return prefill && typeof prefill.text === 'string' ? prefill : null;
}

export function applyCompanionPrefill(base: CompanionForm, p: CompanionPrefill): CompanionForm {
  return {
    ...base,
    text: p.text,
    when: p.when,
    level: p.level,
    districtId: p.districtId ?? base.districtId,
  };
}

export function prefillMarks(p: CompanionPrefill) {
  return {
    text: WHY,
    when: WHY,
    level: WHY,
    ...(p.districtId ? { district: WHY } : {}),
    ...(p.sportId ? { sport: WHY } : {}),
  };
}
