import type { EventView } from '@/types/api';

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function escape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/([,;])/g, '\\$1');
}

/** RFC 5545: строка не длиннее 75 байт. Кириллица в UTF-8 занимает 2 байта, поэтому режем по 30 символов. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 30) {
    parts.push(rest.slice(0, 30));
    rest = rest.slice(30);
  }
  parts.push(rest);
  return parts.join('\r\n ');
}

export function buildIcs(events: EventView[], origin: string): string {
  const now = stamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vmeste//RU', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    const start = new Date(e.startsAt);
    const end = new Date(start.getTime() + e.durationMin * 60_000);
    const where = [e.place.address, e.place.landmark].filter(Boolean).join('. ');
    const description = [
      e.sport.name,
      e.firstStep.bring && `Что взять: ${e.firstStep.bring}`,
      `${origin}/events/${e.id}`,
    ]
      .filter(Boolean)
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@vmeste`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      fold(`SUMMARY:${escape(e.title)}`),
      fold(`LOCATION:${escape(where)}`),
      fold(`DESCRIPTION:${escape(description)}`),
      `URL:${origin}/events/${e.id}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(events: EventView[], filename = 'vmeste.ics') {
  const blob = new Blob([buildIcs(events, window.location.origin)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
