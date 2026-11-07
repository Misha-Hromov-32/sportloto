/**
 * Время встречи живёт в поясе места проведения: «пробежка в 07:30» — это 07:30 по Красноярску,
 * с какого бы устройства на неё ни смотрели. Здесь — перевод между местным временем пояса и ISO.
 */

function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: get('weekday'),
  };
}

/** Смещение пояса от UTC в минутах в указанный момент. */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** Местные дата («2026-10-22») и время («19:00») в поясе → момент в ISO. */
export function zonedToIso(date: string, time: string, timeZone: string): string | null {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  if (![y, mo, d, h, mi].every((n) => Number.isFinite(n))) return null;
  const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  let ts = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
  // Второй проход — на случай перехода на летнее время между догадкой и ответом.
  ts = guess - zoneOffsetMinutes(new Date(ts), timeZone) * 60000;
  return new Date(ts).toISOString();
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const pad = (n: number) => String(n).padStart(2, '0');

/** Момент → местные дата, время и день недели (1 — пн … 7 — вс) в поясе. */
export function zonedParts(iso: string, timeZone: string): { date: string; time: string; weekday: number } {
  const p = parts(new Date(iso), timeZone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
    weekday: WEEKDAY[p.weekday] ?? 1,
  };
}
