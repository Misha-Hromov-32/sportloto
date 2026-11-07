/** Регрессии интерфейса: местное время в форме, отсчёт до начала и порядок событий в ленте. */
import assert from 'node:assert/strict';

import { makeEventDetails, makeEventView } from '../fixtures/event';

const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
};
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });

export async function main() {
  const { fromEvent, toInput, toPatch, formTimeZone } = await import('@/pages/events/create/model');
  const { formatEventDate } = await import('@/lib/dates');
  const { countdownText } = await import('@/lib/eventCountdown');
  const { orderEvents } = await import('@/pages/events/feed/ranking');
  const check = (name: string, ok: unknown) => {
    assert.ok(ok, name);
    process.stdout.write(`ок  ${name}\n`);
  };
  const form = {
    ...fromEvent(makeEventDetails()),
    date: '2030-06-15',
    time: '19:00',
    title: 'Проверка местного времени',
    discussion: 'participants' as const,
  };
  storage.setItem('sportitochka.city', 'krasnoyarsk');
  const previousZone = process.env.TZ;
  try {
    for (const zone of ['Europe/Moscow', 'Asia/Krasnoyarsk', 'UTC', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      const input = toInput(form, false);
      check(`19:00 → ISO 12:00Z при поясе устройства ${zone}`, input.startsAt === '2030-06-15T12:00:00.000Z');
      check(
        `Карточка сохраняет 19:00 при поясе устройства ${zone}`,
        formatEventDate(input.startsAt).endsWith('19:00'),
      );
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
  storage.setItem('sportitochka.city', 'moscow');
  check(
    'Смена города в шапке не сдвигает время правки красноярской встречи',
    formTimeZone(form) === 'Asia/Krasnoyarsk' && toPatch(form).startsAt === '2030-06-15T12:00:00.000Z',
  );
  check(
    'Предпросмотр в поясе формы остаётся 19:00',
    formatEventDate(toInput(form, false).startsAt, undefined, formTimeZone(form)).endsWith('19:00'),
  );
  storage.setItem('sportitochka.city', 'krasnoyarsk');

  check(
    'Свободное событие не принимает закрытое обсуждение из формы',
    toInput(form, false).discussion === 'everyone',
  );

  const now = Date.parse('2030-06-15T10:00:00Z');
  check(
    'Точный отсчёт до начала',
    countdownText('2030-06-15T12:30:00Z', 'upcoming', now)?.replace(/[\u00a0\u202f]/g, ' ') ===
      'До начала 2 часа 30 минут',
  );
  check(
    'На границе начала встреча уже идёт',
    countdownText('2030-06-15T10:00:00Z', 'upcoming', now) === 'Встреча уже идёт',
  );
  check(
    'У снятого события нет обратного отсчёта',
    countdownText('2030-06-15T12:00:00Z', 'removed', now) === null,
  );
  check(
    'После окончания отсчёт не сообщает, что игра всё ещё идёт',
    countdownText('2030-06-15T08:00:00Z', 'live', now, 60) === 'Встреча завершилась',
  );
  const a = makeEventView({
    id: 'early',
    sportId: 's-running',
    title: 'Спокойная тренировка',
    startsAt: '2030-06-15T12:00:00Z',
    matchReasons: ['Рядом', 'Бесплатно', 'Ваш уровень'],
  });
  const b = makeEventView({
    id: 'relevant',
    sportId: 's-volleyball',
    title: 'Волейбол для начинающих',
    startsAt: '2030-06-15T19:00:00Z',
    matchReasons: [],
  });
  check(
    'Релевантность ставит совпадение с запросом выше ранней даты',
    orderEvents([a, b], 'relevance', 'волейбол')[0]?.id === 'relevant',
  );
  check(
    'Сортировка по времени возвращает ближайшее событие',
    orderEvents([b, a], 'time', 'волейбол')[0]?.id === 'early',
  );
  check(
    'Без запроса учитываются интересы пользователя',
    orderEvents([a, b], 'relevance', '', ['s-volleyball'])[0]?.id === 'relevant',
  );
  process.stdout.write('Замечания: все проверки прошли\n');
}
