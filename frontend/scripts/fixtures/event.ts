/** Данные-фикстуры для проверок интерфейса: событие в форме ответа сервера (только поля, нужные проверкам). */
import type { EventDetails, EventView } from '@/types/api';

/** Красноярск, суббота 2030-06-15 19:00 по местному времени (12:00 UTC). */
export function makeEventDetails(patch: Partial<EventDetails> = {}): EventDetails {
  const base = {
    id: 'e-fixture',
    title: 'Пробежка в Татышев-парке',
    description: 'Лёгкий темп, 5 км.',
    sportId: 's-running',
    sport: { id: 's-running', name: 'Бег' },
    organizer: { kind: 'user', id: 'u-organizer' },
    startsAt: '2030-06-15T12:00:00.000Z',
    durationMin: 60,
    place: {
      address: 'Татышев-парк, главный вход',
      districtId: null,
      landmark: 'У фонтана',
      lat: 56.0153,
      lng: 92.8932,
    },
    level: 'any',
    beginnersWelcome: true,
    firstStep: {
      intensity: 'light',
      bring: 'Кроссовки',
      preparation: '',
      age: '16+',
      howToFind: '',
      amenities: ['water'],
      firstTimeNote: '',
    },
    price: { kind: 'free' },
    paymentNote: '',
    cancelPolicy: { kind: 'anytime' },
    joinMode: 'open',
    capacity: 20,
    minParticipants: null,
    privateInfo: '',
    discussion: 'everyone',
    extra: {},
    coverUrl: null,
    state: 'upcoming',
    counts: { confirmed: 0, pending: 0, waitlist: 0, spotsLeft: 20 },
    matchReasons: [],
    participants: [],
    manage: null,
    messagesCount: 0,
  };
  return { ...base, ...patch } as unknown as EventDetails;
}

export function makeEventView(patch: Partial<EventView> = {}): EventView {
  return makeEventDetails(patch as Partial<EventDetails>) as EventView;
}
