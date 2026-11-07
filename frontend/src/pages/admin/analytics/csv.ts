import type { AnalyticsView } from '@/types/community';

const BOM = String.fromCharCode(0xfeff);

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const line = (values: unknown[]) => values.map(cell).join(';');

/** Таблица для Excel: разделитель «;», метка UTF-8 в начале, дробные числа через запятую. */
export function analyticsCsv(view: AnalyticsView): string {
  const num = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));
  const rows: string[] = [
    line([`Спрос и инфраструктура за ${view.days} дней`, view.from.slice(0, 10), view.to.slice(0, 10)]),
    line(['Записано раньше', view.demoEntries, 'Новых записей', view.liveEntries]),
    '',
    line([
      'Район',
      'Спрос',
      'Не нашли или мест нет',
      'Старшие, дети, инклюзия, бесплатное',
      'Встреч на месяц',
      'Бесплатных встреч',
      'Платных встреч',
      'Средняя цена, ₽',
      'Заполненность платных, %',
      'Мест во встречах',
      'Площадок',
      'Свободных окон на неделю',
      'Площадок без доступной среды',
      'Встреч без доступной среды',
      'Запросов на одну встречу',
      'Коммерческий спрос, 0–100',
      'Общественная потребность, 0–100',
    ]),
    ...view.districts.map((r) =>
      line([
        r.name,
        r.demand,
        r.unmet,
        r.vulnerable,
        r.events,
        r.freeEvents,
        r.paidEvents,
        r.avgPrice ?? '',
        r.paidFill === null ? '' : Math.round(r.paidFill * 100),
        r.seats,
        r.venues,
        r.freeWindows,
        r.venuesNoAccess,
        r.eventsNoAccess,
        num(r.gap),
        r.commercial,
        r.social,
      ]),
    ),
    '',
    line(['Район', 'Направление', 'Спрос', 'Встреч на месяц', 'Запросов на одну встречу']),
    ...view.cells.map((c) =>
      line([
        view.districts.find((x) => x.id === c.districtId)?.name ?? c.districtId,
        view.sports.find((s) => s.id === c.sportId)?.name ?? c.sportId,
        c.demand,
        c.events,
        num(c.gap),
      ]),
    ),
  ];
  return `${BOM}${rows.join('\r\n')}`;
}

export function downloadCsv(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
