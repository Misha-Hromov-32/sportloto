import type { CompanionView, SportView } from '@/types/api';
import type { Readiness, SkillLevel } from '@/types/domain';
import type { CompanionInput } from '@/types/inputs';

export interface CompanionForm {
  sport: SportView | null;
  newSportName: string;
  sportQuery: string;
  text: string;
  districtId: string | null;
  when: string;
  level: SkillLevel;
  readiness: Readiness;
}

export const EMPTY_COMPANION: CompanionForm = {
  sport: null,
  newSportName: '',
  sportQuery: '',
  text: '',
  districtId: null,
  when: '',
  level: 'beginner',
  readiness: 'join',
};

export type CompanionErrors = Partial<Record<'sport' | 'text' | 'when', string>>;

export const WHEN_OPTIONS = ['Будни утром', 'Будни вечером', 'Выходные утром', 'Выходные днём', 'Когда угодно'];

export function validateCompanion(form: CompanionForm): CompanionErrors {
  const errors: CompanionErrors = {};
  if (!form.sport && form.newSportName.trim().length < 2) errors.sport = 'Выберите направление или впишите своё';
  if (form.text.trim().length < 10) errors.text = 'Расскажите, кого ищете, хотя бы одним предложением';
  if (!form.when.trim()) errors.when = 'Напишите, когда вам удобно';
  return errors;
}

export function toCompanionInput(form: CompanionForm, createdWithAssistant: boolean): CompanionInput {
  return {
    ...(form.sport ? { sportId: form.sport.id } : { newSportName: form.newSportName.trim() }),
    text: form.text.trim(),
    districtId: form.districtId,
    when: form.when.trim(),
    level: form.level,
    readiness: form.readiness,
    createdWithAssistant,
  };
}

/** Черновик помощника → поля объявления. Что человек уже поменял сам, не трогаем. */
export function mergeCompanionDraft(
  form: CompanionForm,
  base: CompanionForm,
  draft: Partial<CompanionInput>,
  sports: SportView[],
): { form: CompanionForm; touched: (keyof CompanionForm)[] } {
  const next: CompanionForm = { ...base };
  if (draft.sportId) {
    const sport = sports.find((s) => s.id === draft.sportId);
    if (sport) next.sport = sport;
  } else if (draft.newSportName) next.newSportName = draft.newSportName;
  if (draft.text) next.text = draft.text;
  if (draft.districtId) next.districtId = draft.districtId;
  if (draft.when) next.when = draft.when;
  if (draft.level) next.level = draft.level;
  if (draft.readiness) next.readiness = draft.readiness;
  const touched = (Object.keys(form) as (keyof CompanionForm)[]).filter(
    (k) => JSON.stringify(form[k]) !== JSON.stringify(base[k]),
  );
  const merged = { ...next } as Record<keyof CompanionForm, unknown>;
  for (const k of touched) merged[k] = form[k];
  return { form: merged as CompanionForm, touched };
}

/** Объявление-превью из незаконченной формы — та же карточка, что увидят другие. */
export function previewCompanion(
  form: CompanionForm,
  author: { id: string; name: string; avatarUrl: string | null; initials: string },
  districtName: string | null,
): CompanionView {
  const sport: SportView = form.sport ?? {
    id: 'new',
    name: form.newSportName || 'Направление',
    icon: null,
    kind: 'custom',
    popular: false,
    categoryIds: [],
    synonyms: [],
    fields: [],
  };
  return {
    id: 'preview',
    authorId: author.id,
    sportId: sport.id,
    text: form.text.trim() || 'Кого ищете и чем хотите заниматься',
    districtId: form.districtId,
    point: null,
    when: form.when.trim() || 'Когда удобно',
    level: form.level,
    readiness: form.readiness,
    metoo: [],
    status: 'open',
    eventId: null,
    createdWithAssistant: false,
    createdAt: new Date().toISOString(),
    author: { ...author, level: form.level },
    sport,
    districtName,
    metooCount: 0,
    metooPeople: [],
    iMetoo: false,
    isMine: true,
    matchReasons: [],
    distanceKm: null,
  };
}

/** Ссылка «Собрать встречу»: форма события получит направление, район, уровень и откликнувшихся. */
export function gatherLink(c: CompanionView): string {
  const p = new URLSearchParams();
  p.set('companionId', c.id);
  if (c.sport.id && c.sport.id !== 'new') p.set('sportId', c.sport.id);
  if (c.districtId) p.set('districtId', c.districtId);
  p.set('level', c.level);
  if (c.level === 'beginner') p.set('beginners', '1');
  const when = c.when.toLowerCase();
  if (/утр/.test(when)) p.set('dayPart', 'morning');
  else if (/вечер|после 1[7-9]|после 2/.test(when)) p.set('dayPart', 'evening');
  else if (/днём|днем|день/.test(when)) p.set('dayPart', 'day');
  if (c.metooCount + 1 > 12) p.set('capacity', String(c.metooCount + 1));
  return `/events/new?${p.toString()}`;
}
