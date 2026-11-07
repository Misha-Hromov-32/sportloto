import { Tooltip } from 'antd';

import { dayjs } from '@/lib/dates';
import { count } from '@/lib/plural';
import type { AnalyticsView } from '@/types/community';

import styles from './analytics.module.css';

const REQUESTS = ['запрос', 'запроса', 'запросов'] as const;
const MEETINGS = ['встреча', 'встречи', 'встреч'] as const;

/** Шаги одной шкалы: сколько запросов приходится на одну встречу. */
const STEPS = [
  { max: 2, label: 'до 2' },
  { max: 5, label: '3–5' },
  { max: 10, label: '6–10' },
  { max: 20, label: '11–20' },
  { max: Infinity, label: 'больше 20' },
];
const stepOf = (gap: number) => STEPS.findIndex((s) => gap <= s.max);
const STEP_CLASS = [styles.s0, styles.s1, styles.s2, styles.s3, styles.s4];

export function GapLegend() {
  return (
    <ul className={styles.legend} aria-label="Шкала цвета: запросов на одну встречу">
      <li>Запросов на одну встречу:</li>
      {STEPS.map((s, i) => (
        <li key={s.label}>
          <span className={[styles.swatch, STEP_CLASS[i]].join(' ')} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function HeatGrid({ view, columns = 8 }: { view: AnalyticsView; columns?: number }) {
  const sports = view.sports.slice(0, columns);
  const byKey = new Map(view.cells.map((c) => [`${c.districtId}|${c.sportId}`, c]));
  return (
    <div className={styles.heatWrap} tabIndex={0} role="region" aria-label="Разрыв по районам и направлениям, таблица прокручивается вбок">
      <table className={styles.heat}>
        <caption className="sr-only">
          Спрос и число встреч по районам и направлениям. В ячейке число запросов и встреч, цвет показывает, сколько
          запросов приходится на одну встречу.
        </caption>
        <thead>
          <tr>
            <th scope="col">Район</th>
            {sports.map((s) => (
              <th key={s.id} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.districts.map((r) => (
            <tr key={r.id}>
              <th scope="row">{r.name}</th>
              {sports.map((s) => {
                const c = byKey.get(`${r.id}|${s.id}`);
                if (!c)
                  return (
                    <td key={s.id} className={[styles.cell, styles.cellEmpty].join(' ')}>
                      <span aria-label="нет данных">–</span>
                    </td>
                  );
                const text = `${r.name}, ${s.name.toLowerCase()}: ${count(c.demand, REQUESTS)}, ${
                  c.events ? count(c.events, MEETINGS) : 'встреч нет'
                }. Запросов на одну встречу: ${c.gap.toLocaleString('ru-RU')}.`;
                return (
                  <Tooltip key={s.id} title={text} trigger={['hover', 'focus']}>
                    <td className={[styles.cell, STEP_CLASS[stepOf(c.gap)]].join(' ')} tabIndex={0} aria-label={text}>
                      <span className={styles.cellNum}>{c.demand}</span>
                      <span className={styles.cellSub}>{c.events ? `встреч: ${c.events}` : 'нет встреч'}</span>
                    </td>
                  </Tooltip>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DailyChart({ view }: { view: AnalyticsView }) {
  const max = Math.max(1, ...view.daily.map((d) => d.demand));
  const first = view.daily[0];
  const last = view.daily[view.daily.length - 1];
  return (
    <div className={styles.panel}>
      <ul className={styles.legend}>
        <li>
          <span className={styles.swatch} style={{ background: 'var(--line)' }} aria-hidden />
          Записано раньше
        </li>
        <li>
          <span className={styles.swatch} style={{ background: 'var(--accent)' }} aria-hidden />
          Новые
        </li>
      </ul>
      <div className={styles.daily} role="img" aria-label={`Спрос по дням за ${view.days} дней, подробности в таблице ниже`}>
        {view.daily.map((d) => {
          const demo = d.demand - d.live;
          const tip = `${dayjs(d.date).format('D MMMM, dd')}: ${count(d.demand, REQUESTS)}${d.live ? `, из них новых: ${d.live}` : ''}`;
          return (
            <Tooltip key={d.date} title={tip}>
              <div className={styles.day}>
                {demo > 0 && (
                  <span
                    className={[styles.bar, styles.barDemo, !d.live && styles.barTop].filter(Boolean).join(' ')}
                    style={{ height: `${(demo / max) * 100}%` }}
                  />
                )}
                {d.live > 0 && <span className={[styles.bar, styles.barLive].join(' ')} style={{ height: `${(d.live / max) * 100}%` }} />}
              </div>
            </Tooltip>
          );
        })}
      </div>
      {first && last && (
        <div className={styles.axis} aria-hidden>
          <span>{dayjs(first.date).format('D MMMM')}</span>
          <span>больше всего за день: {max}</span>
          <span>{dayjs(last.date).format('D MMMM')}</span>
        </div>
      )}
      <details className={styles.method}>
        <summary>Показать таблицей</summary>
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">День</th>
                <th scope="col">Всего</th>
                <th scope="col">Новые</th>
              </tr>
            </thead>
            <tbody>
              {view.daily.map((d) => (
                <tr key={d.date}>
                  <td>{dayjs(d.date).format('D MMMM, dd')}</td>
                  <td>{d.demand}</td>
                  <td>{d.live}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function Bars({ items, label }: { items: { label: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className={styles.bars} aria-label={label}>
      {items.map((i) => (
        <li key={i.label} className={styles.barRow}>
          <span className={styles.barLabel}>{i.label}</span>
          <span className={styles.barValue}>{i.value}</span>
          <span className={styles.barTrack} aria-hidden>
            <span className={styles.barFill} style={{ width: `${(i.value / max) * 100}%`, display: 'block' }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span className={styles.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
      <span className={styles.meterNum}>{value}</span>
      <span className={styles.meterTrack} aria-hidden>
        <span className={styles.meterFill} style={{ width: `${value}%`, display: 'block' }} />
      </span>
    </span>
  );
}
