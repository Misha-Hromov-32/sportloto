import { count, plural, WORDS } from '@/lib/plural';
import type { EventCounts, PersonShort } from '@/types/api';

import styles from './CollectProgress.module.css';

interface CollectProgressProps {
  counts: EventCounts;
  capacity: number | null;
  minParticipants: number | null;
  /** Первые участники — их инициалы занимают места в ряду. */
  seats?: PersonShort[];
  variant?: 'compact' | 'full';
}

const MAX_SEATS = 16;

/**
 * Фирменный элемент «Вместе»: заполненность события как ряд мест.
 * Занятые места — с инициалами, порог сбора отмечен чертой, свободные — пустые кружки.
 * При большом лимите ряд превращается в шкалу с той же логикой.
 */
export function CollectProgress({
  counts,
  capacity,
  minParticipants,
  seats = [],
  variant = 'compact',
}: CollectProgressProps) {
  const { confirmed, waitlist, toThreshold, spotsLeft } = counts;
  const total = capacity ?? Math.max(minParticipants ?? 0, confirmed);
  const asSeats = capacity !== null && capacity <= MAX_SEATS;
  const full = capacity !== null && spotsLeft === 0;
  const headline = capacity ? `${confirmed} из ${capacity}` : count(confirmed, WORDS.participant);

  return (
    <div className={[styles.root, styles[variant]].join(' ')}>
      <div className={styles.head}>
        <span className={styles.number}>{headline}</span>
        <span className={styles.caption}>{caption()}</span>
      </div>

      {asSeats ? (
        <ol className={styles.seats} aria-hidden>
          {Array.from({ length: capacity! }, (_, i) => {
            const person = seats[i];
            const taken = i < confirmed;
            const isThreshold = minParticipants !== null && i === minParticipants - 1;
            return (
              <li
                key={i}
                className={[styles.seat, taken && styles.taken, isThreshold && styles.threshold]
                  .filter(Boolean)
                  .join(' ')}
                title={isThreshold ? `Порог сбора: ${minParticipants}` : undefined}
              >
                {variant === 'full' && taken ? (person?.initials ?? '') : ''}
              </li>
            );
          })}
        </ol>
      ) : total > 0 ? (
        <div className={styles.bar} aria-hidden>
          <span
            className={styles.fill}
            style={{ transform: `scaleX(${Math.min(1, confirmed / Math.max(total, 1))})` }}
          />
          {minParticipants !== null && total > 0 && (
            <span className={styles.tick} style={{ left: `${(minParticipants / total) * 100}%` }} />
          )}
        </div>
      ) : null}
    </div>
  );

  function caption(): string {
    if (toThreshold !== null && minParticipants !== null) {
      return `Состоится, если наберётся ${minParticipants}. Нужно ещё ${count(toThreshold, WORDS.person)}`;
    }
    if (full) {
      return waitlist > 0
        ? `Мест нет. В листе ожидания ${count(waitlist, WORDS.person)}`
        : 'Мест нет, можно встать в лист ожидания';
    }
    if (spotsLeft !== null) {
      const thresholdDone = minParticipants !== null ? 'Порог набран, событие состоится. ' : '';
      return `${thresholdDone}${spotsLeft === 1 ? 'Осталось 1 место' : `Осталось ${spotsLeft} ${plural(spotsLeft, WORDS.place)}`}`;
    }
    return minParticipants !== null
      ? 'Порог набран, событие состоится. Мест без ограничений'
      : 'Мест без ограничений';
  }
}
