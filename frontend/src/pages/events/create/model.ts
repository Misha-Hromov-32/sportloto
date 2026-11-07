import { publicDiscussion } from '@/lib/eventRules';
import { dayjs } from '@/lib/dates';
import { CITIES, cityOfPlace, cityOfPoint, getSelectedCity } from '@/lib/cities';
import { zonedParts, zonedToIso } from '@/lib/timezone';
import type { DraftQuestion, EventDetails, SportView } from '@/types/api';
import type { CancelPolicy, EventLevel, GeoPoint, Intensity, JoinMode, Price } from '@/types/domain';
import type { PaymentMode } from '@/types/payments';
import type { Composition, EventAccessExtra, EventVisibility, EventFamily } from '@/types/domain';
import type { EventInput, EventPatch } from '@/types/inputs';
import type { GearLineInput } from '@/types/inventory';

export type StepKey = 'what' | 'when' | 'who' | 'first' | 'review';

export const STEPS: { key: StepKey; title: string; short: string }[] = [
  { key: 'what', title: 'Что за встреча', short: 'Что' },
  { key: 'when', title: 'Когда и где', short: 'Когда и где' },
  { key: 'who', title: 'Кто и как записаться', short: 'Кто и как' },
  { key: 'first', title: 'Первый шаг и деньги', short: 'Первый шаг' },
  { key: 'review', title: 'Так увидят участники', short: 'Проверка' },
];

/** Состояние режима помощника: живёт на странице, чтобы переключение режимов ничего не теряло. */
export interface AssistantState {
  phase: 'input' | 'questions' | 'preview';
  text: string;
  questions: DraftQuestion[];
  step: number;
}

export const EMPTY_ASSISTANT: AssistantState = { phase: 'input', text: '', questions: [], step: 0 };

export type PriceKind = Price['kind'];

export interface EventForm {
  orgId: string | null;
  sport: SportView | null;
  newSportName: string;
  /** Человек сам нажал «Добавить как новое»: похожие направления в каталоге его не останавливают. */
  confirmNewSport: boolean;
  sportQuery: string;
  title: string;
  description: string;
  extra: Record<string, string>;
  date: string;
  time: string;
  /** Пояс места встречи; пусто — пояс города, выбранного в шапке. */
  timeZone: string;
  durationMin: number;
  repeat: boolean;
  repeatUntil: string;
  address: string;
  districtId: string | null;
  howToFind: string;
  point: GeoPoint | null;
  joinMode: JoinMode;
  capacity: number | null;
  minParticipants: number | null;
  level: EventLevel;
  beginnersWelcome: boolean;
  discussion: 'everyone' | 'participants';
  privateInfo: string;
  age: string;
  bring: string;
  preparation: string;
  intensity: Intensity;
  amenities: string[];
  firstTimeNote: string;
  priceKind: PriceKind;
  priceAmount: number | null;
  priceTotal: number | null;
  priceNote: string;
  paymentNote: string;
  /** Оплата на сайте или на месте. */
  paymentMode: PaymentMode;
  cancelKind: CancelPolicy['kind'];
  cancelHours: number;
  cancelTime: string;
  companionId: string | null;
  coverUrl: string | null;
  /** В3: что нужно для игры. */
  gear: GearLineInput[];
  /** В4: выбранная площадка. */
  venueId: string | null;
  /** Н1: что организатор добавляет к условиям площадки. */
  accessExtras: EventAccessExtra[];
  /** В7: кто может записаться. */
  composition: Composition;
  visibility: EventVisibility;
  family: EventFamily | null;
  againFrom: string | null;
}

export type FormErrors = Partial<Record<string, string>>;

export const EMPTY_FORM: EventForm = {
  orgId: null,
  sport: null,
  newSportName: '',
  confirmNewSport: false,
  sportQuery: '',
  title: '',
  description: '',
  extra: {},
  date: '',
  time: '',
  timeZone: '',
  durationMin: 90,
  repeat: false,
  repeatUntil: '',
  address: '',
  districtId: null,
  howToFind: '',
  point: null,
  joinMode: 'open',
  capacity: 12,
  minParticipants: null,
  level: 'any',
  beginnersWelcome: true,
  discussion: 'everyone',
  privateInfo: '',
  age: '',
  bring: '',
  preparation: '',
  intensity: 'medium',
  amenities: [],
  firstTimeNote: '',
  priceKind: 'free',
  priceAmount: null,
  priceTotal: null,
  priceNote: 'на аренду',
  paymentNote: '',
  paymentMode: 'offline',
  cancelKind: 'anytime',
  cancelHours: 3,
  cancelTime: '18:00',
  companionId: null,
  coverUrl: null,
  gear: [],
  venueId: null,
  accessExtras: [],
  composition: 'mixed',
  visibility: 'public',
  family: null,
  againFrom: null,
};

export const AMENITY_OPTIONS = [
  'Раздевалка',
  'Душ',
  'Туалет',
  'Питьевая вода',
  'Парковка',
  'Инвентарь на месте',
];

export const MAX_REPEAT_WEEKS = 12;

/** Пояс места встречи: у правки — город события, у нового — выбранный в шапке город. */
export const formTimeZone = (form: Partial<Pick<EventForm, 'timeZone' | 'point'>>) =>
  (form.point && cityOfPoint(form.point)?.timeZone) || form.timeZone || getSelectedCity().timeZone;

export const formTimeCity = (form: Partial<Pick<EventForm, 'timeZone' | 'point'>>) => {
  const selected = getSelectedCity();
  return (
    (form.point && cityOfPoint(form.point)) ||
    (selected.timeZone === formTimeZone(form)
      ? selected
      : CITIES.find((c) => c.timeZone === formTimeZone(form))) ||
    selected
  );
};

/** Дата и время в форме — местные для места встречи («в 10:00 по Красноярску»). */
export function startsAtOf(
  form: Pick<EventForm, 'date' | 'time'> & Partial<Pick<EventForm, 'timeZone' | 'point'>>,
): string | null {
  if (!form.date || !form.time) return null;
  return zonedToIso(form.date, form.time, formTimeZone(form));
}

/** Последняя встреча серии — в тот же час, что и первая: так дата «до…» входит в серию. */
function repeatUntilOf(form: EventForm): dayjs.Dayjs | null {
  if (!form.repeat || !form.repeatUntil) return null;
  const iso = zonedToIso(form.repeatUntil, form.time || '23:59', formTimeZone(form));
  return iso ? dayjs(iso) : null;
}

export function paymentModeOf(form: EventForm): PaymentMode {
  return form.priceKind === 'free' ? 'offline' : form.paymentMode;
}

export function priceOf(form: EventForm): Price {
  if (form.priceKind === 'fixed') return { kind: 'fixed', amount: Number(form.priceAmount ?? 0) };
  if (form.priceKind === 'split')
    return { kind: 'split', total: Number(form.priceTotal ?? 0), note: form.priceNote.trim() };
  return { kind: 'free' };
}

export function cancelPolicyOf(form: EventForm): CancelPolicy {
  if (form.cancelKind === 'hoursBefore') return { kind: 'hoursBefore', hours: form.cancelHours };
  if (form.cancelKind === 'eveBefore') return { kind: 'eveBefore', time: form.cancelTime };
  return { kind: 'anytime' };
}

export function sportNameOf(form: EventForm): string {
  return form.sport?.name ?? form.newSportName.trim();
}

/** Сколько встреч создаст повтор «каждую неделю до…» — так же считает сервер. */
export function seriesCount(form: EventForm): number {
  const start = startsAtOf(form);
  const until = repeatUntilOf(form);
  if (!start || !until) return 1;
  let n = 1;
  let next = dayjs(start).add(1, 'week');
  while (!next.isAfter(until) && n < MAX_REPEAT_WEEKS) {
    n += 1;
    next = next.add(1, 'week');
  }
  return n;
}

/** В3: пустые строки списка инвентаря не отправляем. */
const gearOf = (form: EventForm): GearLineInput[] =>
  form.gear.filter((l) => l.name.trim()).map((l) => ({ ...l, name: l.name.trim() }));

const firstStepOf = (form: EventForm) => ({
  intensity: form.intensity,
  bring: form.bring.trim(),
  preparation: form.preparation.trim(),
  age: form.age.trim(),
  howToFind: form.howToFind.trim(),
  amenities: form.amenities,
  firstTimeNote: form.firstTimeNote.trim(),
});

const placeOf = (form: EventForm): EventInput['place'] => ({
  address: form.address.trim(),
  landmark: '',
  districtId: form.districtId,
  ...(form.point
    ? { lat: form.point.lat, lng: form.point.lng }
    : !form.districtId && getSelectedCity().id !== 'krasnoyarsk'
      ? getSelectedCity().center
      : {}),
});

export function toInput(form: EventForm, createdWithAssistant: boolean): EventInput {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    ...(form.sport
      ? { sportId: form.sport.id }
      : { newSportName: form.newSportName.trim(), confirmNew: form.confirmNewSport }),
    orgId: form.orgId,
    startsAt: startsAtOf(form) ?? '',
    durationMin: form.durationMin,
    place: placeOf(form),
    level: form.level,
    beginnersWelcome: form.beginnersWelcome,
    firstStep: firstStepOf(form),
    price: priceOf(form),
    paymentNote: form.paymentNote.trim(),
    paymentMode: paymentModeOf(form),
    cancelPolicy: cancelPolicyOf(form),
    joinMode: form.joinMode,
    capacity: form.capacity,
    minParticipants: form.minParticipants,
    privateInfo: form.privateInfo.trim(),
    discussion: publicDiscussion(form) ? 'everyone' : form.discussion,
    extra: cleanExtra(form.extra),
    coverUrl: form.coverUrl,
    repeatWeeklyUntil: repeatUntilOf(form)?.toISOString() ?? null,
    createdWithAssistant,
    companionId: form.companionId,
    gear: gearOf(form), // В3
    venueId: form.venueId,
    accessExtras: form.accessExtras,
    composition: form.composition, // В7
    visibility: form.visibility,
    family: form.family,
    againFrom: form.againFrom,
  };
}

export function toPatch(form: EventForm): EventPatch {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    startsAt: startsAtOf(form) ?? '',
    durationMin: form.durationMin,
    place: placeOf(form),
    level: form.level,
    beginnersWelcome: form.beginnersWelcome,
    firstStep: firstStepOf(form),
    price: priceOf(form),
    paymentNote: form.paymentNote.trim(),
    paymentMode: paymentModeOf(form),
    cancelPolicy: cancelPolicyOf(form),
    joinMode: form.joinMode,
    capacity: form.capacity,
    minParticipants: form.minParticipants,
    privateInfo: form.privateInfo.trim(),
    coverUrl: form.coverUrl,
    discussion: publicDiscussion(form) ? 'everyone' : form.discussion,
    extra: cleanExtra(form.extra),
    gear: gearOf(form), // В3
    venueId: form.venueId,
    accessExtras: form.accessExtras,
    composition: form.composition, // В7
    visibility: form.visibility,
    family: form.family,
  };
}

function cleanExtra(extra: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(extra).filter(([, v]) => v.trim()));
}

export function fromEvent(e: EventDetails): EventForm {
  const timeZone = cityOfPlace(e.place).timeZone;
  const start = zonedParts(e.startsAt, timeZone);
  return {
    ...EMPTY_FORM,
    orgId: e.organizer.kind === 'org' ? e.organizer.id : null,
    sport: e.sport,
    title: e.title,
    description: e.description,
    extra: { ...e.extra },
    date: start.date,
    time: start.time,
    timeZone,
    durationMin: e.durationMin,
    address: e.place.address,
    districtId: e.place.districtId,
    howToFind: e.firstStep.howToFind || e.place.landmark,
    point: { lat: e.place.lat, lng: e.place.lng },
    joinMode: e.joinMode,
    capacity: e.capacity,
    minParticipants: e.minParticipants,
    level: e.level,
    beginnersWelcome: e.beginnersWelcome,
    discussion: e.discussion,
    privateInfo: e.privateInfo,
    age: e.firstStep.age,
    bring: e.firstStep.bring,
    preparation: e.firstStep.preparation,
    intensity: e.firstStep.intensity,
    amenities: [...e.firstStep.amenities],
    firstTimeNote: e.firstStep.firstTimeNote,
    priceKind: e.price.kind,
    priceAmount: e.price.kind === 'fixed' ? e.price.amount : null,
    priceTotal: e.price.kind === 'split' ? e.price.total : null,
    priceNote: e.price.kind === 'split' ? e.price.note : EMPTY_FORM.priceNote,
    paymentNote: e.paymentNote,
    paymentMode: e.paymentMode ?? 'offline',
    cancelKind: e.cancelPolicy.kind,
    cancelHours: e.cancelPolicy.kind === 'hoursBefore' ? e.cancelPolicy.hours : EMPTY_FORM.cancelHours,
    cancelTime: e.cancelPolicy.kind === 'eveBefore' ? e.cancelPolicy.time : EMPTY_FORM.cancelTime,
    coverUrl: e.coverUrl,
    gear: (e.gear ?? []).map((l) => ({ id: l.id, name: l.name, kind: l.kind, quantity: l.quantity })), // В3
    venueId: e.venueId ?? null,
    accessExtras: [...(e.accessExtras ?? [])],
    composition: e.composition ?? 'mixed', // В7
    visibility: e.visibility ?? 'public',
    family: e.family ? { ...e.family } : null,
  };
}

const DAY_PART_TIME: Record<string, string> = { morning: '10:00', day: '13:00', evening: '19:00' };
const LEVELS: EventLevel[] = ['any', 'beginner', 'amateur', 'experienced'];

const yes = (v: string | null) => v === '1' || v === 'true';

/**
 * Предзаполнение из адресной строки: так приходят «Создать своё» из пустой выдачи ленты
 * и «Собрать встречу» из «Ищу компанию». Направление по `sportId` подставляет страница, когда загрузит каталог.
 */
export function fromQuery(params: URLSearchParams): { patch: Partial<EventForm>; sportId: string | null } {
  const patch: Partial<EventForm> = {};
  const now = dayjs();
  const title = params.get('title');
  if (title) patch.title = title;
  const description = params.get('description');
  if (description) patch.description = description;
  const sportName = params.get('sport') ?? (params.get('sportId') ? null : params.get('q'));
  if (sportName) patch.sportQuery = sportName;

  const date = params.get('date');
  const when = params.get('when');
  if (date && dayjs(date).isValid()) patch.date = dayjs(date).format('YYYY-MM-DD');
  else if (when === 'today') patch.date = now.format('YYYY-MM-DD');
  else if (when === 'tomorrow') patch.date = now.add(1, 'day').format('YYYY-MM-DD');
  else if (when === 'weekend') {
    const dow = now.isoWeekday();
    patch.date = (dow >= 6 ? now : now.add(6 - dow, 'day')).format('YYYY-MM-DD');
  }
  const time = params.get('time');
  if (time && /^\d{2}:\d{2}$/.test(time)) patch.time = time;
  else if (params.get('dayPart')) patch.time = DAY_PART_TIME[params.get('dayPart')!] ?? '';

  const districtId = params.get('districtId');
  if (districtId) patch.districtId = districtId;
  const address = params.get('address');
  if (address) patch.address = address;
  const level = params.get('level') as EventLevel | null;
  if (level && LEVELS.includes(level)) patch.level = level;
  const composition = params.get('composition'); // В7: «Создать своё» из ленты с фильтром состава
  if (composition === 'women' || composition === 'men') patch.composition = composition;
  if (yes(params.get('beginners'))) {
    patch.beginnersWelcome = true;
    if (!level) patch.level = 'beginner';
  }
  if (yes(params.get('free'))) patch.priceKind = 'free';
  const joinMode = params.get('joinMode');
  if (joinMode === 'open' || joinMode === 'approval') patch.joinMode = joinMode;
  const capacity = Number(params.get('capacity'));
  if (Number.isInteger(capacity) && capacity >= 2) patch.capacity = capacity;
  const companionId = params.get('companionId');
  if (companionId) patch.companionId = companionId;
  const orgId = params.get('orgId') ?? params.get('org');
  if (orgId) patch.orgId = orgId;
  // В4: «Предложить встречу здесь» со страницы площадки
  const venueId = params.get('venueId');
  if (venueId) patch.venueId = venueId;
  const durationMin = Number(params.get('durationMin'));
  if (Number.isInteger(durationMin) && durationMin >= 15 && durationMin <= 720)
    patch.durationMin = durationMin;
  return { patch, sportId: params.get('sportId') };
}

/** Черновик помощника → поля формы. Помощник не трогает то, чего не понял. */
export function applyDraft(
  form: EventForm,
  draft: Partial<EventInput>,
  sports: SportView[],
): { form: EventForm; time: boolean } {
  const next: EventForm = { ...form };
  if (draft.sportId) {
    const sport = sports.find((s) => s.id === draft.sportId);
    if (sport) {
      next.sport = sport;
      next.newSportName = '';
    }
  } else if (draft.newSportName) {
    next.sport = null;
    next.newSportName = draft.newSportName;
    next.confirmNewSport = false;
  }
  if (draft.title) next.title = draft.title;
  if (draft.description) next.description = draft.description;
  let time = false;
  if (draft.startsAt) {
    const d = dayjs(draft.startsAt);
    next.date = d.format('YYYY-MM-DD');
    next.time = d.format('HH:mm');
    time = true;
  }
  if (draft.place?.address) {
    next.address = draft.place.address;
    next.districtId = draft.place.districtId ?? null;
    next.point =
      draft.place.lat !== undefined && draft.place.lng !== undefined
        ? { lat: draft.place.lat, lng: draft.place.lng }
        : null;
  }
  if (draft.capacity !== undefined) next.capacity = draft.capacity;
  if (draft.minParticipants !== undefined) next.minParticipants = draft.minParticipants;
  if (draft.joinMode) next.joinMode = draft.joinMode;
  if (draft.level) next.level = draft.level;
  if (draft.beginnersWelcome !== undefined) next.beginnersWelcome = draft.beginnersWelcome;
  if (draft.price) {
    next.priceKind = draft.price.kind;
    if (draft.price.kind === 'fixed') next.priceAmount = draft.price.amount;
    if (draft.price.kind === 'split') {
      next.priceTotal = draft.price.total;
      next.priceNote = draft.price.note || next.priceNote;
    }
  }
  if (draft.firstStep) {
    if (draft.firstStep.bring) next.bring = draft.firstStep.bring;
    if (draft.firstStep.firstTimeNote) next.firstTimeNote = draft.firstStep.firstTimeNote;
  }
  return { form: next, time };
}

export function validateStep(step: StepKey, form: EventForm, opts: { edit: boolean }): FormErrors {
  const errors: FormErrors = {};
  if (step === 'what') {
    if (!form.sport && form.newSportName.trim().length < 2)
      errors.sport = 'Выберите направление из списка или впишите своё';
    if (form.title.trim().length < 5) errors.title = 'Напишите название, хотя бы 5 букв';
  }
  if (step === 'when') {
    if (!form.date) errors.date = 'Выберите дату';
    if (!form.time) errors.time = 'Укажите, во сколько начало';
    const start = startsAtOf(form);
    if (start && dayjs(start).isBefore(dayjs().add(10, 'minute')))
      errors.date = 'Это время уже прошло. Выберите время в будущем';
    if (!(form.durationMin >= 15 && form.durationMin <= 720))
      errors.durationMin = 'Длительность от 15 минут до 12 часов';
    if (form.address.trim().length < 3) errors.address = 'Укажите адрес или понятный ориентир';
    const until = repeatUntilOf(form);
    if (!opts.edit && form.repeat) {
      if (!until) errors.repeatUntil = 'Выберите, до какой даты повторять';
      else if (start && until.isBefore(dayjs(start).add(1, 'week')))
        errors.repeatUntil = 'Последняя встреча должна быть хотя бы через неделю после первой';
      else if (start && until.diff(dayjs(start), 'day') > MAX_REPEAT_WEEKS * 7)
        errors.repeatUntil = `Повторять можно не дольше ${MAX_REPEAT_WEEKS} недель`;
    }
  }
  if (step === 'who') {
    if (form.family) {
      const { kind, minAge, maxAge } = form.family;
      if (kind === 'kids' && (minAge === null || maxAge === null))
        errors.family = 'Для детского занятия укажите возраст от и до';
      else if ([minAge, maxAge].some((n) => n !== null && (!Number.isInteger(n) || n < 0 || n > 17)))
        errors.family = 'Возраст детей: от 0 до 17 лет';
      else if (minAge !== null && maxAge !== null && minAge > maxAge)
        errors.family = 'Возраст «от» не может быть больше «до»';
    }
    if (
      form.capacity !== null &&
      !(Number.isInteger(form.capacity) && form.capacity >= 2 && form.capacity <= 500)
    )
      errors.capacity = 'Мест может быть от 2 до 500';
    if (form.minParticipants !== null) {
      if (!(Number.isInteger(form.minParticipants) && form.minParticipants >= 2))
        errors.minParticipants = 'Порог: не меньше 2 человек';
      else if (form.capacity !== null && form.minParticipants > form.capacity)
        errors.minParticipants = 'Порог не может быть больше числа мест';
    }
  }
  if (step === 'first') {
    if (form.priceKind === 'fixed' && !(Number(form.priceAmount) > 0 && Number(form.priceAmount) <= 100_000))
      errors.price = 'Укажите цену от 1 до 100 000 ₽';
    if (form.priceKind === 'split' && !(Number(form.priceTotal) > 0 && Number(form.priceTotal) <= 1_000_000))
      errors.price = 'Укажите общую сумму, которую делите на всех';
    if (form.priceKind === 'split' && paymentModeOf(form) === 'online' && !form.minParticipants)
      errors.paymentMode = 'Для складчины с оплатой на сайте укажите, сколько человек нужно, чтобы встреча состоялась';
  }
  return errors;
}

export function validateAll(form: EventForm, opts: { edit: boolean }): FormErrors {
  return STEPS.reduce<FormErrors>((acc, s) => ({ ...acc, ...validateStep(s.key, form, opts) }), {});
}

/** Ошибки сервера приходят по полям API — переводим их в поля формы. */
const SERVER_FIELD: Record<string, string> = {
  sportId: 'sport',
  startsAt: 'date',
  place: 'address',
  repeatWeeklyUntil: 'repeatUntil',
};

export function serverErrors(errors: Record<string, string> | undefined): FormErrors {
  if (!errors) return {};
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [SERVER_FIELD[k] ?? k, v]));
}

const FIELD_STEP: Record<string, StepKey> = {
  sport: 'what',
  title: 'what',
  description: 'what',
  coverUrl: 'what',
  date: 'when',
  time: 'when',
  durationMin: 'when',
  address: 'when',
  repeatUntil: 'when',
  joinMode: 'who',
  capacity: 'who',
  minParticipants: 'who',
  family: 'who',
  visibility: 'who',
  price: 'first',
  paymentMode: 'first',
  gear: 'first', // В3
};

export function firstStepWithError(errors: FormErrors): StepKey | null {
  for (const s of STEPS) if (Object.keys(errors).some((k) => FIELD_STEP[k] === s.key)) return s.key;
  return null;
}

export function stepHasErrors(step: StepKey, errors: FormErrors): boolean {
  return Object.keys(errors).some((k) => FIELD_STEP[k] === step);
}

/** Дата в поле выбора по-русски: «20 октября 2026, вт». Формат строится нашим dayjs с русской локалью. */
export const formatDateInput = (value: { toDate: () => Date }) =>
  dayjs(value.toDate()).format('D MMMM YYYY, dd');
