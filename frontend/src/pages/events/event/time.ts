import { dayjs, displayZone } from '@/lib/dates';
import { cityOfPlace } from '@/lib/cities';
import { zoneOffsetMinutes } from '@/lib/timezone';
import type { EventView } from '@/types/api';

/**
 * Основное время показывается по поясу выбранного в шапке города. Если место встречи в другом
 * поясе (выбран Красноярск, а встреча в Москве) — вторая строка с временем места.
 */
export function placeTimeNote(iso: string, durationMin: number, place: EventView['place']): string | null {
  const city = cityOfPlace(place);
  const start = new Date(iso);
  if (zoneOffsetMinutes(start, displayZone()) === zoneOffsetMinutes(start, city.timeZone)) return null;
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: city.timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });
  const end = new Date(start.getTime() + durationMin * 60000);
  const day = new Intl.DateTimeFormat('ru-RU', {
    timeZone: city.timeZone,
    day: 'numeric',
    month: 'long',
  }).format(start);
  return `По местному времени (${city.name}): ${day}, ${fmt.format(start)}–${fmt.format(end)}`;
}

const icsText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[,;]/g, (m) => `\\${m}`);
const icsDate = (d: dayjs.Dayjs) =>
  d
    .toDate()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Файл календаря .ics: собирается на устройстве, без внешних сервисов. */
export function downloadIcs(event: EventView) {
  const start = dayjs(event.startsAt);
  const end = start.add(event.durationMin, 'minute');
  const url = `${window.location.origin}/events/${event.id}`;
  const description = [
    event.firstStep.bring && `Что взять: ${event.firstStep.bring}`,
    event.firstStep.howToFind && `Как найти: ${event.firstStep.howToFind}`,
    event.privateInfo,
    url,
  ]
    .filter(Boolean)
    .join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vmeste//RU',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@vmeste`,
    `DTSTAMP:${icsDate(dayjs())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(event.title)}`,
    `LOCATION:${icsText([event.place.address, event.place.landmark].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${icsText(description)}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(event.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `vmeste-${event.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
