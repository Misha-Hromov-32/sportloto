import { dayjs } from '@/lib/dates';
import type { EventCounts, EventView, OrganizerView, SportView } from '@/types/api';

import { cancelPolicyOf, paymentModeOf, priceOf, startsAtOf, type EventForm, type FormErrors } from './model';

export type PreviewRow =
  | 'sport'
  | 'title'
  | 'when'
  | 'place'
  | 'joinMode'
  | 'capacity'
  | 'price'
  | 'level'
  | 'firstStep'
  | 'description'
  | 'discussion';

/** Ошибки проверки → строки предпросмотра, чтобы показать пропуск там, где его правят. */
const ERROR_ROW: Record<string, PreviewRow> = {
  sport: 'sport',
  title: 'title',
  date: 'when',
  time: 'when',
  durationMin: 'when',
  repeatUntil: 'when',
  address: 'place',
  capacity: 'capacity',
  minParticipants: 'capacity',
  price: 'price',
  paymentMode: 'price',
};

export function problemsByRow(errors: FormErrors): Partial<Record<PreviewRow, string>> {
  const out: Partial<Record<PreviewRow, string>> = {};
  for (const [field, text] of Object.entries(errors)) {
    const row = ERROR_ROW[field];
    if (row && text && !out[row]) out[row] = text;
  }
  return out;
}

export function previewMarks(marks: Record<string, string>): Partial<Record<PreviewRow, string>> {
  const out: Partial<Record<PreviewRow, string>> = {};
  for (const [k, v] of Object.entries(marks)) {
    const row = (k === 'minParticipants' ? 'capacity' : k) as PreviewRow;
    out[row] = out[row] ? `${out[row]}. ${v}` : v;
  }
  return out;
}

export function previewSport(form: EventForm): SportView {
  return (
    form.sport ?? {
      id: 'new',
      name: form.newSportName || 'Направление',
      icon: null,
      kind: 'custom',
      popular: false,
      categoryIds: [],
      synonyms: [],
      fields: [],
    }
  );
}

const ZERO_COUNTS = (form: EventForm): EventCounts => ({
  confirmed: 0,
  pending: 0,
  waitlist: 0,
  spotsLeft: form.capacity,
  toThreshold: form.minParticipants,
});

/** Карточка для ленты из незаполненной до конца формы — тот же компонент, что увидят в поиске. */
export function previewView(form: EventForm, organizer: OrganizerView, counts?: EventCounts): EventView {
  const start = startsAtOf(form) ?? dayjs().add(1, 'day').hour(10).minute(0).toISOString();
  const now = new Date().toISOString();
  return {
    id: 'preview',
    title: form.title.trim() || 'Название встречи',
    description: form.description,
    sportId: form.sport?.id ?? 'new',
    organizer: { kind: organizer.kind, id: organizer.id },
    createdBy: organizer.id,
    startsAt: start,
    durationMin: form.durationMin,
    place: {
      address: form.address.trim() || 'Адрес появится здесь',
      landmark: '',
      districtId: form.districtId,
      lat: form.point?.lat ?? 0,
      lng: form.point?.lng ?? 0,
    },
    level: form.level,
    beginnersWelcome: form.beginnersWelcome,
    firstStep: {
      intensity: form.intensity,
      bring: form.bring,
      preparation: form.preparation,
      age: form.age,
      howToFind: form.howToFind,
      amenities: form.amenities,
      firstTimeNote: form.firstTimeNote,
    },
    price: priceOf(form),
    paymentNote: form.paymentNote,
    paymentMode: paymentModeOf(form),
    cancelPolicy: cancelPolicyOf(form),
    joinMode: form.joinMode,
    capacity: form.capacity,
    minParticipants: form.minParticipants,
    visibility: form.visibility,
    family: form.family,
    status: 'published',
    moderation: null,
    cancelReason: '',
    changes: [],
    series: null,
    privateInfo: form.privateInfo,
    discussion: form.discussion,
    extra: form.extra,
    coverUrl: form.coverUrl,
    createdWithAssistant: false,
    aiFlag: 'none',
    aiReason: '',
    createdAt: now,
    updatedAt: now,
    sport: previewSport(form),
    organizerView: organizer,
    state: 'upcoming',
    counts: counts ?? ZERO_COUNTS(form),
    seats: [],
    my: null,
    isOrganizer: false,
    can: {
      join: false,
      joinReason: '',
      leave: false,
      ask: false,
      askReason: '',
      manage: false,
      moderate: false,
      seePrivate: false,
    },
    distanceKm: null,
    districtName: null,
    matchReasons: [],
  };
}
